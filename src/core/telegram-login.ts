/**
 * Verifies data from Telegram's Login Widget, per Telegram's documented
 * algorithm (https://core.telegram.org/widgets/login#checking-authorization):
 * secret_key = SHA256(bot_token); data-check-string = every received field
 * except `hash`, sorted by key, joined as "key=value" with "\n"; the
 * request is genuine iff HMAC-SHA256(data-check-string, secret_key) matches
 * the received hash.
 */

import { Env } from '../config';

export interface TelegramLoginData {
  id: number;
  first_name: string;
  last_name?: string;
  username?: string;
  photo_url?: string;
  auth_date: number;
  hash: string;
}

// Widget data is meant to be consumed once, right after the redirect/popup
// -- anything older than this is a replayed (or just stale, forged) payload.
const MAX_AUTH_AGE_SECONDS = 24 * 60 * 60;

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
}

export async function verifyTelegramLogin(env: Env, data: TelegramLoginData): Promise<boolean> {
  if (!env.TELEGRAM_BOT_TOKEN) return false;
  if (typeof data.hash !== 'string' || !data.hash) return false;
  if (typeof data.auth_date !== 'number') return false;
  if (Date.now() / 1000 - data.auth_date > MAX_AUTH_AGE_SECONDS) return false;

  const { hash, ...fields } = data;
  const checkString = Object.keys(fields)
    .sort()
    .filter(key => (fields as Record<string, unknown>)[key] !== undefined)
    .map(key => `${key}=${(fields as Record<string, unknown>)[key]}`)
    .join('\n');

  const secretKeyBytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(env.TELEGRAM_BOT_TOKEN));
  const hmacKey = await crypto.subtle.importKey('raw', secretKeyBytes, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const signature = await crypto.subtle.sign('HMAC', hmacKey, new TextEncoder().encode(checkString));

  return toHex(new Uint8Array(signature)) === hash.toLowerCase();
}
