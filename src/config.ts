/**
 * Cloudflare Worker environment bindings.
 */

export interface Env {
  TELEGRAM_BOT_TOKEN: string;
  GITHUB_TOKEN: string;
  GITHUB_OWNER: string;
  GITHUB_REPO?: string;
  GITHUB_DEPLOY_WORKFLOW?: string;
  APP_HEALTH_URL?: string;
  ENVIRONMENT?: string;
  AI?: {
    run: (model: string, input: Record<string, unknown>) => Promise<unknown>;
  };
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
