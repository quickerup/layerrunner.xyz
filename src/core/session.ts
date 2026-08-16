/**
 * Web session cookie for the chat UI login (Telegram widget first, GitHub /
 * Google / email later — see core/identity.ts for how each provider maps
 * to a DO identity). HMAC-SHA256 signed via native Web Crypto, the same
 * approach core/secrets-crypto.ts already uses for secrets — no JWT
 * dependency, one more small module in the same style.
 *
 * Token format (dot-joined, both halves base64url): payloadJson.signature
 */

import { Env } from '../config';

export const SESSION_COOKIE_NAME = 'lr_session';

const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
const REFRESH_THRESHOLD_MS = SESSION_TTL_MS / 2; // reissue once past half-life

export type LoginProvider = 'telegram' | 'github' | 'google' | 'email' | 'ton';

export interface SessionPayload {
  identity: string;
  provider: LoginProvider;
  iat: number;
  exp: number;
}

function toBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(b64url: string): Uint8Array {
  const b64 = b64url.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(b64url.length / 4) * 4, '=');
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

async function hmacKey(env: Env): Promise<CryptoKey> {
  if (!env.SESSION_SIGNING_KEY) {
    throw new Error('SESSION_SIGNING_KEY is not configured — cannot mint or verify sessions.');
  }
  return crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(env.SESSION_SIGNING_KEY),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign', 'verify']
  );
}

export async function mintSession(env: Env, identity: string, provider: LoginProvider): Promise<string> {
  const now = Date.now();
  const payload: SessionPayload = { identity, provider, iat: now, exp: now + SESSION_TTL_MS };
  const payloadB64 = toBase64Url(new TextEncoder().encode(JSON.stringify(payload)));
  const key = await hmacKey(env);
  const signature = new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(payloadB64)));
  return `${payloadB64}.${toBase64Url(signature)}`;
}

// Verification failures (bad signature, malformed token, missing config,
// expiry) all collapse to "not logged in" rather than throwing -- a forged
// or stale cookie must never take down a request, it should just fail auth.
export async function verifySession(env: Env, token: string | undefined): Promise<SessionPayload | undefined> {
  if (!token) return undefined;
  const [payloadB64, signatureB64, ...rest] = token.split('.');
  if (!payloadB64 || !signatureB64 || rest.length > 0) return undefined;

  try {
    const key = await hmacKey(env);
    const valid = await crypto.subtle.verify(
      'HMAC',
      key,
      fromBase64Url(signatureB64) as BufferSource,
      new TextEncoder().encode(payloadB64)
    );
    if (!valid) return undefined;

    const payload = JSON.parse(new TextDecoder().decode(fromBase64Url(payloadB64))) as SessionPayload;
    if (typeof payload.exp !== 'number' || payload.exp < Date.now()) return undefined;
    return payload;
  } catch (error) {
    console.warn('Failed to verify session token:', error);
    return undefined;
  }
}

/** True once a session is past its half-life — callers can reissue + reset the cookie on any authenticated request past this point, so active users never see a hard logout. */
export function shouldRefresh(payload: SessionPayload): boolean {
  return payload.exp - Date.now() < REFRESH_THRESHOLD_MS;
}

export function sessionCookieHeader(token: string): string {
  const maxAgeSeconds = Math.floor(SESSION_TTL_MS / 1000);
  return `${SESSION_COOKIE_NAME}=${token}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=${maxAgeSeconds}`;
}

export function clearSessionCookieHeader(): string {
  return `${SESSION_COOKIE_NAME}=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0`;
}

export function readSessionCookie(request: Request): string | undefined {
  const cookieHeader = request.headers.get('Cookie');
  if (!cookieHeader) return undefined;
  const match = cookieHeader.match(new RegExp(`(?:^|;\\s*)${SESSION_COOKIE_NAME}=([^;]+)`));
  return match?.[1];
}
