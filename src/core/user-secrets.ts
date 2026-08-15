/**
 * Per-user secrets (e.g. a personal GitHub token), so someone can use
 * Layer Runners against their own GitHub account without ever touching
 * this codebase or running a wrangler command themselves -- set entirely
 * through a Telegram conversation, encrypted at rest (see
 * core/secrets-crypto.ts) in the same per-user LEDGER durable object
 * already used for balance/profile/onboarding.
 *
 * Stored as one encrypted blob per user (the whole SecretsMap, re-
 * encrypted with a fresh salt on every save) rather than one blob per
 * secret name -- simpler, and there's no meaningful cost difference at
 * this scale (a handful of fields per user, read at most once per
 * request, not a hot loop).
 */

import { Env } from '../config';
import { decryptSecret, encryptSecret } from './secrets-crypto';

export type SecretsMap = Record<string, string>;

export const GITHUB_TOKEN_SECRET = 'github_token';

export interface PendingSecretInput {
  name: string;
}

export async function getUserSecret(env: Env, userId: number, name: string): Promise<string | undefined> {
  const secrets = await loadSecrets(env, userId);
  return secrets[name];
}

export async function hasUserSecret(env: Env, userId: number, name: string): Promise<boolean> {
  return (await getUserSecret(env, userId, name)) !== undefined;
}

export async function setUserSecret(env: Env, userId: number, name: string, value: string): Promise<void> {
  const secrets = await loadSecrets(env, userId);
  secrets[name] = value;
  await saveSecrets(env, userId, secrets);
}

export async function clearUserSecret(env: Env, userId: number, name: string): Promise<void> {
  const secrets = await loadSecrets(env, userId);
  if (!(name in secrets)) return;
  delete secrets[name];

  if (Object.keys(secrets).length === 0) {
    const response = await ledgerStub(env, userId).fetch('https://ledger/secrets', { method: 'DELETE' });
    if (!response.ok) throw new Error(`Failed to clear secrets: ${response.status}`);
    return;
  }

  await saveSecrets(env, userId, secrets);
}

export async function getPendingSecretInput(env: Env, userId: number): Promise<PendingSecretInput | undefined> {
  const response = await ledgerStub(env, userId).fetch('https://ledger/pending-secret');
  if (response.status === 404) return undefined;
  if (!response.ok) throw new Error(`Failed to load pending secret state: ${response.status}`);
  return response.json() as Promise<PendingSecretInput>;
}

export async function setPendingSecretInput(env: Env, userId: number, state: PendingSecretInput): Promise<void> {
  const response = await ledgerStub(env, userId).fetch('https://ledger/pending-secret', {
    method: 'POST',
    body: JSON.stringify(state),
  });
  if (!response.ok) throw new Error(`Failed to save pending secret state: ${response.status}`);
}

export async function clearPendingSecretInput(env: Env, userId: number): Promise<void> {
  const response = await ledgerStub(env, userId).fetch('https://ledger/pending-secret', { method: 'DELETE' });
  if (!response.ok) throw new Error(`Failed to clear pending secret state: ${response.status}`);
}

async function loadSecrets(env: Env, userId: number): Promise<SecretsMap> {
  const response = await ledgerStub(env, userId).fetch('https://ledger/secrets');
  if (response.status === 404) return {};
  if (!response.ok) throw new Error(`Failed to load secrets: ${response.status}`);
  const { blob } = await response.json() as { blob?: string };
  if (!blob) return {};
  const json = await decryptSecret(blob, encryptionKey(env));
  return JSON.parse(json) as SecretsMap;
}

async function saveSecrets(env: Env, userId: number, secrets: SecretsMap): Promise<void> {
  const blob = await encryptSecret(JSON.stringify(secrets), encryptionKey(env));
  const response = await ledgerStub(env, userId).fetch('https://ledger/secrets', {
    method: 'POST',
    body: JSON.stringify({ blob }),
  });
  if (!response.ok) throw new Error(`Failed to save secrets: ${response.status}`);
}

function ledgerStub(env: Env, userId: number): DurableObjectStub {
  const id = env.LEDGER.idFromName(String(userId));
  return env.LEDGER.get(id);
}

function encryptionKey(env: Env): string {
  if (!env.SECRETS_ENCRYPTION_KEY) {
    throw new Error('SECRETS_ENCRYPTION_KEY is not configured — cannot store or read user secrets safely.');
  }
  return env.SECRETS_ENCRYPTION_KEY;
}
