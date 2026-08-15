/**
 * Web login/session HTTP handlers. First (and so far only) provider is
 * Telegram -- resolves to the exact same identity/DO the bot already uses,
 * so anyone who's used the bot sees their real balance/profile on web with
 * zero migration. GitHub/Google/email logins are separate new identities,
 * added the same way in later phases (see melodic-discovering-muffin plan).
 */

import { Env } from '../config';
import { telegramIdentity } from '../core/identity';
import { getUserProfile } from '../core/profile';
import {
  clearSessionCookieHeader,
  mintSession,
  readSessionCookie,
  sessionCookieHeader,
  verifySession,
} from '../core/session';
import { TelegramLoginData, verifyTelegramLogin } from '../core/telegram-login';

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

  const token = await mintSession(env, telegramIdentity(data.id), 'telegram');
  return json({ ok: true }, { status: 200, headers: { 'Set-Cookie': sessionCookieHeader(token) } });
}

export async function handleGetSession(request: Request, env: Env): Promise<Response> {
  const payload = await verifySession(env, readSessionCookie(request));
  if (!payload) return json({ ok: false });

  const profile = await getUserProfile(env, payload.identity);
  return json({ ok: true, identity: payload.identity, provider: payload.provider, profile: profile ?? null });
}

export async function handleLogout(): Promise<Response> {
  return json({ ok: true }, { status: 200, headers: { 'Set-Cookie': clearSessionCookieHeader() } });
}
