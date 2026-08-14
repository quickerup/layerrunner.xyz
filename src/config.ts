/**
 * Environment Configuration
 * Load secrets from Cloudflare environment or .env files
 */

declare global {
  var TELEGRAM_BOT_TOKEN: string;
}

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
}

export function getEnv(key: string, defaultValue?: string): string {
  const value = (globalThis as any)[key];
  if (!value && !defaultValue) {
    throw new Error(`Missing required environment variable: ${key}`);
  }
  return value || defaultValue || '';
}

export const config = {
  telegramBotToken: getEnv('TELEGRAM_BOT_TOKEN'),
  environment: getEnv('ENVIRONMENT', 'development'),
};
