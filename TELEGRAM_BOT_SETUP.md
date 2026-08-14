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
GITHUB_TOKEN=github_pat_with_repo_and_actions_workflow_scope
GITHUB_OWNER=your_github_owner_or_org
GITHUB_REPO=your_default_repo
GITHUB_DEPLOY_WORKFLOW=deploy.yml
APP_HEALTH_URL=https://your-app.example.com/health
```

### 3. Set Webhook

After deploying to Cloudflare, register the webhook with Telegram:

```bash
curl -X POST https://api.telegram.org/bot{YOUR_BOT_TOKEN}/setWebhook \
  -H 'Content-Type: application/json' \
  -d '{"url": "https://layerrunner.your-domain.com/telegram/webhook"}'
```

### 4. Verify Setup

Send `/start` to your bot on Telegram. It should return supported commands. Then try `show production status` or `deploy latest to staging`.

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

## Implemented Bot Actions

- `/start` and `/help` show supported commands and required configuration.
- `show production status` checks the configured GitHub repository, recent Actions runs, deployments, and optional `APP_HEALTH_URL`.
- `why did my last deployment fail?` summarizes recent workflow and deployment data for diagnosis.
- `deploy latest to staging` creates an approval prompt, then dispatches `GITHUB_DEPLOY_WORKFLOW` through the GitHub Actions workflow dispatch API after approval.
- `list GitHub repos`, repository details, deployment lists, and approved repository creation are backed by GitHub API calls.

## Notes and Next Steps

1. Give `GITHUB_TOKEN` the least privilege needed for the actions you enable, including `actions:write` for deployment workflow dispatch.
2. Keep approval storage in mind: approval requests are currently in Worker memory and can be replaced with KV/D1 if callbacks must survive isolate eviction.
3. Add Supabase/Cloudflare-specific runners before advertising those actions as fully executable.

## Deployment

```bash
# Install dependencies
npm install

# Test locally
npm run dev:worker

# Deploy to Cloudflare
npm run deploy:worker
```
