# Copperx Telegram Bot

A Telegram bot for Copperx Payout integration, built with TypeScript and Node.js.

## Features

- Telegram bot integration using Telegraf
- PostgreSQL database integration
- Real-time updates using Pusher
- Copperx API integration
- TypeScript support for better type safety

## Prerequisites

- Node.js (v14 or higher)
- PostgreSQL database
- Telegram Bot Token (from [@BotFather](https://t.me/botfather))
- Copperx API credentials
- Pusher account

## Installation

1. Clone the repository:
```bash
git clone https://github.com/yourusername/copperx-telegram-bot.git
cd copperx-telegram-bot
```

2. Install dependencies:
```bash
npm install
```

3. Create a `.env` file:
```bash
cp .env.example .env
```

4. Configure your environment variables in the `.env` file:
```env
# Bot Configuration
BOT_TOKEN=your_telegram_bot_token

# Copperx API Configuration
COPPERX_API_URL=your_api_url

# Pusher Configuration
PUSHER_KEY=your_pusher_key
PUSHER_CLUSTER=your_pusher_cluster

# Database Configuration
DATABASE_URL=postgresql://user:password@host:port/database?sslmode=require
```

## Development

To run the bot in development mode:
```bash
npm run dev
```

## Building

To build the TypeScript code:
```bash
npm run build
```

## Production

To run the bot in production:
```bash
npm run build
npm start
```

## Scripts

- `npm run build` - Compiles TypeScript to JavaScript
- `npm start` - Runs the compiled JavaScript code
- `npm run dev` - Runs the TypeScript code directly using ts-node
- `npm run lint` - Runs ESLint to check code quality

## Project Structure

```
copperx-telegram-bot/
├── src/           # Source code
├── assets/        # Static assets
├── dist/          # Compiled JavaScript
├── .env           # Environment variables
├── .env.example   # Example environment variables
├── package.json   # Project dependencies and scripts
└── tsconfig.json  # TypeScript configuration
```

## Contributing

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add some amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

## License

This project is licensed under the ISC License.
