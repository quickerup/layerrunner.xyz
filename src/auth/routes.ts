/**
 * Web login/session HTTP handlers. Telegram resolves to the exact same
 * identity/DO the bot already uses, so anyone who's used the bot sees their
 * real balance/profile on web with zero migration. GitHub/Google/email
 * logins are separate new identities.
 */

import { Env } from '../config';
import { githubIdentity, telegramIdentity } from '../core/identity';
import { ensureProfile } from '../core/chat-engine';
import { getBalance } from '../core/metering';
import { formatLyr } from '../services/ton';
import {
  clearSessionCookieHeader,
  mintSession,
  readSessionCookie,
  sessionCookieHeader,
  verifySession,
} from '../core/session';
import { TelegramLoginData, verifyTelegramLogin } from '../core/telegram-login';

const GITHUB_AUTHORIZE_URL = 'https://github.com/login/oauth/authorize';
const GITHUB_TOKEN_URL = 'https://github.com/login/oauth/access_token';
const GITHUB_USER_URL = 'https://api.github.com/user';
const GITHUB_OAUTH_STATE_COOKIE = 'lr_github_oauth_state';

interface GitHubTokenResponse {
  access_token?: string;
  error?: string;
  error_description?: string;
}

interface GitHubUserResponse {
  id?: number;
  login?: string;
}

function json(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    ...init,
    headers: { 'Content-Type': 'application/json', ...init.headers },
  });
}

export async function handleTelegramAuthCallback(request: Request, env: Env): Promise<Response> {
  let data: TelegramLoginData;
  try {
    data = await request.json();
  } catch {
    return json({ ok: false, error: 'Invalid request body' }, { status: 400 });
  }

  if (!data || typeof data.id !== 'number') {
    return json({ ok: false, error: 'Missing Telegram user data' }, { status: 400 });
  }

  if (!(await verifyTelegramLogin(env, data))) {
    return json({ ok: false, error: 'Could not verify Telegram login' }, { status: 401 });
  }

  if (!env.SESSION_SIGNING_KEY) {
    return json({ ok: false, error: 'Web login is not configured yet.' }, { status: 503 });
  }

  const token = await mintSession(env, telegramIdentity(data.id), 'telegram');
  return json({ ok: true }, { status: 200, headers: { 'Set-Cookie': sessionCookieHeader(token) } });
}

function oauthStateCookieHeader(state: string): string {
  return `${GITHUB_OAUTH_STATE_COOKIE}=${state}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=600`;
}

function clearOAuthStateCookieHeader(): string {
  return `${GITHUB_OAUTH_STATE_COOKIE}=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0`;
}

function readCookie(request: Request, name: string): string | undefined {
  const cookieHeader = request.headers.get('Cookie');
  if (!cookieHeader) return undefined;
  const escapedName = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = cookieHeader.match(new RegExp(`(?:^|;\\s*)${escapedName}=([^;]+)`));
  return match?.[1];
}

function randomOAuthState(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function githubOAuthRedirectUri(request: Request): string {
  return `${new URL(request.url).origin}/auth/github/callback`;
}

export async function handleGitHubAuthStart(request: Request, env: Env): Promise<Response> {
  if (!env.GITHUB_OAUTH_CLIENT_ID || !env.GITHUB_OAUTH_CLIENT_SECRET || !env.SESSION_SIGNING_KEY) {
    return json({ ok: false, error: 'GitHub login is not configured yet.' }, { status: 503 });
  }

  const state = randomOAuthState();
  const authorizeUrl = new URL(GITHUB_AUTHORIZE_URL);
  authorizeUrl.searchParams.set('client_id', env.GITHUB_OAUTH_CLIENT_ID);
  authorizeUrl.searchParams.set('redirect_uri', githubOAuthRedirectUri(request));
  authorizeUrl.searchParams.set('scope', 'read:user');
  authorizeUrl.searchParams.set('state', state);

  return new Response(null, {
    status: 302,
    headers: {
      Location: authorizeUrl.toString(),
      'Set-Cookie': oauthStateCookieHeader(state),
    },
  });
}

export async function handleGitHubAuthCallback(request: Request, env: Env): Promise<Response> {
  if (!env.GITHUB_OAUTH_CLIENT_ID || !env.GITHUB_OAUTH_CLIENT_SECRET || !env.SESSION_SIGNING_KEY) {
    return json({ ok: false, error: 'GitHub login is not configured yet.' }, { status: 503 });
  }

  const url = new URL(request.url);
  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');
  const storedState = readCookie(request, GITHUB_OAUTH_STATE_COOKIE);
  if (!code || !state || !storedState || state !== storedState) {
    return json(
      { ok: false, error: 'Invalid GitHub OAuth callback.' },
      { status: 400, headers: { 'Set-Cookie': clearOAuthStateCookieHeader() } }
    );
  }

  const tokenResponse = await fetch(GITHUB_TOKEN_URL, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      'User-Agent': 'layerrunners.xyz',
    },
    body: JSON.stringify({
      client_id: env.GITHUB_OAUTH_CLIENT_ID,
      client_secret: env.GITHUB_OAUTH_CLIENT_SECRET,
      code,
      redirect_uri: githubOAuthRedirectUri(request),
    }),
  });
  const tokenBody = (await tokenResponse.json().catch(() => ({}))) as GitHubTokenResponse;
  if (!tokenResponse.ok || !tokenBody.access_token) {
    return json(
      { ok: false, error: tokenBody.error_description ?? tokenBody.error ?? 'Could not complete GitHub login.' },
      { status: 401, headers: { 'Set-Cookie': clearOAuthStateCookieHeader() } }
    );
  }

  const userResponse = await fetch(GITHUB_USER_URL, {
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${tokenBody.access_token}`,
      'User-Agent': 'layerrunners.xyz',
      'X-GitHub-Api-Version': '2022-11-28',
    },
  });
  const userBody = (await userResponse.json().catch(() => ({}))) as GitHubUserResponse;
  if (!userResponse.ok || typeof userBody.id !== 'number') {
    return json(
      { ok: false, error: 'Could not fetch GitHub user.' },
      { status: 401, headers: { 'Set-Cookie': clearOAuthStateCookieHeader() } }
    );
  }

  const token = await mintSession(env, githubIdentity(userBody.id), 'github');
  const headers = new Headers({ Location: '/chat' });
  headers.append('Set-Cookie', sessionCookieHeader(token));
  headers.append('Set-Cookie', clearOAuthStateCookieHeader());
  return new Response(null, {
    status: 302,
    headers,
  });
}

export async function handleGetSession(request: Request, env: Env): Promise<Response> {
  const payload = await verifySession(env, readSessionCookie(request));
  if (!payload) return json({ ok: false });

  const profile = await ensureProfile(env, payload.identity);
  const balance = formatLyr(await getBalance(env, payload.identity));
  return json({ ok: true, identity: payload.identity, provider: payload.provider, profile, balance });
}

export async function handleLogout(): Promise<Response> {
  return json({ ok: true }, { status: 200, headers: { 'Set-Cookie': clearSessionCookieHeader() } });
}
