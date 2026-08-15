# Changelog

## [0.4.1] - 2026-08-15

### Buy-LYR Widget: Fixed Short-Payout Bug

#### Fixed
- 🐛 Buying LYR with TON paid out less than advertised (e.g. 1 TON → 90 LYR instead of the advertised 100). Root cause: `contracts/lyr-sale.tolk`'s `buyWithTon` subtracts a flat 0.1 TON reserve (gas + outgoing transfer's forward value) from the message value *before* applying the rate, and the widget was only sending the buyer's intended spend amount with no reserve on top — every purchase was silently shortchanged by `0.1 TON * lyrPerTon` worth of LYR. This is a live mainnet contract with no upgrade path, so instead of a redeploy, `lib/components/buy-lyr-widget.tsx` now sends `(chosen TON amount) + TON_PURCHASE_RESERVE_NANO` (new constant in `lib/ton-config.ts`, must track the contract's `TON_PURCHASE_RESERVE`), so the contract's `netValue` lands exactly on what the buyer meant to spend. The widget also now discloses the actual total TON the wallet will be asked to send, not just the pre-reserve estimate.

## [0.4.0] - 2026-08-15

### GitHub/Google Login, Homepage Web-Chat Visibility

#### Added

- ✅ "Continue with GitHub" and "Continue with Google" on `/login`, alongside the existing Telegram Login Widget — standard OAuth2 authorization-code flow with CSRF-protected state cookies (`src/auth/routes.ts`). Identity-only (`read:user` / `openid email profile` scopes) — these are separate new accounts (`gh:<id>`, `google:<sub>`), not merged with an existing Telegram identity, and don't grant repo access (`/connect_github` is still the only path to that).
- ✅ Homepage now actually surfaces both ways in: a "Sign in" nav link, a "Try the web chat" primary hero CTA, and the former Telegram-only section is now a combined Chat section explaining both Telegram and web login (including that Telegram login carries over existing balance/profile with zero setup).

#### Changed
- `core/identity.ts` gains `githubIdentity`/`googleIdentity` alongside `telegramIdentity`; `docs/web-login-plan.md` phases 4 and 5 marked done.

## [0.3.0] - 2026-08-15

### Web Login & Chat, Shared Execution Pipeline

#### Added

**Web login**
- ✅ `/login` — Telegram Login Widget, verified server-side against Telegram's documented HMAC algorithm; resolves to the exact same identity/`LEDGER` object the bot already uses, so an existing Telegram user's balance, profile, and linked wallet show up on web immediately, no migration step
- ✅ HMAC-signed session cookie (`core/session.ts`), same native-`crypto.subtle` approach as secret encryption — no new dependency; quietly reissued past half-life so an active session never hits a hard logout
- ✅ `layerrunners.xyz/auth/*` and `/api/*` now route to the Worker (`wrangler.toml`), alongside the existing `/telegram/webhook`

**Web chat**
- ✅ `/chat` — mirrors the bot: send plain-English requests, see the plan, approve/reject when a request needs sign-off, balance shown with a link to buy more
- ✅ `POST /api/chat` and `POST /api/approve` drive the *same* intent → plan → role/metering gate → approval-or-execute pipeline as the Telegram bot (`core/chat-engine.ts`, extracted from `telegram/message-handler.ts`) — no duplicated logic between channels
- ✅ New (non-Telegram) identities get a profile with safe defaults — Watcher (read-only) role, same free trial credit — instead of a forced setup wizard, since nobody explicitly chose a role the way the Telegram wizard requires

**Node-linking execution (n8n-style)**
- ✅ A plan step's params can now reference an earlier step's output (`StepRef`: `{ $stepRef, path }`), resolved by the executor immediately before that step runs — steps are no longer isolated, blind calls
- ✅ First real use: deploying with no explicit branch/ref now looks up the repo's actual default branch and links it in, instead of guessing `'main'`

#### Fixed

- 🐛 Telegram's legacy Markdown parser rejects an entire message on any single unescaped `_`/`*`/`` ` ``/`[` — the CI workflow run URL in `project_status`/diagnose output was interpolated unescaped, and GitHub URLs routinely contain underscores. Fixed the specific field, and made the underlying send resilient generally: a Markdown parse error now retries once as plain text instead of the message silently failing behind a generic error.
- 🐛 GitHub API failures (bad/expired token, repo not found or inaccessible, rate limiting) now translate into specific, actionable chat responses (e.g. "reconnect via `/connect_github`") instead of a raw status-code dump — `GitHubService` throws a typed `GitHubApiError` (status/path/body) that the formatting layer classifies.

#### Changed
- `ApprovalRequest` generalized from a Telegram-only `userId`/`chatId` to `identity` (string, any channel) + optional `chatId` (Telegram-only, for notifying the originating chat) — needed so the chat engine can create approval requests for web-originated actions too. Includes a migration shim for any request already in flight at deploy time.
- Approve/reject resolution (permission check, reservation release/commit, execution, result formatting) extracted out of `telegram/callback-handler.ts` into `core/chat-engine.ts::resolveApproval`, shared by the Telegram inline-keyboard flow and the new `/api/approve` route.

## [0.2.0] - 2026-08-15

### Production Recovery, User Profiles, and the LYR Token Economy

#### Fixed

**Critical production outage**
- 🐛 A prior merge (`a89d83b`) silently reverted 15 files to an early draft state while claiming to only touch `wrangler.toml` — dropped the `itty-router` dependency (Worker couldn't build), reverted `message-handler.ts`/`planner.ts`/`executor.ts`/`github.ts`/etc. to a disconnected stub with no real GitHub calls or `/start` handling, and downgraded docs/site copy. Restored all clobbered files to the last known-good commit.
- 🐛 A competing fix landed on `main` independently mid-recovery (`1f3f1e8`) with its own `approval-store.ts` and `Env` type; reconciled the two — kept the more complete existing `core/approval.ts` (already matched `message-handler.ts`'s calling convention, had fee display the other lacked) and removed the duplicate.
- 🐛 `itty-router` v4→v5 bump broke every request: `worker.ts` still called `router.handle`, which v5 silently repurposes as route registration instead of dispatching — confirmed live via `wrangler tail` (`Callback returned incorrect type; expected 'Promise'`). Fixed to `router.fetch`; removed a stale hand-written `itty-router.d.ts` shim (dated to v4, which shipped no types) that was shadowing v5's real types and hiding the mismatch from `tsc`.
- 🐛 Telegram's legacy Markdown parse mode rejects an entire message on any single unescaped `_`, `*`, `` ` ``, or `[` — GitHub repo names/descriptions and raw user input were going into Markdown-formatted messages unescaped, causing silent generic-error failures (e.g. `show production status` on any repo with an underscore in its name). Added a shared `escapeMarkdown` helper, applied wherever dynamic text — including TON addresses, which routinely contain `_`/`-` — gets interpolated.
- 🐛 Missing/misplaced secrets (`TELEGRAM_BOT_TOKEN`, `GITHUB_TOKEN`, `GITHUB_OWNER`, `GITHUB_REPO`) reset on the correct Worker (`layerrunner-prod`, the one actually bound to the live domain route — distinct from an orphaned top-level `layerrunner` Worker some secrets had landed on by mistake).

#### Added

**User profiles & permissions**
- ✅ First-run setup flow (`/start` for new users): display name → role → default repo, stored per Telegram user ID in the existing `LEDGER` durable object (no new binding needed)
- ✅ Three roles: **Deployer** (full access), **Watcher** (read-only), **Reviewer** (read-only, plus can approve/reject other users' pending requests)
- ✅ `/profile` — shows role, default repo, and live LYR balance
- ✅ Per-user `defaultRepo` now backfills commands that don't name a repo explicitly, on top of the global `GITHUB_REPO` fallback
- ✅ Every new profile is credited 100 LYR of free trial balance at setup, spent down through the normal metering flow like any paid balance

**LYR token economy**
- ✅ `contracts/lyr-sale.tolk` — sells LYR from a pre-funded vault at a fixed TON rate (100:1 default, admin-adjustable) or via admin-approved jettons at admin-set rates; 10 sandbox tests covering both purchase paths, pause, admin auth, and rejection of unapproved/disabled jettons
- ✅ Deployed and verified live: admin address, LYR master, rate, and derived vault wallet all confirmed against on-chain state (not assumed)
- ✅ TON Connect wallet integration on layerrunners.xyz: public "Buy LYR" widget, and a temporary `/admin-deploy` page + bot `/deploy` command (gated to Deployer role) that sends the contract's real deploy transaction — no deployer private key ever touches this codebase
- ✅ `/start` and `/help` now explain LYR pricing properly: free for chat/help, scales with the work a request does, where to buy more

#### Changed
- Onboarding and profile copy reworked from RPG "character creation" framing to a plainer setup-questionnaire tone (same underlying flow, different words)

## [0.1.0] - 2026-08-14

### Initial Product Foundation - Telegram Bot Infrastructure

#### Added

**Core Infrastructure**
- ✅ Cloudflare Worker setup with multi-environment configuration (production, staging, development)
- ✅ `wrangler.toml` with proper routing and environment variable management
- ✅ Secure secret management via `wrangler secret put` (no credentials in code)

**Telegram Integration**
- ✅ Webhook handler for receiving Telegram updates (`src/telegram/webhook.ts`)
- ✅ Telegram API client for sending messages (`src/telegram/api.ts`)
- ✅ Type definitions for Telegram objects (`src/telegram/types.ts`)
- ✅ Message handler orchestration layer (`src/telegram/message-handler.ts`)
- ✅ Auto-initialization endpoint (`/init`) for webhook setup

**AI Orchestration Engine**
- ✅ Intent parser (`src/core/intent-parser.ts`) - Classifies user requests:
  - `query`: Information retrieval (show status, list projects)
  - `action`: Operations that modify resources (create, deploy, update)
  - `diagnostic`: Troubleshooting (why failed, investigate)
  - `unknown`: Requests needing clarification
- ✅ Execution planner (`src/core/planner.ts`) - Generates action steps with:
  - Risk assessment (low/medium/high)
  - Human approval requirements
  - Duration estimation
- ✅ Approval workflow system (`src/core/approval.ts`):
  - Request tracking with 15-minute expiration
  - Risk-based approval prompts
  - Approval/rejection handling

**Service Integration Framework**
- ✅ GitHub API integration (`src/services/github.ts`):
  - List repositories
  - Create repositories
  - Get repository details
  - Retrieve deployment history
- ✅ Action executor framework (`src/services/executor.ts`):
  - Extensible action dispatcher
  - Error handling and result capture
  - Execution timing

**Development & Documentation**
- ✅ `DEVELOPMENT.md` - Architecture overview and development guide
- ✅ `TELEGRAM_BOT_SETUP.md` - Bot setup and configuration instructions
- ✅ `.env.example` - Environment configuration template
- ✅ Comprehensive TypeScript types and interfaces
- ✅ Package.json scripts:
  - `npm run dev:worker` - Local development
  - `npm run deploy:worker` - Deploy to Cloudflare
  - `npm run typecheck` - TypeScript validation

**Deployment**
- ✅ Worker deployed to: `https://layerrunner.lockloke50.workers.dev`
- ✅ Pages deployed to: `https://3f2565f6.layerrunner-xyz.pages.dev`
- ✅ Webhook initialized and ready to receive Telegram messages

#### Architecture Highlights

**Core Flow**
```
User Message → Webhook Handler → Intent Parser → Plan Generator 
→ Approval Decision → Action Executor → Response Formatter → Telegram API
```

**Security**
- 🔒 Secrets stored securely in Cloudflare Secrets Store
- 🔒 No credentials in codebase or .env files
- 🔒 .gitignore properly configured
- 🔒 Token rotation ready (update via `wrangler secret put`)

**Extensibility**
- Ready to add: Supabase, Stripe, Cloudflare API integrations
- Plugin architecture for new services
- Intent pattern matching system for new request types

#### Next Steps (Phase 2)

1. **Data Integration**
   - Supabase integration for persistent storage
   - D1 or Supabase for approval workflow state
   - User/project management

2. **Enhanced Intelligence**
   - LLM-powered intent parsing (Claude/GPT)
   - Natural language plan generation
   - Context awareness across conversations

3. **User Experience**
   - Telegram inline buttons for approval workflow
   - Rich message formatting with status updates
   - Conversation context tracking

4. **Operations**
   - Audit logging system
   - Action result verification
   - Error recovery and retry logic
   - Status monitoring and alerts

5. **Service Coverage**
   - Complete GitHub API coverage (issues, PRs, workflows)
   - Supabase database operations
   - Cloudflare Workers and KV operations
   - Stripe subscription management

#### Security Checklist ✅

- [x] No secrets in git repository
- [x] .gitignore properly configured
- [x] Environment variables documented
- [x] Secrets using Cloudflare Secrets Store
- [x] .env.example template created
- [x] Token access control ready for implementation

#### Deployment Instructions

**First Time Setup:**
```bash
# Install dependencies
npm install

# Store bot token securely
wrangler secret put TELEGRAM_BOT_TOKEN

# Build Next.js app
npm run build

# Deploy Pages (HTML)
npm run deploy:pages

# Deploy Worker (API)
npm run deploy:worker

# Initialize Telegram webhook
curl https://layerrunner.lockloke50.workers.dev/init
```

**Subsequent Deployments:**
```bash
npm run deploy:worker  # Update Worker
npm run deploy:pages   # Update Pages
```

#### Files Added/Modified

**New Files:**
- `src/worker.ts` - Cloudflare Worker entry point
- `src/telegram/webhook.ts` - Telegram webhook handler
- `src/telegram/api.ts` - Telegram API client
- `src/telegram/types.ts` - Type definitions
- `src/telegram/message-handler.ts` - Message processing
- `src/core/intent-parser.ts` - Intent extraction
- `src/core/planner.ts` - Plan generation
- `src/core/approval.ts` - Approval workflow
- `src/services/github.ts` - GitHub integration
- `src/services/executor.ts` - Action execution
- `src/config.ts` - Environment configuration
- `wrangler.toml` - Cloudflare Worker configuration
- `.env.example` - Environment template
- `DEVELOPMENT.md` - Development guide
- `TELEGRAM_BOT_SETUP.md` - Setup instructions
- `README_TELEGRAM_BOT.md` - Entry point docs

**Modified Files:**
- `package.json` - Added itty-router dependency and scripts
- `.gitignore` - Enhanced with .wrangler and secrets exclusions

---

## Notes

- **Telegram Bot Status**: Live and receiving webhooks at `/telegram/webhook`
- **Storage**: `APPROVALS` and `LEDGER` durable objects (SQLite-backed) — no longer in-memory as of 0.2.0
- **Rate Limiting**: Not yet implemented - add in Phase 2
- **Monitoring**: Basic health check at `/health` endpoint
- **Logging**: Browser console and Cloudflare logs available via `wrangler tail`
