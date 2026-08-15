/**
 * User Profile ("character") storage
 * Reuses the LEDGER durable object namespace, sharded by userId, since it
 * already represents "this user's account" — profile and onboarding state
 * are just additional facets of the same per-user object.
 */

import { Env } from '../config';
import { ledgerStub as sharedLedgerStub } from './identity';

export type UserClass = 'deployer' | 'watcher' | 'reviewer';

export interface UserProfile {
  /** Channel-qualified identity: bare numeric string for Telegram (unchanged,
   *  must stay exactly String(telegramUserId) for existing users), or a
   *  prefixed string like "gh:123"/"google:abc"/"email:<hash>" for web logins. */
  identity: string;
  displayName: string;
  class: UserClass;
  defaultRepo?: string;
  createdAt: number;
  /** Linked TON wallet (public address only, not a secret) — see /link_wallet. */
  walletAddress?: string;
  /** Logical time of the last vault deposit already credited from this wallet, to avoid double-crediting. */
  lastDepositLt?: string;
}

export type OnboardingStep = 'name' | 'class' | 'repo';

export interface OnboardingState {
  step: OnboardingStep;
  displayName?: string;
  className?: UserClass;
}

export const CLASS_INFO: Record<UserClass, { label: string; emoji: string; blurb: string }> = {
  deployer: { label: 'Deployer', emoji: '🛠️', blurb: 'Full access — can run and approve any action.' },
  watcher: { label: 'Watcher', emoji: '👁️', blurb: 'Read-only — status, diagnostics, and lists. No deploys or writes.' },
  reviewer: { label: 'Reviewer', emoji: '📋', blurb: "Read-only, plus can approve or reject other members' pending requests." },
};

export async function getUserProfile(env: Env, identity: string): Promise<UserProfile | undefined> {
  const response = await ledgerStub(env, identity).fetch('https://ledger/profile');
  if (response.status === 404) return undefined;
  if (!response.ok) throw new Error(`Failed to load profile: ${response.status}`);
  const stored = await response.json() as UserProfile & { userId?: number };

  // Migration shim: profiles saved before the identity generalization were
  // stored with a numeric `userId` field, not `identity`. The DO shard we
  // just read from was already addressed by `identity` (== String(userId)
  // for every profile old enough to have this shape), so it's safe to
  // backfill from the param directly -- no ambiguity, no data to look up.
  if (!stored.identity && stored.userId !== undefined) {
    const { userId, ...rest } = stored;
    return { ...rest, identity };
  }

  return stored;
}

export async function saveUserProfile(env: Env, profile: UserProfile): Promise<void> {
  const response = await ledgerStub(env, profile.identity).fetch('https://ledger/profile', {
    method: 'POST',
    body: JSON.stringify(profile),
  });
  if (!response.ok) throw new Error(`Failed to save profile: ${response.status}`);
}

export async function getOnboardingState(env: Env, identity: string): Promise<OnboardingState | undefined> {
  const response = await ledgerStub(env, identity).fetch('https://ledger/onboarding');
  if (response.status === 404) return undefined;
  if (!response.ok) throw new Error(`Failed to load onboarding state: ${response.status}`);
  return response.json() as Promise<OnboardingState>;
}

export async function saveOnboardingState(env: Env, identity: string, state: OnboardingState): Promise<void> {
  const response = await ledgerStub(env, identity).fetch('https://ledger/onboarding', {
    method: 'POST',
    body: JSON.stringify(state),
  });
  if (!response.ok) throw new Error(`Failed to save onboarding state: ${response.status}`);
}

export async function clearOnboardingState(env: Env, identity: string): Promise<void> {
  const response = await ledgerStub(env, identity).fetch('https://ledger/onboarding', { method: 'DELETE' });
  if (!response.ok) throw new Error(`Failed to clear onboarding state: ${response.status}`);
}

export async function isAwaitingWalletLink(env: Env, identity: string): Promise<boolean> {
  const response = await ledgerStub(env, identity).fetch('https://ledger/pending-wallet');
  return response.status === 200;
}

export async function setAwaitingWalletLink(env: Env, identity: string): Promise<void> {
  const response = await ledgerStub(env, identity).fetch('https://ledger/pending-wallet', { method: 'POST', body: '{}' });
  if (!response.ok) throw new Error(`Failed to set pending wallet link: ${response.status}`);
}

export async function clearAwaitingWalletLink(env: Env, identity: string): Promise<void> {
  const response = await ledgerStub(env, identity).fetch('https://ledger/pending-wallet', { method: 'DELETE' });
  if (!response.ok) throw new Error(`Failed to clear pending wallet link: ${response.status}`);
}

function ledgerStub(env: Env, identity: string): DurableObjectStub {
  return sharedLedgerStub(env, identity);
}
