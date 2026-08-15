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
  // Master key for encrypting user-supplied secrets (e.g. a personal
  // GitHub token) at rest in their LEDGER durable object -- see
  // core/secrets-crypto.ts and core/user-secrets.ts. Set once by whoever
  // deploys the bot; end users never touch this or any wrangler command.
  SECRETS_ENCRYPTION_KEY: string;
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
