## What this is

Layer Runners is an AI operator for your stack: a Telegram bot and a web
chat (layerrunners.xyz/chat) that take plain-English requests and plan,
request approval when needed, and execute actions against GitHub (status
checks, diagnostics, deploys, repo creation), on Cloudflare Workers.
Usage is metered in LYR, a TON jetton sold through a deployed sale
contract, with a free trial credit on signup.

### Stack
- **Language(s):** TypeScript (Worker + core logic), Tolk (LYR sale contract), React/TSX (Next.js pages)
- **Runtime:** Cloudflare Workers (`wrangler`) for the API, Next.js static export on Cloudflare Pages for the site
- **Storage:** Durable Objects (`LEDGER` per-user state, `APPROVALS` per-request state), SQLite-backed
- **Notable libraries:** itty-router v5 (Worker routing), `@tonconnect/ui-react` + `@ton/core` (wallet-connect flows on the site)

## How it's organized

```
src/
  worker.ts              Cloudflare Worker entry point (itty-router routes)
  config.ts               Env bindings/secrets
  core/
    identity.ts            channel-qualified identity + per-user DO addressing
    chat-engine.ts          the shared intent -> plan -> gate -> approval-or-execute pipeline
    intent-parser.ts        classify a message (query / action / diagnostic)
    planner.ts               turn an intent into ExecutionSteps, with StepRef node-linking between steps
    approval.ts               approval request store (identity + optional Telegram chatId)
    profile.ts                 UserProfile, roles (deployer/watcher/reviewer), onboarding state
    metering.ts                 LYR balance, reserve/commit/release, fee table
    user-secrets.ts              per-user encrypted secrets (e.g. personal GitHub token)
    secrets-crypto.ts             AES-256-GCM via native Web Crypto
    session.ts                    HMAC-signed web session cookies
    telegram-login.ts              Telegram Login Widget HMAC verification
    wallet-link.ts                  linked-wallet vault-deposit reconciliation
    markdown.ts                      Telegram Markdown escaping
  telegram/
    webhook.ts, message-handler.ts, callback-handler.ts, onboarding.ts, api.ts, types.ts
  auth/
    routes.ts               /auth/telegram/callback, /api/session, /auth/logout
  api/
    routes.ts               /api/chat, /api/approve (web chat, same pipeline as Telegram)
  services/
    github.ts                GitHub API client (typed GitHubApiError on failure)
    executor.ts                runs ExecutableActions, resolves StepRefs between steps
    ton.ts                       TonCenter client (LYR balance, vault deposit detection)
    ai-provider.ts                 intent-parsing model provider

app/                       Next.js pages (static export): / (landing + buy LYR),
                            /login (Telegram Login Widget), /chat (web chat),
                            /admin-deploy, /admin-collect (temporary, wallet-connect admin actions)
contracts/                 lyr-sale.tolk (deployed LYR sale contract) + test jettons
test/                      sandbox tests for the sale contract (npx jest test/lyr-sale.test.js)
docs/web-login-plan.md     status + remaining phases of the web login/chat effort
CHANGELOG.md                release notes
CODEX.md                    original full product/architecture spec
```

## How it fits together

Telegram updates hit `/telegram/webhook`; web chat hits `POST /api/chat`
after logging in at `/login`. Both paths resolve a channel-qualified
`identity` (`core/identity.ts`) and hand off to
`core/chat-engine.ts::runChatEngine`, which parses intent, generates a
plan (`core/planner.ts`), checks role + reserves the LYR fee
(`core/metering.ts`), and either creates an approval request
(`core/approval.ts`) or executes immediately
(`services/executor.ts` → `services/github.ts`). Approve/reject (button
tap in Telegram, or `POST /api/approve` on web) both resolve through
`core/chat-engine.ts::resolveApproval`.

## Setup

1. Install
   ```bash
   npm install
   ```

2. Secrets (production) — set via `wrangler secret put <NAME> --env production`:
   - `TELEGRAM_BOT_TOKEN`, `GITHUB_TOKEN`, `GITHUB_OWNER`, `GITHUB_REPO`
   - `GITHUB_REPO_BRANCH`, `GITHUB_DEPLOY_WORKFLOW` (optional)
   - `TONCENTER_API_KEY`, `VAULT_JETTON_WALLET`, `JETTON_ADDRESS` (LYR economy)
   - `SECRETS_ENCRYPTION_KEY` (per-user secret encryption — required for `/connect_github` to work)
   - `SESSION_SIGNING_KEY` (web login sessions — required for `/login` to work)
   - `APP_HEALTH_URL` (optional, shown in `project_status`)

3. Type-check
   ```bash
   npm run typecheck
   ```

4. Local Worker dev
   ```bash
   npx wrangler dev
   ```

5. Build the site
   ```bash
   npm run build
   ```

## Deploy

```bash
# Worker (API)
npx wrangler deploy --env production

# Site (Next.js static export)
npm run deploy:pages
```

Dry-run first if you want to confirm bindings/routes without shipping:
```bash
npx wrangler deploy --dry-run --env production
```

## Telegram bot setup

1. Message [@BotFather](https://t.me/botfather), `/newbot`, copy the token into `TELEGRAM_BOT_TOKEN`.
2. After deploying, hit `GET /init` once (uses `TELEGRAM_BOT_TOKEN`) to register the webhook.
3. For the web Login Widget to work: message BotFather, `/setdomain`, point it at `layerrunners.xyz`.
4. Send `/start` to the bot to confirm it's alive.

## Health/check endpoints

- `GET /health` — basic status
- `GET /api/session` — current web session (identity/profile/balance), `{ ok: false }` if not logged in

## More detail

- [`docs/web-login-plan.md`](docs/web-login-plan.md) — web login/chat design decisions and phase status
- [`CHANGELOG.md`](CHANGELOG.md) — release notes
- [`CODEX.md`](CODEX.md) — original full product/architecture spec
