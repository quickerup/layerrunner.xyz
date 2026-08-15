/**
 * Cloudflare Worker environment bindings.
 * Matches the bindings declared in wrangler.toml.
 */
export interface Env {
  // Durable Object bindings
  APPROVALS: DurableObjectNamespace;
  LEDGER: DurableObjectNamespace;

  // Workers AI binding
  AI: Ai;

  // Secrets / vars
  TELEGRAM_BOT_TOKEN: string;
  GITHUB_TOKEN: string;
  GITHUB_OWNER: string;
  GITHUB_REPO: string;
  GITHUB_REPO_BRANCH?: string;
  GITHUB_DEPLOY_WORKFLOW?: string;
  VAULT_JETTON_WALLET?: string;
  JETTON_ADDRESS?: string;
  APP_HEALTH_URL?: string;
  ENVIRONMENT?: string;
  TONCENTER_API_KEY?: string;
  // Primary planner backend (services/ai-provider.ts) -- when set, plan
  // extraction tries Gemini first and falls back to the Workers AI binding
  // (still configured below) on any failure, then to the regex pipeline.
  GEMINI_API_KEY?: string;
  // Master key for encrypting user-supplied secrets (e.g. a personal
  // GitHub token) at rest in their LEDGER durable object -- see
  // core/secrets-crypto.ts and core/user-secrets.ts. Set once by whoever
  // deploys the bot; end users never touch this or any wrangler command.
  SECRETS_ENCRYPTION_KEY: string;
  // Signing key for web session cookies (core/session.ts) -- separate from
  // SECRETS_ENCRYPTION_KEY since it protects a different thing (session
  // integrity, not secret confidentiality) and should be rotatable
  // independently (rotating it just logs everyone out, vs. rotating the
  // secrets key which would strand every stored GitHub token).
  SESSION_SIGNING_KEY?: string;
  // OAuth App credentials used only for web identity login. This is
  // intentionally separate from /connect_github's repo-access token flow.
  GITHUB_OAUTH_CLIENT_ID?: string;
  GITHUB_OAUTH_CLIENT_SECRET?: string;
  GOOGLE_OAUTH_CLIENT_ID?: string;
  GOOGLE_OAUTH_CLIENT_SECRET?: string;
}

export function getEnv(env: Env, key: keyof Env, defaultValue?: string): string {
  const value = env[key];
  if (typeof value === 'string' && value.length > 0) {
    return value;
  }

  if (defaultValue !== undefined) {
    return defaultValue;
  }

  throw new Error(`Missing required environment binding: ${String(key)}`);
}
