import { Telegraf } from 'telegraf';
import dotenv from 'dotenv';
import { BotContext } from './types';
import { CopperxAPI } from './services/copperx-api';
import { setupNotifications, registerDebugCommand } from './services/notifications';
import axios from 'axios';
import { PostgresSession } from './middleware/session';
import { initializeDatabase } from './config/database';

// Load environment variables
dotenv.config();

// Validate required environment variables
const requiredEnvVars = [
  'BOT_TOKEN',
  'COPPERX_API_URL',
  'PUSHER_KEY',
  'PUSHER_CLUSTER',
  'DATABASE_URL'
];

for (const envVar of requiredEnvVars) {
  if (!process.env[envVar]) {
    throw new Error(`Missing required environment variable: ${envVar}`);
  }
}

// Initialize bot with custom context type
const bot = new Telegraf<BotContext>(process.env.BOT_TOKEN!);

// Initialize API client
const api = new CopperxAPI(process.env.COPPERX_API_URL!);

// Use PostgreSQL session middleware instead of memory session
bot.use(PostgresSession);

// Add session debugging middleware
bot.use((ctx, next) => {
  // console.log('Current session state:', JSON.stringify(ctx.session, null, 2));
  return next();
});

// Middleware to log all incoming messages
bot.use((ctx, next) => {
  const user = ctx.from;
  const timestamp = new Date().toISOString();
  
  let content = 'no content';
  if (ctx.message && 'text' in ctx.message) {
    content = ctx.message.text;
  } else if (ctx.callbackQuery && 'data' in ctx.callbackQuery) {
    content = ctx.callbackQuery.data;
  }

  console.log(`[${timestamp}] User ${user?.id} (${user?.username || 'no username'}):`, {
    messageType: ctx.updateType,
    content,
    chatId: ctx.chat?.id,
    messageId: ctx.message?.message_id || ctx.callbackQuery?.message?.message_id
  });

  return next();
});

// Start command
bot.command('start', async (ctx) => {
  const welcomeMessage = `
<b>👋 Welcome to Copperx Payout Bot!</b>

<i>Your all-in-one solution for managing digital assets</i>

🚀 <b>What you can do:</b>
• Manage your Copperx wallet
• Send and receive funds
• Track transactions
• Monitor balances

📱 <b>Getting Started:</b>
1️⃣ Use /login to access your account
2️⃣ Check /help for all available commands

💬 <b>Need Support?</b>
Join our community: <a href="https://t.me/copperxcommunity/2183">Copperx Community</a>`;
  
  try {
    await ctx.replyWithPhoto({ source: 'assets/banner.jpeg' }, {
      caption: welcomeMessage,
      parse_mode: 'HTML'
    });
  } catch (error) {
    console.error('Error sending image:', error);
    await ctx.reply(welcomeMessage, { parse_mode: 'HTML' });
  }
});

// Login command
bot.command('login', async (ctx) => {
  if (ctx.session?.authToken) {
    const keyboard = {
      inline_keyboard: [
        [{ text: '🔄 Switch Account', callback_data: 'switch_account' }]
      ]
    };
    
    await ctx.reply(
      '✅ <b>Already Logged In</b>\n\n' +
      'To login with a different account, you can:\n' +
      '1️⃣ Use /logout first, or\n' +
      '2️⃣ Click the button below to switch accounts',
      { 
        parse_mode: 'HTML',
        reply_markup: keyboard 
      }
    );
    return;
  }

  const keyboard = {
    inline_keyboard: [
      [{ text: '❌ Cancel Login', callback_data: 'cancel_login' }]
    ]
  };

  await ctx.reply(
    '🔐 <b>Login to Your Account</b>\n\n' +
    'Please enter your email address to continue.\n' +
    'We\'ll send you a verification code.',
    { 
      parse_mode: 'HTML',
      reply_markup: keyboard 
    }
  );
  ctx.session = { ...ctx.session, awaitingEmail: true };
});

// Help command
bot.command('help', async (ctx) => {
  console.log('Help command triggered');
  
  const helpMessage = `
<b>🤖 Copperx Payout Bot Help</b>

<i>Here are all available commands:</i>

🔐 <b>Authentication</b>
• /login - Login to your account
• /logout - Logout from your account
• /status - Check your KYC/KYB status

💰 <b>Wallet</b>
• /balance - View your wallet balances
• /deposit - Get deposit instructions
• /setdefault - Set your default wallet

💸 <b>Transfer</b>
• /send - Send funds to email or wallet
• /withdraw - Withdraw funds to bank account

📊 <b>History</b>
• /history - View transaction history

❓ <b>Support</b>
Need help? Visit our community: <a href="https://t.me/copperxcommunity/2183">Copperx Community</a>

<i>For security, never share your password or sensitive information.</i>`;

  try {
    await ctx.reply(helpMessage, {
      parse_mode: 'HTML'
    });
  } catch (err) {
    console.error('Error sending help message:', err);
    await ctx.reply(helpMessage.replace(/<[^>]*>/g, ''));
  }
});

// Status command
bot.command('status', async (ctx) => {
  console.log('Status command triggered');
  if (!ctx.session?.authToken) {
    await ctx.reply('⚠️ Please /login first to check your status.');
    return;
  }

  try {
    console.log('Fetching user profile and KYC status');
    const profile = await api.getUserProfile(ctx.session.authToken);
    const kycStatus = await api.getKYCStatus(ctx.session.authToken);
    console.log('KYC status:', kycStatus);

    const statusMessage = `
👤 <b>Account Details</b>

Name: ${profile.firstName} ${profile.lastName || ''}
Email: ${profile.email}
Account Type: ${profile.type}
Role: ${profile.role}
KYC Status: ${kycStatus}

🏦 <b>Wallet Information</b>
Wallet Address: ${profile.walletAddress || 'Not set'}
Account Type: ${profile.walletAccountType || 'Not set'}
${profile.relayerAddress ? `Relayer Address: ${profile.relayerAddress}` : ''}

${kycStatus !== 'approved' ? '\n⚠️ Please complete KYC on the Copperx platform to enable all features.' : '✅ Account fully verified'}`;

    console.log('Sending status message with markdown');
    await ctx.reply(statusMessage, { parse_mode: 'HTML' });
  } catch (err) {
    const error = err as Error & { response?: { data: any } };
    console.error('Error fetching status:', {
      errorName: error.name,
      errorMessage: error.message,
      errorResponse: error.response?.data,
      errorStack: error.stack
    });

    if (axios.isAxiosError(error) && error.response?.status === 401) {
      ctx.session = {};
      await ctx.reply('⚠️ Your session has expired. Please /login again.');
    } else {
      await ctx.reply('❌ Failed to fetch status. Please try again later.');
    }
  }
});

// Logout command
bot.command('logout', async (ctx) => {
  console.log('Logout command triggered');
  if (!ctx.session?.authToken) {
    await ctx.reply('⚠️ You are not logged in.');
    return;
  }

  ctx.session = {};
  await ctx.reply('✅ Successfully logged out.');
});

// Balance command
bot.command('balance', async (ctx) => {
  console.log('Balance command triggered');
  if (!ctx.session?.authToken) {
    console.log('No auth token found in session');
    await ctx.reply('⚠️ Please /login first to check your balance.');
    return;
  }

  try {
    const wallets = await api.getWallets(ctx.session.authToken);
    const balances = await api.getWalletBalances(ctx.session.authToken);

    console.log('Wallet Balances:', balances);
  
    if (!wallets || wallets.length === 0) {
      console.log('No wallets found');
      await ctx.reply('⚠️ No wallets found in your account. Please contact support if you believe this is an error.');
      return;
    }

    const balanceMessage = wallets.map(wallet => {
      if (!wallet || typeof wallet !== 'object') {
        console.error('Invalid wallet object:', wallet);
        return null;
      }
      const usdcBalance = Number(wallet.balance).toFixed(2).toString()
      const networkName = wallet.network || 'Unknown Network';
      const addressLine = '';
      return `${wallet.isDefault ? '✅' : '💰'} <b>${networkName}</b>\nBalance: <b>${usdcBalance} USDC</b>${addressLine}${wallet.isDefault ? '\n<i>Default wallet</i>' : ''}`;
    })
    .filter(msg => msg !== null)
    .join('\n\n');

    if (!balanceMessage) {
      console.log('Failed to generate balance message');
      await ctx.reply('❌ Error formatting wallet information. Please try again later.');
      return;
    }

    const fullMessage = `
<b>Your Wallet Balances</b> 🏦
${balanceMessage}

Use /deposit to get deposit instructions.`;
    
    await ctx.reply(fullMessage, { parse_mode: 'HTML' });
    console.log('Balance message sent successfully');
  } catch (err) {
    const error = err as Error & { 
      response?: { 
        data: any;
        status?: number;
      } 
    };
    console.error('Failed to fetch balances:', {
      message: error.message,
      status: error.response?.status
    });

    if (axios.isAxiosError(error) && error.response?.status === 401) {
      ctx.session = {};
      await ctx.reply('⚠️ Your session has expired. Please /login again.');
    } else {
      await ctx.reply('❌ Failed to fetch balances. Please try again later.');
    }
  }
});

// Set Default Wallet command
bot.command('setdefault', async (ctx) => {
  console.log('Set Default Wallet command triggered');
  if (!ctx.session?.authToken) {
    await ctx.reply('⚠️ Please /login first to set your default wallet.');
    return;
  }

  try {
    const wallets = await api.getWallets(ctx.session.authToken);
    
    if (!wallets || wallets.length === 0) {
      await ctx.reply('⚠️ No wallets found in your account. Please contact support if you believe this is an error.');
      return;
    }

    // Create keyboard with wallet options
    const keyboard = {
      inline_keyboard: wallets.map(wallet => [{
        text: `${wallet.isDefault ? '✅' : '💰'} ${wallet.network} - ${Number(wallet.balance).toFixed(2)} USDC`,
        callback_data: `set_default_${wallet.id}`
      }])
    };

    await ctx.reply(
      '🏦 <b>Select Default Wallet</b>\n\n' +
      'Choose which wallet you want to set as your default:\n' +
      '<i>Current default wallet is marked with ✅</i>',
      { 
        parse_mode: 'HTML',
        reply_markup: keyboard 
      }
    );
  } catch (error) {
    console.error('Error fetching wallets:', error);
    if (axios.isAxiosError(error) && error.response?.status === 401) {
      ctx.session = {};
      await ctx.reply('⚠️ Your session has expired. Please /login again.');
    } else {
      await ctx.reply('❌ Failed to fetch wallets. Please try again later.');
    }
  }
});

// Deposit command
bot.command('deposit', async (ctx) => {
  console.log('Deposit command triggered');
  if (!ctx.session?.authToken) {
    await ctx.reply('Please /login first to make a deposit.');
    return;
  }

  const keyboard = {
    inline_keyboard: [
      [
        { text: 'Salary', callback_data: 'deposit_source_salary' },
        { text: 'Savings', callback_data: 'deposit_source_savings' }
      ],
      [
        { text: 'Lottery', callback_data: 'deposit_source_lottery' },
        { text: 'Investment', callback_data: 'deposit_source_investment' }
      ],
      [
        { text: 'Loan', callback_data: 'deposit_source_loan' },
        { text: 'Business Income', callback_data: 'deposit_source_business_income' }
      ],
      [
        { text: 'Others', callback_data: 'deposit_source_others' }
      ]
    ]
  };

  await ctx.reply('Please select your source of funds:', { reply_markup: keyboard });
});

// History command
bot.command('history', async (ctx) => {
  console.log('History command triggered');
  if (!ctx.session?.authToken) {
    await ctx.reply('Please /login first to view your transaction history.');
    return;
  }

  try {
    console.log('Fetching transaction history');
    const transactions = await api.getTransactionHistory(ctx.session.authToken);

    if (transactions.length === 0) {
      await ctx.reply('No recent transactions found.');
      return;
    }

    const historyMessage = transactions.map(tx => `
${getTransactionEmoji(tx.type)} *${tx.type.toUpperCase()}*
Amount: ${Number(tx.amount) / 10 ** 8} USDC
Status: ${tx.status}
${tx.destinationAccount ? `Recipient: ${tx.destinationAccount.walletAddress}` : ''}
Date: ${new Date(tx.createdAt).toLocaleString()}`).join('\n');

    console.log('Sending transaction history with markdown');
    await ctx.reply(`
*Recent Transactions* 📊
${historyMessage}`, { parse_mode: 'Markdown' });
  } catch (err) {
    const error = err as Error & { response?: { data: any } };
    console.error('Error fetching history:', {
      errorName: error.name,
      errorMessage: error.message,
      errorResponse: error.response?.data,
      errorStack: error.stack
    });

    if (axios.isAxiosError(error) && error.response?.status === 401) {
      ctx.session = {};
      await ctx.reply('Your session has expired. Please /login again.');
    } else {
      await ctx.reply('Failed to fetch transaction history. Please try again later.');
    }
  }
});

// Helper function for transaction emojis
function getTransactionEmoji(type: string): string {
  switch (type.toLowerCase()) {
    case 'deposit': return '⬇️';
    case 'withdrawal': return '⬆️';
    case 'transfer': return '↔️';
    default: return '💱';
  }
}

// Send command
bot.command('send', async (ctx) => {
  console.log('Send command triggered');
  if (!ctx.session?.authToken) {
    await ctx.reply('Please /login first to send funds.');
    return;
  }

  const keyboard = {
    inline_keyboard: [
      [{ text: 'Send to Email', callback_data: 'send_email' }],
      [{ text: 'Send to Wallet', callback_data: 'send_wallet' }],
      [{ text: 'Bulk Transfer', callback_data: 'send_bulk' }]
    ]
  };

  await ctx.reply('How would you like to send funds?', { reply_markup: keyboard });
});

// Bulk transfer command
bot.command('bulk', async (ctx) => {
  console.log('Bulk transfer command triggered');
  if (!ctx.session?.authToken) {
    await ctx.reply('Please /login first to make bulk transfers.');
    return;
  }

  const message = `
<b>📦 Bulk Transfer Instructions</b>

To make bulk transfers, please send a CSV file with the following format:
<code>email,amount</code> or <code>walletAddress,amount,network</code>

Example:
<code>user@example.com,100</code>
<code>0x123...abc,100,polygon</code>

<i>Note: 
• Minimum amount per transfer: 1 USDC
• Maximum transfers per batch: 100
• Supported networks: Polygon, Arbitrum, Base</i>`;

  await ctx.reply(message, { parse_mode: 'HTML' });
});

// Handle file uploads for bulk transfers
bot.on('document', async (ctx) => {
  if (!ctx.session?.authToken) {
    await ctx.reply('Please /login first to make bulk transfers.');
    return;
  }

  const file = ctx.message.document;
  if (!file.file_name?.endsWith('.csv')) {
    await ctx.reply('Please upload a CSV file.');
    return;
  }

  try {
    // Get file from Telegram
    const fileLink = await ctx.telegram.getFileLink(file.file_id);
    if (!fileLink) {
      throw new Error('Could not get file link');
    }

    // Download and process the file
    const response = await axios.get(fileLink.toString());
    const csvContent = response.data;
    const lines = csvContent.split('\n').filter((line: string) => line.trim());

    if (lines.length === 0) {
      await ctx.reply('The CSV file is empty.');
      return;
    }

    if (lines.length > 100) {
      await ctx.reply('Maximum 100 transfers allowed per batch.');
      return;
    }

    const transfers = lines.map((line: string) => {
      const [recipient, amount, network] = line.split(',').map((item: string) => item.trim());
      const transferAmount = (parseFloat(amount) * 10 ** 8).toString();

      if (recipient.includes('@')) {
        return { email: recipient, amount: transferAmount };
      } else {
        return { 
          walletAddress: recipient, 
          amount: transferAmount,
          network: network?.toLowerCase() || 'polygon'
        };
      }
    });

    // Validate transfers
    for (const transfer of transfers) {
      if (parseFloat(transfer.amount) < 10 ** 8) {
        await ctx.reply('Minimum transfer amount is 1 USDC.');
        return;
      }

      if (transfer.walletAddress && !transfer.walletAddress.startsWith('0x')) {
        await ctx.reply('Invalid wallet address format. Must start with 0x.');
        return;
      }
    }

    // Process bulk transfers
    const results = await api.sendBatchTransfers(ctx.session.authToken, transfers);
    
    // Format success message
    const successCount = results.responses.filter(r => r.response).length;
    const failedCount = results.responses.filter(r => r.error).length;

    const message = `
<b>📦 Bulk Transfer Results</b>

✅ Successful transfers: ${successCount}
❌ Failed transfers: ${failedCount}

<i>You will receive notifications for each transfer as they are processed.</i>`;

    await ctx.reply(message, { parse_mode: 'HTML' });
  } catch (error) {
    console.error('Bulk transfer error:', error);
    await ctx.reply('Failed to process bulk transfers. Please check the file format and try again.');
  }
});

// Withdraw command
bot.command('withdraw', async (ctx) => {
  console.log('Withdraw command triggered');
  if (!ctx.session?.authToken) {
    await ctx.reply('Please /login first to withdraw funds.');
    return;
  }

  const keyboard = {
    inline_keyboard: [
      [{ text: 'Withdraw to Bank', callback_data: 'withdraw_bank' }],
      [{ text: 'Withdraw to External Wallet', callback_data: 'withdraw_wallet' }]
    ]
  };

  await ctx.reply('How would you like to withdraw your funds?', { reply_markup: keyboard });
});

// Handle all text inputs
bot.on('text', async (ctx) => {
  // Ignore if it's a command
  if (ctx.message.text.startsWith('/')) {
    return;
  }

  // Handle deposit amount input
  if (ctx.session?.depositStep === 'amount' && ctx.session?.depositSourceOfFunds) {
    let amount = parseFloat(ctx.message.text.trim());

    if (isNaN(amount) || amount <= 0) {
      await ctx.reply('Please enter a valid amount greater than 0.');
      return;
    }

    if (amount < 1) {
      await ctx.reply('Minimum deposit amount is 1 USDC. Please enter a larger amount.');
      return;
    }

    try {
      // Convert amount to the required format (multiply by 10^8)
      const amountInWei = (amount * 10 ** 8).toString();
      
      console.log('Making deposit request with:', {
        amount: amountInWei,
        sourceOfFunds: ctx.session.depositSourceOfFunds,
        depositChainId: 1
      });

      const response = await api.deposit(
        ctx.session.authToken!,
        amountInWei,
        ctx.session.depositSourceOfFunds,
        1399811149 // Solana
      );

      await ctx.reply(`✅ Successfully initiated deposit of ${amount} USDC\n\nPlease complete your deposit at:\n${response}\n\nYou will receive a notification once the deposit is confirmed.`);
      
      // Clear deposit session data
      delete ctx.session.depositStep;
      delete ctx.session.depositSourceOfFunds;
    } catch (error: any) {
      if (axios.isAxiosError(error)) {
        if (error.response?.status === 401) {
          ctx.session = {};
          await ctx.reply('Your session has expired. Please /login again.');
        } else if (error.response?.status === 422) {
          await ctx.reply('Invalid deposit details. Please check the amount and try again.');
        } else {
          await ctx.reply('Failed to process the deposit. Please try again later.');
        }
      } else {
        await ctx.reply('An unexpected error occurred. Please try again later.');
      }
      // Clear deposit session data on error
      delete ctx.session.depositStep;
      delete ctx.session.depositSourceOfFunds;
    }
    return;
  }

  // Handle authentication flow
  if (ctx.session?.awaitingEmail) {
    const email = ctx.message.text.trim();
    
    if (!email.includes('@') || !email.includes('.')) {
      await ctx.reply('Please enter a valid email address.');
      return;
    }

    try {
      const { sid } = await api.requestEmailOTP(email);
      ctx.session = {
        ...ctx.session,
        awaitingEmail: false,
        awaitingOTP: true,
        email: email,
        sid: sid
      };
      
      await ctx.reply('Please enter the OTP sent to your email. The OTP is valid for 5 minutes.');
    } catch (error) {
      if (axios.isAxiosError(error)) {
        if (error.response?.status === 429) {
          await ctx.reply('Too many attempts. Please wait a few minutes before trying again.');
        } else if (error.response?.status === 422) {
          await ctx.reply('Invalid email address. Please check and try again.');
        } else {
          console.error('Error requesting OTP:', error.response?.data);
          await ctx.reply('Failed to send OTP. Please try again later.');
        }
      } else {
        console.error('Error requesting OTP:', error);
        await ctx.reply('An unexpected error occurred. Please try again later.');
      }
      ctx.session.awaitingEmail = false;
    }
    return;
  }

  if (ctx.session?.awaitingOTP && ctx.session?.email && ctx.session?.sid) {
    const otp = ctx.message.text.trim();
    
    if (!/^\d{6}$/.test(otp)) {
      await ctx.reply('Please enter a valid 6-digit OTP.');
      return;
    }

    try {
      const { token, organizationId } = await api.authenticateWithOTP(ctx.session.email, otp, ctx.session.sid);
      
      console.log('Authentication result:', {
        hasToken: !!token,
        tokenPrefix: token ? token.substring(0, 5) + '...' : 'none',
        hasOrgId: !!organizationId,
        organizationId: organizationId || 'missing',
        responseKeys: Object.keys({ token, organizationId })
      });
      
      ctx.session.authToken = token;
      ctx.session.organizationId = organizationId;
      ctx.session.email = ctx.session.email;
      
      // Log the session after updating it
      console.log('Updated session:', {
        hasAuthToken: !!ctx.session.authToken,
        hasOrgId: !!ctx.session.organizationId,
        organizationId: ctx.session.organizationId || 'missing',
        sessionKeys: Object.keys(ctx.session)
      });
      
      delete ctx.session.awaitingOTP;
      delete ctx.session.sid;

      await ctx.reply('Successfully logged in! 🎉\nUse /help to see available commands.');
    } catch (error) {
      if (axios.isAxiosError(error)) {
        if (error.response?.status === 422) {
          await ctx.reply('Invalid or expired OTP. Please use /login to request a new one.');
        } else if (error.response?.status === 429) {
          await ctx.reply('Too many attempts. Please wait a few minutes before trying again.');
        } else {
          console.error('Error authenticating:', error.response?.data);
          await ctx.reply('Authentication failed. Please try again later.');
        }
      } else {
        console.error('Error authenticating:', error);
        await ctx.reply('An unexpected error occurred. Please try again later.');
      }
      ctx.session = {};
    }
    return;
  }

  // Handle transfer flow
  if (!ctx.session?.transferStep) return;

  try {
    console.log('Processing transfer step:', ctx.session.transferStep);
    switch (ctx.session.transferStep) {
      case 'recipient':
        const email = ctx.message.text.trim();
        if (!email.includes('@') || !email.includes('.')) {
          await ctx.reply('Please enter a valid email address.');
          return;
        }
        ctx.session.transferRecipient = email;
        ctx.session.transferStep = 'amount';
        await ctx.reply('Please enter the amount to send (in USDC):');
        break;

      case 'address':
        const address = ctx.message.text.trim();
        const network = ctx.session.network;
        
        console.log('Processing wallet address input:', {
          address,
          network,
        });

        // All networks now use EVM format (0x...)
        const isValidAddress = address.startsWith('0x') && address.length === 42;

        if (!isValidAddress) {
          await ctx.reply(`Please enter a valid ${network} wallet address (must start with 0x and be 42 characters long).`);
          return;
        }

        ctx.session.transferAddress = address;
        ctx.session.transferStep = 'amount';
        await ctx.reply('Please enter the amount to send (in USDC):');
        break;

      case 'amount':
        let amount = parseFloat(ctx.message.text.trim());

        if (isNaN(amount) || amount <= 0) {
          await ctx.reply('Please enter a valid amount greater than 0.');
          return;
        }

        if (amount < 100) {
          await ctx.reply('Minimum withdrawal amount is 100 USDC. Please enter a larger amount.');
          return;
        }

        try {
          const wallets = await api.getWallets(ctx.session.authToken!);
          const defaultWallet = wallets.find(w => w.isDefault) || wallets[0];
          const usdcBalance = defaultWallet.balance;

          if (!usdcBalance) {
            await ctx.reply('Could not fetch your USDC balance. Please try again later.');
            return;
          }

          const currentBalance = parseFloat(usdcBalance);

          if (amount > currentBalance) {
            await ctx.reply(`Insufficient balance. Your current USDC balance is ${currentBalance.toFixed(2)}`);
            return;
          }

          amount = amount * 10 ** 8;

          if (ctx.session.transferType === 'email' && ctx.session.transferRecipient) {
            const emailResponse = await api.sendToEmail(
              ctx.session.authToken!,
              ctx.session.transferRecipient,
              amount.toString()
            );
            await ctx.reply(`✅ Successfully sent ${amount} USDC to ${ctx.session.transferRecipient}`);
          } else if (ctx.session.transferType === 'wallet' && ctx.session.transferAddress) {
            if (!ctx.session.network) {
              await ctx.reply('Network not selected. Please try the transfer again.');
              return;
            }

            let response;
            if (ctx.session.commandType === 'send') {
              response = await api.sendToWallet(
                ctx.session.authToken!,
                ctx.session.transferAddress,
                amount.toString()
              );
              await ctx.reply(`✅ Successfully sent ${amount} USDC to ${ctx.session.network} wallet address: ${ctx.session.transferAddress}`);
            } else if (ctx.session.commandType === 'withdraw') {
              console.log('Initiating withdrawToWallet with params:', {
                address: ctx.session.transferAddress,
                amount: amount.toString(),
                network: ctx.session.network
              });

              try {
                response = await api.withdrawToWallet(
                  ctx.session.authToken!,
                  ctx.session.transferAddress,
                  amount.toString(),
                  ctx.session.network
                );
                console.log('WithdrawToWallet response:', JSON.stringify(response, null, 2));
                await ctx.reply(`✅ Successfully withdrew ${amount} USDC to ${ctx.session.network} wallet address: ${ctx.session.transferAddress}`);
              } catch (error: any) {
                console.error('Detailed withdrawToWallet error:', {
                  message: error.message,
                  status: error.response?.status,
                  statusText: error.response?.statusText,
                  data: error.response?.data,
                  details: error.response?.data?.message || error.response?.data?.details
                });
                throw error;
              }
            }
          } else if (ctx.session.transferType === 'bank') {
            // Store the amount and move to next step
            ctx.session.transferAmount = amount.toString();
            ctx.session.transferStep = 'bank_details';
            
            const keyboard = {
              inline_keyboard: [
                [
                  { text: 'Salary', callback_data: 'source_salary' },
                  { text: 'Savings', callback_data: 'source_savings' }
                ],
                [
                  { text: 'Lottery', callback_data: 'source_lottery' },
                  { text: 'Investment', callback_data: 'source_investment' }
                ],
                [
                  { text: 'Loan', callback_data: 'source_loan' },
                  { text: 'Business Income', callback_data: 'source_business_income' }
                ],
                [
                  { text: 'Others', callback_data: 'source_others' }
                ]
              ]
            };
            
            await ctx.reply('Please select your source of funds:', { reply_markup: keyboard });
            return;
          }

          // Clear transfer session data
          delete ctx.session.transferType;
          delete ctx.session.transferStep;
          delete ctx.session.transferRecipient;
          delete ctx.session.transferAddress;
          delete ctx.session.network;
          delete ctx.session.commandType;
          delete ctx.session.transferAmount;
        } catch (error) {
          if (axios.isAxiosError(error)) {
            if (error.response?.status === 401) {
              ctx.session = {};
              await ctx.reply('Your session has expired. Please /login again.');
            } else if (error.response?.status === 422) {
              await ctx.reply('Invalid transfer details. Please check the amount and recipient details.');
            } else {
              await ctx.reply('Failed to process the transfer. Please try again later.');
            }
          } else {
            await ctx.reply('An unexpected error occurred. Please try again later.');
          }
          // Clear transfer session data on error
          delete ctx.session.transferType;
          delete ctx.session.transferStep;
          delete ctx.session.transferRecipient;
          delete ctx.session.transferAddress;
          delete ctx.session.network;
          delete ctx.session.commandType;
          delete ctx.session.transferAmount;
        }
        break;

      case 'bank_details':
        if (!ctx.session.transferAmount) {
          await ctx.reply('Amount not found. Please start the withdrawal process again.');
          return;
        }

        const callbackQuery = ctx.callbackQuery as any;
        const action = callbackQuery.data;

        // Store the source of funds
        ctx.session.sourceOfFunds = action.replace('source_', '');
        ctx.session.transferStep = 'customer_details';
        
        await ctx.editMessageText('Please enter your full name:');
        break;

      case 'customer_details':
        if (!ctx.session.sourceOfFunds) {
          await ctx.reply('Source of funds not selected. Please start the withdrawal process again.');
          return;
        }

        // Store the customer name
        ctx.session.customerName = ctx.message.text.trim();
        ctx.session.transferStep = 'customer_email';
        
        await ctx.reply('Please enter your email address:');
        break;

      case 'customer_email':
        if (!ctx.session.customerName) {
          await ctx.reply('Name not provided. Please start the withdrawal process again.');
          return;
        }

        const customerEmail = ctx.message.text.trim();
        if (!customerEmail.includes('@') || !customerEmail.includes('.')) {
          await ctx.reply('Please enter a valid email address.');
          return;
        }

        ctx.session.customerEmail = customerEmail;
        ctx.session.transferStep = 'customer_country';
        
        await ctx.reply('Please enter your country of residence:');
        break;

      case 'customer_country':
        if (!ctx.session.customerEmail) {
          await ctx.reply('Email not provided. Please start the withdrawal process again.');
          return;
        }

        const country = ctx.message.text.trim();
        ctx.session.customerCountry = country;

        try {
          const wallets = await api.getWallets(ctx.session.authToken!);
          const defaultWallet = wallets.find(w => w.isDefault) || wallets[0];

          if (!defaultWallet) {
            await ctx.reply('No wallet found. Please try again later.');
            return;
          }

          if (!ctx.session.sourceOfFunds) {
            await ctx.reply('Source of funds not selected. Please start the withdrawal process again.');
            return;
          }

          // Generate a unique invoice number
          const invoiceNumber = `INV-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
          
          // Prepare the bank withdrawal request
          const bankDetails = {
            invoiceNumber,
            invoiceUrl: `https://copperx.io/invoice/${invoiceNumber}`, // This would be a real URL in production
            sourceOfFunds: ctx.session.sourceOfFunds,
            recipientRelationship: 'self',
            quotePayload: 'string', // This would be a real quote payload in production
            quoteSignature: 'string', // This would be a real signature in production
            preferredWalletId: defaultWallet.id,
            customerData: {
              name: ctx.session.customerName!,
              email: ctx.session.customerEmail!,
              country: ctx.session.customerCountry!
            }
          };

          const response = await api.withdrawToBank(
            ctx.session.authToken!,
            ctx.session.transferAmount!,
            bankDetails
          );

          await ctx.reply(`✅ Successfully initiated bank withdrawal for ${parseFloat(ctx.session.transferAmount!) / 10 ** 8} USDC\n\nProcessing time: 1-2 business days\n\nYou will receive a notification once the withdrawal is processed.`);
        } catch (error: any) {
          console.error('Bank withdrawal error:', error);
          await ctx.reply('Failed to process bank withdrawal. Please try again later.');
        } finally {
          // Clear all session data
          delete ctx.session.transferType;
          delete ctx.session.transferStep;
          delete ctx.session.transferAmount;
          delete ctx.session.sourceOfFunds;
          delete ctx.session.customerName;
          delete ctx.session.customerEmail;
          delete ctx.session.customerCountry;
        }
        break;
    }
  } catch (error) {
    console.error('Error in text handler:', error);
    if (axios.isAxiosError(error)) {
      if (error.response?.status === 401) {
        ctx.session = {};
        await ctx.reply('Your session has expired. Please /login again.');
      } else if (error.response?.status === 422) {
        await ctx.reply('Invalid transfer details. Please check and try again.');
      } else {
        await ctx.reply('Failed to process transfer. Please try again later.');
      }
    } else {
      await ctx.reply('An unexpected error occurred. Please try again later.');
    }
    // Clear transfer session data on error
    delete ctx.session.transferType;
    delete ctx.session.transferStep;
    delete ctx.session.transferRecipient;
    delete ctx.session.transferAddress;
    delete ctx.session.network;
    delete ctx.session.commandType;
    delete ctx.session.transferAmount;
  }
});

// Handle callback queries
bot.on('callback_query', async (ctx) => {
  const callbackQuery = ctx.callbackQuery as any;
  const action = callbackQuery.data;

  switch (action) {
    case 'send_email':
      ctx.session = {
        ...ctx.session,
        transferType: 'email',
        transferStep: 'recipient'
      };
      await ctx.editMessageText('📧 Please enter the recipient\'s email address:');
      break;

    case 'send_wallet':
      const networkKeyboard = {
        inline_keyboard: [
          [
            { text: 'Polygon', callback_data: 'network_polygon' }
          ],
          [
            { text: 'Arbitrum', callback_data: 'network_arbitrum' },
            { text: 'Base', callback_data: 'network_base' }
          ]
        ]
      };
      ctx.session = {
        ...ctx.session,
        commandType: 'send'
      };
      await ctx.editMessageText('🌐 Please select the destination network:', { reply_markup: networkKeyboard });
      break;

    case 'withdraw_bank':
      ctx.session = {
        ...ctx.session,
        transferType: 'bank',
        transferStep: 'amount'
      };
      await ctx.editMessageText(`
<b>Bank Withdrawal Instructions</b> 🏦

Please enter the amount you want to withdraw (in USDC).
Minimum withdrawal amount: 100 USDC
Processing time: 1-2 business days

<i>Note: You will need to provide additional details in the next steps.</i>`, { parse_mode: 'HTML' });
      break;

    case 'withdraw_wallet':
      const withdrawNetworkKeyboard = {
        inline_keyboard: [
          [
            { text: 'Polygon', callback_data: 'withdraw_network_polygon' }
          ]
        ]
      };
      ctx.session = {
        ...ctx.session,
        commandType: 'withdraw'
      };
      await ctx.editMessageText('🌐 Please select the destination network:', { reply_markup: withdrawNetworkKeyboard });
      break;

    case 'network_polygon':
    case 'network_arbitrum':
    case 'network_base':
      const network = action.replace('network_', '');
      ctx.session = {
        ...ctx.session,
        transferType: 'wallet',
        transferStep: 'address',
        network: network,
        commandType: 'send'
      };
      await ctx.editMessageText(`📝 Please enter the recipient's <b>${network}</b> wallet address:`, { parse_mode: 'HTML' });
      break;

    case 'withdraw_network_polygon':
      const withdrawNetwork = action.replace('withdraw_network_', '');
      ctx.session = {
        ...ctx.session,
        transferType: 'wallet',
        transferStep: 'address',
        network: withdrawNetwork,
        commandType: 'withdraw'
      };
      await ctx.editMessageText(`📝 Please enter your external <b>${withdrawNetwork}</b> wallet address:`, { parse_mode: 'HTML' });
      break;

    // Deposit source selection handlers
    case 'deposit_source_salary':
    case 'deposit_source_savings':
    case 'deposit_source_lottery':
    case 'deposit_source_investment':
    case 'deposit_source_loan':
    case 'deposit_source_business_income':
    case 'deposit_source_others':
      const sourceOfFunds = action.replace('deposit_source_', '');
      ctx.session = {
        ...ctx.session,
        depositSourceOfFunds: sourceOfFunds,
        depositStep: 'amount'
      };
      await ctx.editMessageText(`
<b>Deposit Instructions</b> 💳

Please enter the amount you want to deposit (in USDC).
Minimum deposit: 1 USDC

<i>Note: The deposit will be processed on the Ethereum network (Chain ID: 1).</i>`, { parse_mode: 'HTML' });
      break;

    // Handle setting default wallet
    case action.match(/^set_default_/)?.input:
      if (!ctx.session?.authToken) {
        await ctx.editMessageText('⚠️ Your session has expired. Please /login again.');
        return;
      }

      const walletId = action.replace('set_default_', '');
      
      try {
        await api.setDefaultWallet(ctx.session.authToken, walletId);
        await ctx.editMessageText('✅ Successfully set your default wallet!');
      } catch (error) {
        console.error('Error setting default wallet:', error);
        if (axios.isAxiosError(error) && error.response?.status === 401) {
          ctx.session = {};
          await ctx.editMessageText('⚠️ Your session has expired. Please /login again.');
        } else {
          await ctx.editMessageText('❌ Failed to set default wallet. Please try again later.');
        }
      }
      break;

    case 'send_bulk':
      await ctx.editMessageText(`
<b>📦 Bulk Transfer Instructions</b>

To make bulk transfers, please send a CSV file with the following format:
<code>email,amount</code> or <code>walletAddress,amount,network</code>

Example:
<code>user@example.com,100</code>
<code>0x123...abc,100,polygon</code>

<i>Note: 
• Minimum amount per transfer: 1 USDC
• Maximum transfers per batch: 100
• Supported networks: Polygon, Arbitrum, Base</i>`, { parse_mode: 'HTML' });
      break;
  }
});

// Handle help command callbacks
bot.action('help_auth', async (ctx) => {
  const message = `
<b>🔐 Authentication Commands</b>

<i>Manage your account access and verification:</i>

• <b>/login</b> - Login to your Copperx account
  - Enter your email
  - Receive verification code
  - Access your wallet

• <b>/logout</b> - Logout from your account
  - Securely end your session
  - Clear all temporary data

• <b>/status</b> - Check your KYC/KYB status
  - View verification progress
  - Check account details
  - See wallet information

<i>Need help with authentication? Contact our support team.</i>`;

  const keyboard = {
    inline_keyboard: [
      [{ text: '⬅️ Back to Main Menu', callback_data: 'help_main' }]
    ]
  };

  await ctx.editMessageText(message, { 
    parse_mode: 'HTML',
    reply_markup: keyboard 
  });
});

bot.action('help_wallet', async (ctx) => {
  const message = `
<b>💰 Wallet Commands</b>

<i>Manage your digital assets:</i>

• <b>/balance</b> - View your wallet balances
  - Check USDC balance
  - View multiple wallets
  - See transaction history

• <b>/deposit</b> - Get deposit instructions
  - Choose deposit method
  - Get wallet address
  - View minimum amounts

<i>Your funds are secure with Copperx's advanced security measures.</i>`;

  const keyboard = {
    inline_keyboard: [
      [{ text: '⬅️ Back to Main Menu', callback_data: 'help_main' }]
    ]
  };

  await ctx.editMessageText(message, { 
    parse_mode: 'HTML',
    reply_markup: keyboard 
  });
});

bot.action('help_transfer', async (ctx) => {
  const message = `
<b>💸 Transfer Commands</b>

<i>Send and receive funds:</i>

• <b>/send</b> - Send funds
  - Send to email
  - Send to wallet
  - Choose network

• <b>/withdraw</b> - Withdraw funds
  - Withdraw to bank
  - Withdraw to wallet
  - Select amount

<i>All transfers are secure and tracked.</i>`;

  const keyboard = {
    inline_keyboard: [
      [{ text: '⬅️ Back to Main Menu', callback_data: 'help_main' }]
    ]
  };

  await ctx.editMessageText(message, { 
    parse_mode: 'HTML',
    reply_markup: keyboard 
  });
});

bot.action('help_history', async (ctx) => {
  const message = `
<b>📊 Transaction History</b>

<i>Track your financial activity:</i>

• <b>/history</b> - View transactions
  - See recent transfers
  - Check deposit status
  - Monitor withdrawals

<i>Keep track of all your financial activities in one place.</i>`;

  const keyboard = {
    inline_keyboard: [
      [{ text: '⬅️ Back to Main Menu', callback_data: 'help_main' }]
    ]
  };

  await ctx.editMessageText(message, { 
    parse_mode: 'HTML',
    reply_markup: keyboard 
  });
});

bot.action('help_support', async (ctx) => {
  const message = `
<b>❓ Support & Help</b>

<i>Get assistance when you need it:</i>

• <b>Community Support</b>
  Join our Telegram community: <a href="https://t.me/copperxcommunity/2183">Copperx Community</a>

• <b>Security Tips</b>
  - Never share your password
  - Keep your email secure
  - Enable 2FA when available

• <b>Need More Help?</b>
  Contact our support team through the community channel.

<i>We're here to help you succeed!</i>`;

  const keyboard = {
    inline_keyboard: [
      [{ text: '⬅️ Back to Main Menu', callback_data: 'help_main' }]
    ]
  };

  await ctx.editMessageText(message, { 
    parse_mode: 'HTML',
    reply_markup: keyboard 
  });
});

// Add handler for back to main menu
bot.action('help_main', async (ctx) => {
  const keyboard = {
    inline_keyboard: [
      [
        { text: '🔐 Authentication', callback_data: 'help_auth' },
        { text: '💰 Wallet', callback_data: 'help_wallet' }
      ],
      [
        { text: '💸 Transfer', callback_data: 'help_transfer' },
        { text: '📊 History', callback_data: 'help_history' }
      ],
      [
        { text: '❓ Support', callback_data: 'help_support' }
      ]
    ]
  };

  const helpMessage = `
<b>🤖 Copperx Payout Bot Help</b>

<i>Select a category below to learn more:</i>

🔐 <b>Authentication</b>
• /login - Login to your account
• /logout - Logout from your account
• /status - Check your KYC/KYB status

💰 <b>Wallet</b>
• /balance - View your wallet balances
• /deposit - Get deposit instructions
• /setdefault - Set your default wallet

💸 <b>Transfer</b>
• /send - Send funds to email or wallet
• /withdraw - Withdraw funds to bank account
• /bulk - Make bulk transfers via CSV

📊 <b>History</b>
• /history - View transaction history

❓ <b>Support</b>
Need help? Visit our community: <a href="https://t.me/copperxcommunity/2183">Copperx Community</a>

<i>For security, never share your password or sensitive information.</i>`;

  await ctx.editMessageText(helpMessage, { 
    parse_mode: 'HTML',
    reply_markup: keyboard 
  });
});


// Handle errors
bot.catch((err, ctx) => {
  console.error('Bot error:', err);
  ctx.reply('An error occurred. Please try again later or contact support.');
});

// Set bot commands
async function setBotCommands() {
  await bot.telegram.setMyCommands([
    { command: 'start', description: 'Start the bot' },
    { command: 'login', description: 'Login to your Copperx account' },
    { command: 'logout', description: 'Logout from your account' },
    { command: 'help', description: 'Show available commands' },
    { command: 'status', description: 'Check your KYC/KYB status' },
    { command: 'balance', description: 'View your wallet balances' },
    { command: 'deposit', description: 'Get deposit instructions' },
    { command: 'setdefault', description: 'Set your default wallet' },
    { command: 'send', description: 'Send funds to email or wallet' },
    { command: 'withdraw', description: 'Withdraw funds to bank account' },
    { command: 'history', description: 'View transaction history' },
    { command: 'bulk', description: 'Make bulk transfers via CSV' }
  ]);
  console.log('Bot commands registered');
}

// Start bot
async function startBot() {
  try {
    // Initialize database before starting the bot
    await initializeDatabase();

    // Initialize notifications
    setupNotifications(bot, api);
    
    // Register debug command
    registerDebugCommand(bot, api);
    
    // Register commands
    await setBotCommands();
    
    await bot.launch();
    console.log('Bot is running...');
  } catch (error) {
    console.error('Failed to start bot:', error);
    process.exit(1);
  }
}

startBot();

// Enable graceful stop
process.once('SIGINT', () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM')); 