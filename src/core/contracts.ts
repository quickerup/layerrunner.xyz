/**
 * Contract Studio's tracked-contracts list -- contracts a user has deployed
 * or pointed the tracker at. Stored the same way profile.ts/metering.ts's
 * onboarding/secrets state is: a single JSON value under the LEDGER durable
 * object, keyed by identity (see identity.ts's ledgerStub).
 */

import { Env } from '../config';
import { ledgerStub } from './identity';
import { TonNetwork } from '../../lib/ton-network';

export interface TrackedContract {
  address: string;
  network: TonNetwork;
  label: string;
  codeHash?: string;
  deployedAt: number;
}

export async function getTrackedContracts(env: Env, identity: string): Promise<TrackedContract[]> {
  const response = await ledgerStub(env, identity).fetch('https://ledger/contracts');
  if (response.status === 404) return [];
  if (!response.ok) throw new Error(`Failed to load tracked contracts: ${response.status}`);
  return response.json() as Promise<TrackedContract[]>;
}

/** Re-tracking the same address+network (e.g. to relabel it) replaces the existing entry rather than duplicating it. */
export async function saveTrackedContract(env: Env, identity: string, contract: TrackedContract): Promise<TrackedContract[]> {
  const existing = await getTrackedContracts(env, identity);
  const next = [
    ...existing.filter((c) => !(c.address === contract.address && c.network === contract.network)),
    contract,
  ];

  const response = await ledgerStub(env, identity).fetch('https://ledger/contracts', {
    method: 'POST',
    body: JSON.stringify(next),
  });
  if (!response.ok) throw new Error(`Failed to save tracked contract: ${response.status}`);
  return next;
}
