# Layer Runners - Telegram Bot Setup

## Quick Start

### 1. Create a Telegram Bot

1. Open Telegram and message [@BotFather](https://t.me/botfather)
2. Send `/newbot`
3. Follow the prompts to create your bot
4. Copy the **API Token** (looks like `123456789:ABCdefGHIjklmNOPqrsTUVwxyzABCDefGHI`)

### 2. Configure Environment

Create a `.env.local` file or set in your Cloudflare Worker secrets:

```bash
# Telegram Bot Token
TELEGRAM_BOT_TOKEN=your_bot_token_here
```

### 3. Set Webhook

After deploying to Cloudflare, register the webhook with Telegram:

```bash
curl -X POST https://api.telegram.org/bot{YOUR_BOT_TOKEN}/setWebhook \
  -H 'Content-Type: application/json' \
  -d '{"url": "https://layerrunner.your-domain.com/telegram/webhook"}'
```

### 4. Verify Setup

Send a test message to your bot on Telegram. It should respond with an intent analysis and execution plan.

## Architecture

- **Worker**: Entry point for Telegram webhooks (Cloudflare)
- **Intent Parser**: Analyzes user messages and extracts intent type
- **Planner**: Generates execution plans based on intent
- **Message Handler**: Orchestrates the flow and formats responses

## Intent Types

- **query**: Information retrieval (show status, list projects, etc.)
- **action**: Operations that create/modify resources (deploy, create, update)
- **diagnostic**: Troubleshooting and investigation (why failed, investigate error)
- **unknown**: Requests that need clarification

## Example Commands

- "Show me production status"
- "Deploy the latest version to staging"
- "Why did my last deployment fail?"
- "Create a new GitHub repository called MyProject"
- "Add a Stripe subscription field to the users table"

## Next Steps

1. Implement actual service integrations (GitHub API, Supabase, Cloudflare API)
2. Add approval workflow for sensitive operations
3. Build action execution engine
4. Add persistent state/database for conversations
5. Implement Telegram keyboard shortcuts and inline buttons
6. Add rich message formatting
7. Set up audit logging

## Deployment

```bash
# Install dependencies
npm install

# Test locally
npm run dev:worker

# Deploy to Cloudflare
npm run deploy:worker
```
