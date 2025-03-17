import Pusher from 'pusher-js';
import { Telegraf } from 'telegraf';
import { BotContext } from '../types';
import { CopperxAPI } from './copperx-api';

export function setupNotifications(bot: Telegraf<BotContext>, api: CopperxAPI) {
  const pusher = new Pusher(process.env.PUSHER_KEY!, {
    cluster: process.env.PUSHER_CLUSTER!,
    authorizer: (channel) => ({
      authorize: async (socketId, callback) => {
        try {
          const channelName = channel.name;
          // Access context directly from bot instance
          const ctx = bot.context as BotContext;
          
          if (!ctx.session?.authToken) {
            callback(new Error('No authenticated session found'), null);
            return;
          }

          const response = await api.authenticatePusher(
            ctx.session.authToken,
            socketId,
            channelName
          );

          callback(null, response);
        } catch (error) {
          console.error('Pusher authorization error:', error);
          callback(error as Error, null);
        }
      }
    })
  });

  // Handle deposit notifications for each user session
  bot.on('message', (ctx) => {
    if (ctx.session?.organizationId && ctx.session?.authToken) {
      const channel = pusher.subscribe(`private-org-${ctx.session.organizationId}`);

      channel.bind('pusher:subscription_succeeded', () => {
        console.log(`Subscribed to notifications for org ${ctx.session.organizationId}`);
      });

      channel.bind('deposit', (data: any) => {
        const message = `
💰 *New Deposit Received*

Amount: ${data.amount} USDC
Network: ${data.network}
Status: Confirmed

_Transaction is now available in your wallet._
`;
        ctx.replyWithMarkdown(message);
      });

      channel.bind('pusher:subscription_error', (error: any) => {
        console.error('Subscription error:', error);
      });
    }
  });
} 