import Pusher from 'pusher-js';
import { BotContext } from '../types';
import { Telegraf } from 'telegraf';
import { CopperxAPI } from './copperx-api';
import axios from 'axios';

interface DepositNotification {
  amount: string;
  network: string;
  status: string;
  transactionId: string;
  timestamp: string;
}

let activeSubscriptions = new Map<string, { 
  pusher: Pusher, 
  channel: ReturnType<Pusher['subscribe']> 
}>();

// Function to subscribe to organization's channel
async function subscribeToOrganization(api: CopperxAPI, bot: Telegraf<BotContext>, organizationId: string, chatId: number, authToken: string) {
  console.log('=== Starting subscription process ===');
  console.log('Auth token available:', !!authToken);
  console.log('Organization ID:', organizationId);
  console.log('Chat ID:', chatId);
  
  try {
    const channelName = `private-org-${organizationId}`;
    console.log(`Attempting to subscribe to channel: ${channelName}`);
    
    // Unsubscribe if already subscribed
    if (activeSubscriptions.has(channelName)) {
      console.log(`Unsubscribing from existing channel: ${channelName}`);
      const subscription = activeSubscriptions.get(channelName);
      subscription?.channel.unsubscribe();
      subscription?.pusher.disconnect();
      activeSubscriptions.delete(channelName);
      console.log('Successfully unsubscribed from existing channel');
    }

    // Initialize Pusher client with key
    console.log('Creating new Pusher client with key:', process.env.PUSHER_KEY?.substring(0, 5) + '...');
    console.log('Cluster:', process.env.PUSHER_CLUSTER);
    
    // Try with direct auth parameters instead of custom authorizer
    const pusherClient = new Pusher(process.env.PUSHER_KEY!, {
      cluster: process.env.PUSHER_CLUSTER!,
      forceTLS: true,
      enabledTransports: ['ws', 'wss'],
      authEndpoint: `${process.env.COPPERX_API_URL}/api/notifications/auth`,
      auth: {
        headers: {
          Authorization: `Bearer ${authToken}`
        }
      }
    });

    console.log('Pusher client created, setting up event listeners');
    
    // Global event binding for the client
    pusherClient.bind_global((event: string, data: any) => {
      console.log(`Global Pusher event received: ${event}`, data);
    });
    
    // Handle Pusher connection events
    pusherClient.connection.bind('connected', () => {
      console.log(`Successfully connected to Pusher for channel: ${channelName}`);
    });

    pusherClient.connection.bind('error', (error: Error) => {
      console.error(`Pusher connection error for channel ${channelName}:`, error);
    });

    pusherClient.connection.bind('disconnected', () => {
      console.log(`Disconnected from Pusher for channel: ${channelName}`);
    });

    // Log current connection state
    console.log('Current Pusher connection state:', pusherClient.connection.state);

    // Subscribe to the channel
    console.log('About to subscribe to channel:', channelName);
    const channel = pusherClient.subscribe(channelName);
    console.log('Channel subscription initialized');

    // Monitor all channel events for debugging
    channel.bind_global((event: string, data: any) => {
      console.log(`Global event received on channel ${channelName}:`, event, data);
    });

    // Handle subscription success
    channel.bind('pusher:subscription_succeeded', () => {
      console.log(`Successfully subscribed to channel: ${channelName}`);
      activeSubscriptions.set(channelName, { pusher: pusherClient, channel });
    });

    // Handle subscription error
    channel.bind('pusher:subscription_error', (error: any) => {
      console.error(`Subscription error for channel ${channelName}:`, JSON.stringify(error, null, 2));
      activeSubscriptions.delete(channelName);
    });

    // Handle deposit events
    channel.bind('deposit', (data: any) => {
      console.log('Received deposit event:', JSON.stringify(data, null, 2));
      
      try {
        const amount = Number(data.amount) / 10 ** 8; // Convert from wei to USDC
        const network = data.network;
        const status = data.status;
        const timestamp = new Date(data.timestamp).toLocaleString();

        const message = `
💰 <b>New Deposit Received</b>

Amount: <b>${amount.toFixed(2)} USDC</b>
Network: <b>${network}</b>
Status: <b>${status}</b>
Time: ${timestamp}
Transaction ID: <code>${data.transactionId}</code>`;

        console.log(`Sending deposit notification to chat ${chatId}:`, message);

        bot.telegram.sendMessage(chatId, message, {
          parse_mode: 'HTML'
        }).then(() => {
          console.log('Successfully sent deposit notification');
        }).catch(error => {
          console.error('Error sending deposit notification:', error);
        });
      } catch (error) {
        console.error('Error processing deposit notification:', error);
      }
    });

  } catch (error) {
    console.error('Error setting up organization subscription:', error);
  }
}

// Function to unsubscribe from organization's channel
function unsubscribeFromOrganization(organizationId: string) {
  const channelName = `private-org-${organizationId}`;
  console.log(`Unsubscribing from organization channel: ${channelName}`);
  if (activeSubscriptions.has(channelName)) {
    const subscription = activeSubscriptions.get(channelName);
    subscription?.channel.unsubscribe();
    subscription?.pusher.disconnect();
    activeSubscriptions.delete(channelName);
  }
}

export function setupNotifications(bot: Telegraf<BotContext>, api: CopperxAPI) {
  console.log('Initializing Pusher notifications service...');

  // Subscribe to notifications when user logs in
  bot.use(async (ctx, next) => {
    console.log('Notification middleware triggered:', {
      updateType: ctx.updateType,
      hasMessage: !!ctx.message,
      hasCommand: ctx.message && 'text' in ctx.message && ctx.message.text.startsWith('/'),
      commandText: ctx.message && 'text' in ctx.message ? ctx.message.text : null
    });
    
    console.log('Checking for session data:', {
      hasAuthToken: !!ctx.session?.authToken,
      hasOrgId: !!ctx.session?.organizationId,
      hasChatId: !!ctx.chat?.id,
      orgId: ctx.session?.organizationId,
      chatId: ctx.chat?.id
    });
    
    if (ctx.session?.organizationId && ctx.chat?.id && ctx.session?.authToken) {
      console.log(`User logged in - setting up notifications for org ${ctx.session.organizationId}`);
      await subscribeToOrganization(api, bot, ctx.session.organizationId, ctx.chat.id, ctx.session.authToken);
    }
    
    return next();
  });

  // Unsubscribe when user logs out
  bot.command('logout', async (ctx) => {
    if (ctx.session?.organizationId) {
      console.log(`User logging out - cleaning up notifications for org ${ctx.session.organizationId}`);
      unsubscribeFromOrganization(ctx.session.organizationId);
    }
    ctx.session = {};
    await ctx.reply('✅ Successfully logged out.');
  });

  // Handle bot shutdown
  process.once('SIGINT', () => {
    console.log('Received SIGINT - cleaning up Pusher connections');
    // Unsubscribe from all channels
    activeSubscriptions.forEach((subscription) => {
      subscription.channel.unsubscribe();
      subscription.pusher.disconnect();
    });
    activeSubscriptions.clear();
  });

  process.once('SIGTERM', () => {
    console.log('Received SIGTERM - cleaning up Pusher connections');
    // Unsubscribe from all channels
    activeSubscriptions.forEach((subscription) => {
      subscription.channel.unsubscribe();
      subscription.pusher.disconnect();
    });
    activeSubscriptions.clear();
  });

  console.log('Pusher notifications service initialized');
}

// Export the debug subscribe command for external registration
export function registerDebugCommand(bot: Telegraf<BotContext>, api: CopperxAPI) {
  bot.command('debug_subscribe', async (ctx) => {
    console.log('\n\n========== DEBUG COMMAND STARTED ==========');
    console.log('Debug subscribe command received directly');
    
    if (!ctx.session?.authToken) {
      console.log('No auth token found in session');
      await ctx.reply('⚠️ You are not logged in. Please /login first.');
      return;
    }
    
    if (!ctx.session?.organizationId) {
      console.log('No organization ID found in session');
      await ctx.reply('⚠️ Missing organization ID in session. Please /logout and /login again.');
      return;
    }
    
    console.log('Debug subscribe: Manually triggering subscription');
    console.log('Debug subscribe: Session data:', {
      authToken: ctx.session.authToken ? ctx.session.authToken.substring(0, 5) + '...' : 'none',
      organizationId: ctx.session.organizationId,
      chatId: ctx.chat?.id
    });
    
    try {
      // Test auth endpoint directly first
      console.log('Testing Pusher auth endpoint directly...');
      try {
        const testResponse = await axios.post(
          `${process.env.COPPERX_API_URL}/api/notifications/auth`,
          {
            socket_id: 'test_socket_id',
            channel_name: `private-org-${ctx.session.organizationId}`
          },
          {
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${ctx.session.authToken}`
            }
          }
        );
        
        console.log('Auth endpoint test response:', {
          status: testResponse.status,
          data: testResponse.data
        });
        
        await ctx.reply(`Auth endpoint test: ${testResponse.status === 200 ? '✅ Success' : '❌ Failed'}`);
      } catch (authError: any) {
        console.error('Auth endpoint test error:', {
          message: authError.message,
          response: authError.response?.data
        });
        
        await ctx.reply(`Auth endpoint test: ❌ Failed - ${authError.message}`);
      }
      
      console.log('About to call subscribeToOrganization...');
      await subscribeToOrganization(api, bot, ctx.session.organizationId, ctx.chat!.id, ctx.session.authToken);
      console.log('subscribeToOrganization completed successfully');
      await ctx.reply('✅ Debug: Subscription attempt completed. Check logs for details.');
    } catch (error) {
      console.error('Error in debug subscription:', error);
      await ctx.reply('❌ Debug: Error during subscription attempt. Check logs.');
    }
    console.log('========== DEBUG COMMAND COMPLETED ==========\n\n');
  });
} 