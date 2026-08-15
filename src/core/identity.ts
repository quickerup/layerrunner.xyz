/**
 * Shared per-user Durable Object addressing, used by every module that
 * stores something per-user in the LEDGER durable object (profile,
 * balance, secrets, onboarding/pending state, wallet link).
 *
 * `identity` is a plain string key. Telegram users MUST keep using
 * `telegramIdentity(userId)` == `String(userId)` -- exactly the
 * unprefixed numeric ID this project has always sharded on. Changing
 * that format would silently point every existing user at a brand new,
 * empty Durable Object instance, orphaning their real profile, LYR
 * balance, and any connected secrets/wallet -- there is no migration
 * path back from that. Any other channel (e.g. a future web chat) must
 * use a format that can never collide with a bare numeric string, e.g.
 * a `web:` prefix.
 */

import { Env } from '../config';

export function telegramIdentity(userId: number): string {
  return String(userId);
}

export function githubIdentity(userId: number): string {
  return `gh:${userId}`;
}

export function googleIdentity(subject: string): string {
  return `google:${subject}`;
}

export function ledgerStub(env: Env, identity: string): DurableObjectStub {
  const id = env.LEDGER.idFromName(identity);
  return env.LEDGER.get(id);
}
