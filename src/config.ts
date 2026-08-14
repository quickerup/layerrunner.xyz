/**
 * Environment Configuration
 * Load secrets from Cloudflare environment or .env files
 */

declare global {
  var TELEGRAM_BOT_TOKEN: string;
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
