## What this is
Layer Runners is an AI-powered operations platform that exposes a Telegram bot and Cloudflare Worker to let operators describe tasks in natural language and have the system plan, request approval if necessary, and execute actions (currently focused on GitHub operations). It’s intended for developers/teams who want to automate operational workflows via Telegram and extend the system with new service integrations.

### Stack
- **Language(s):** TypeScript (primary), CSS (for pages), small JS surface
- **Framework / runtime:** Cloudflare Workers (wrangler) + Next.js (Pages deployment)
- **Notable libraries:** itty-router (routing in worker), wrangler (Cloudflare tooling), Next.js + React (front-end/pages)

## How it's organized
Top-level sketch:
```
.app/                (app-specific static assets / Next output - present but not primary)
assets/              (static assets used by pages)
lib/                 (supporting libraries / utilities)
src/                 TypeScript source for Worker, Telegram handlers, core logic, and services
  worker.ts          Cloudflare Worker entry point (itty-router)
  config.ts          environment configuration
  telegram/
    webhook.ts       webhook handler that receives Telegram updates
    message-handler.ts orchestration that formats responses & drives flow
    api.ts           Telegram API client utilities
    types.ts         Type definitions for Telegram objects
  core/
    intent-parser.ts classify and extract intent from messages
    planner.ts       plan generator (risk assessment, steps)
    approval.ts      approval workflow (in-memory store currently)
  services/
    github.ts        GitHub integration (list/create repos, deployments)
    executor.ts      action dispatch / execution engine
package.json         build/dev/deploy scripts (next, wrangler)
wrangler.toml        Cloudflare Worker configuration + routes/envs
DEVELOPMENT.md       developer guide and project structure
TELEGRAM_BOT_SETUP.md bot setup instructions
README_TELEGRAM_BOT.md brief bot entry-point notes
.env.example         environment variable template
CHANGELOG.md         release notes and architecture highlights
```

How it fits together:
- Incoming Telegram updates hit the worker (src/worker.ts → /telegram/webhook). webhook.ts extracts messages and immediately returns OK while delegating processing to message-handler.ts. The core modules (intent-parser.ts, planner.ts, approval.ts) convert text into an execution plan; services/executor.ts dispatches actions (e.g., via src/services/github.ts). Next.js is used for pages deployment; wrangler handles Worker deployment and secrets.

## How to run it
Shortest path from a fresh clone to local development and deploy:

1) Install
```bash
npm install
```

2) Type-check
```bash
npm run typecheck
```

3) Local Worker development (requires wrangler installed / logged in)
```bash
npm run dev:worker
# or, to run wrangler directly:
npx wrangler dev
```

4) Build Next pages
```bash
npm run build
```

5) Configure secrets (example)
```bash
wrangler secret put TELEGRAM_BOT_TOKEN
wrangler secret put GITHUB_TOKEN
# set GITHUB_OWNER via wrangler or env for each stage
```

6) Deploy
```bash
# Deploy Worker (API)
npm run deploy:worker

# Deploy Pages (static/front-end)
npm run deploy:pages
```

Notes on required env vars (from DEVELOPMENT.md / .env.example):
- TELEGRAM_BOT_TOKEN
- GITHUB_TOKEN
- GITHUB_OWNER
- ENVIRONMENT is set per wrangler.toml environments (production/staging/development)

Health/check endpoints:
- GET /health → basic status
- GET /init → helper to call Telegram setWebhook (one-time use; uses TELEGRAM_BOT_TOKEN)

## Try asking
- "Can you move the in-memory approval store in src/core/approval.ts into D1/Supabase and update the ENV and wrangler.toml settings required for migrations?"
- "Could you add a top-level README.md that summarizes the Telegram bot flow, the Pages site, the required env vars, and the single-command deploy steps (referencing src/worker.ts and wrangler.toml)?"
- "Is intent parsing in src/core/intent-parser.ts wired to an LLM backend yet, or should we add a sample integration (Claude/GPT) and configuration examples in DEVELOPMENT.md?"

