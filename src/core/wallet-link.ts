/**
 * Linked-wallet deposit reconciliation.
 *
 * A linked wallet is purely a claimed public address (see profile.ts's
 * walletAddress) -- no signature/ownership proof is collected. That's a
 * deliberate v1 tradeoff: linking only ever *reads* public chain data or
 * credits a ledger based on money that has already actually moved into
 * the vault, so there's nothing to exploit by linking someone else's
 * address (you just wouldn't benefit, since you can't make deposits
 * appear to come from a wallet you don't control).
 */

import { Env } from '../config';
import { creditBalance } from './metering';
import { UserProfile, saveUserProfile } from './profile';
import { initTonCenterService } from '../services/ton';

/**
 * Scans the vault for new incoming LYR transfers from this user's linked
 * wallet since the last check, and credits their ledger balance for each
 * one found. Returns the total nanoLYR credited (0n if nothing new, or
 * if no wallet is linked / vault isn't configured).
 */
export async function reconcileVaultDeposits(env: Env, profile: UserProfile): Promise<bigint> {
  if (!profile.walletAddress || !env.VAULT_JETTON_WALLET) {
    return BigInt(0);
  }

  const ton = initTonCenterService(env);
  const userWallet = await ton.getJettonWallet(profile.walletAddress);
  if (!userWallet) {
    return BigInt(0); // linked wallet has never held LYR -- no possible deposits
  }

  const deposits = await ton.getVaultDeposits(env.VAULT_JETTON_WALLET, profile.lastDepositLt);
  const fromLinkedWallet = deposits.filter(d => d.source === userWallet.address);
  if (fromLinkedWallet.length === 0) {
    return BigInt(0);
  }

  const totalNano = fromLinkedWallet.reduce((sum, d) => sum + BigInt(d.amount), BigInt(0));
  const newestLt = fromLinkedWallet.reduce(
    (max, d) => (BigInt(d.transaction_lt) > BigInt(max) ? d.transaction_lt : max),
    profile.lastDepositLt ?? '0'
  );

  await creditBalance(env, profile.identity, totalNano);
  await saveUserProfile(env, { ...profile, lastDepositLt: newestLt });

  return totalNano;
}
