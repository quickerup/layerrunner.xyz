# Web chat + multi-provider login

## Context

Layer Runners originally only worked through Telegram. The goal of this
effort is a web chat on layerrunners.xyz that mirrors the bot for people
without Telegram, backed by real accounts (GitHub / Telegram / Google /
email login) instead of a throwaway browser session — so balance,
profile, connected GitHub token, and linked wallet all persist across
devices the same way they already do for Telegram users.

The bot has real money and real users on it, so the guiding constraint
throughout is: **never change how an existing Telegram user's data is
addressed.** The per-user Durable Object is sharded by
`String(telegramUserId)` — that exact format is preserved by
`core/identity.ts::telegramIdentity`.

## Key design decisions

**Telegram login = the same account as the bot.** Logging in with
Telegram on the website resolves to identity `String(telegramUserId)`
— literally the same Durable Object the bot already uses. Anyone who's
used the bot sees their real balance, profile, connected GitHub token,
and linked wallet immediately on web, zero migration needed.

**GitHub / Google / email logins are new, separate accounts** —
identity `gh:<githubUserId>`, `google:<sub>`, `email:<sha256(address)>`.
No auto-merging with an existing Telegram account. Account linking is a
reasonable future addition, not required for launch.

**"Login with GitHub" (when built) stays identity-only** (`read:user`
scope) and is deliberately *not* reused as the repo-access token.
`/connect_github` (already built, encrypted-at-rest) stays the one path
that grants repo access — keeps consent scope minimal for login and
avoids conflating "who are you" with "what can you touch."

**Session = signed cookie, not a new library.** An HMAC-SHA256 signed
cookie (`core/session.ts`), verified with native `crypto.subtle` the
same way `core/secrets-crypto.ts` does AES-GCM — no new dependency.

**Chat engine is extracted once, both channels drive it.** The
intent → plan → role/metering gate → approval-or-execute pipeline lives
in `core/chat-engine.ts::runChatEngine`, shared by Telegram's webhook
and `POST /api/chat`. No duplicate planning/metering/execution logic
between channels.

**New (non-Telegram) identities get sensible defaults, not a wizard.**
`core/chat-engine.ts::ensureProfile` creates a profile with `watcher`
(read-only) role and the same free trial credit, instead of forcing the
Telegram name → role → repo wizard. Role defaults to the safe option
since nobody explicitly chose it the way the Telegram wizard requires
— there is currently no self-service way to change role after creation
on either channel.

## Status

### ✅ Phase 1 — Identity generalization + session infra (done)
- `core/profile.ts`, `core/metering.ts`, `core/user-secrets.ts`,
  `core/wallet-link.ts` all take `identity: string` instead of a
  Telegram-only `userId: number`, routed through `core/identity.ts`.
- `core/session.ts`: `mintSession`, `verifySession`, HMAC-signed cookie,
  30-day TTL with half-life refresh. Secret: `SESSION_SIGNING_KEY`.
- `wrangler.toml`: `layerrunners.xyz/auth/*` and `/api/*` routed to the
  Worker (`env.production.routes`), alongside `/telegram/webhook`.

### ✅ Phase 2 — Telegram Login (done)
- `app/login/page.tsx`: Telegram Login Widget (`data-telegram-login`,
  bot username `layerrunnersbot`).
- `POST /auth/telegram/callback` (`src/auth/routes.ts`): verifies the
  widget payload per Telegram's documented HMAC algorithm
  (`core/telegram-login.ts`), mints a session for identity
  `String(id)`, sets the cookie.
- `GET /api/session`: returns the current session's identity/provider/
  profile/balance, provisioning a default profile on first hit
  (`ensureProfile`) so balance shows correctly before the first message.

### ✅ Phase 3 — Chat engine + web UI (done)
- `core/chat-engine.ts::runChatEngine`: the channel-agnostic pipeline,
  extracted from `telegram/message-handler.ts`.
- `POST /api/chat`, `POST /api/approve` (`src/api/routes.ts`): web
  equivalents of the Telegram message handler and inline-keyboard
  approve/reject. Approval resolution logic
  (`core/chat-engine.ts::resolveApproval`) is shared with
  `telegram/callback-handler.ts`, not duplicated.
- `app/chat/page.tsx`: message list, balance display with a buy-more
  link, inline Approve/Reject buttons when a response needs sign-off.

**Not yet on web** (Telegram-only for now): `/link_wallet`,
`/connect_github`/`/disconnect_github`, `/deploy`, `/collect`. None of
these were in scope for phase 3.

### ⬜ Phase 4 — GitHub OAuth login (not started)
**Needs first:** register a GitHub OAuth App
(github.com/settings/developers → OAuth Apps → New), Authorization
callback URL `https://layerrunners.xyz/auth/github/callback`. Set
secrets `GITHUB_OAUTH_CLIENT_ID` / `GITHUB_OAUTH_CLIENT_SECRET`.
- `GET /auth/github` (redirect to GitHub authorize URL, `read:user`
  scope only), `GET /auth/github/callback` (exchange code, fetch
  `/user`, mint session with identity `gh:<id>`).

### ⬜ Phase 5 — Google OAuth login (not started)
**Needs first:** a Google Cloud project + OAuth 2.0 Client ID
(console.cloud.google.com → APIs & Services → Credentials), authorized
redirect URI `https://layerrunners.xyz/auth/google/callback`. Set
`GOOGLE_OAUTH_CLIENT_ID` / `GOOGLE_OAUTH_CLIENT_SECRET`.
- Same shape as GitHub: `GET /auth/google` + `GET /auth/google/callback`,
  minimal `openid email profile` scope, identity `google:<sub>`.

### ⬜ Phase 6 — Email magic-link login (not started)
**Needs first:** an account with a transactional email API (Resend
recommended — simple REST API, generous free tier) and a verified
sending domain (or their shared subdomain to start). Set
`RESEND_API_KEY` (or equivalent).
- `POST /auth/email/request` (generate a short-lived signed token, email
  a link), `GET /auth/email/verify` (consume the token, mint session),
  identity `email:<sha256(address)>`. Magic-link, not a password — no
  password storage/hashing surface to maintain.

## Verification (each phase)

- `npx tsc --noEmit -p tsconfig.json`
- `npm run build` (new static pages, where applicable)
- `npx wrangler deploy --dry-run --env production`
- Live smoke test: log in on a real account, confirm `/api/chat`
  matches what the Telegram bot gives for the same request, confirm
  `/api/session`'s balance matches `/profile` in Telegram for the same
  identity where applicable.
