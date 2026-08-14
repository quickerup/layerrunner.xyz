/**
 * TON Center Service
 * Interacts with the TON blockchain via the TON Center API v3.
 *
 * Token: Layer (LYR)
 * Jetton master: EQDOOW2oAIoqBdngirqRA757cFCJqpVGrP4sPDeWxSgPNuTA
 * Decimals: 9
 * Total supply: 100,000,000 LYR
 */

import { Env } from '../config';

// ─── Constants ────────────────────────────────────────────────────────────────

export const LYR_TOKEN = {
  name: 'Layer',
  symbol: 'LYR',
  decimals: 9,
  /** Jetton master contract address (user-friendly) */
  jettonMaster: 'EQDOOW2oAIoqBdngirqRA757cFCJqpVGrP4sPDeWxSgPNuTA',
  /** Raw hex address of the jetton master */
  jettonMasterRaw: '0:CE396DA8008A2A05D9E08ABA9103BE7B705089AA9546ACFE2C3C3796C5280F36',
  totalSupply: 100_000_000,
  image: 'https://lavender-peculiar-mink-646.mypinata.cloud/ipfs/bafkreic5zef7vwa4zsjgwh3rxxm4xyralvo26s2nzhl3k5e5dh6fh74nsu',
  description: 'Utility token used to pay for actions executed by the Layer Runners Telegram bot.',
} as const;

export const NANO_FACTOR = BigInt(1_000_000_000);

const TONCENTER_BASE = 'https://toncenter.com/api/v3';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface JettonWallet {
  address: string;
  owner: string;
  jetton: string;
  balance: string;
  last_transaction_lt: string;
}

export interface JettonTransfer {
  transaction_hash: string;
  direction: 'in' | 'out';
  amount: string;
  sender: string | null;
  destination: string | null;
  comment: string | null;
  created_lt: string;
  created_at: number;
}

export interface JettonMasterInfo {
  address: string;
  total_supply: string;
  mintable: boolean;
  admin_address: string | null;
  jetton_content: {
    name?: string;
    symbol?: string;
    decimals?: string;
    description?: string;
    image?: string;
  };
}

// ─── TON Center Service ───────────────────────────────────────────────────────

export class TonCenterService {
  private readonly baseUrl = TONCENTER_BASE;
  private readonly apiKey: string | undefined;

  constructor(apiKey?: string) {
    this.apiKey = apiKey;
  }

  // ── Internal ──────────────────────────────────────────────────────────────

  private headers(): Record<string, string> {
    const h: Record<string, string> = { 'Content-Type': 'application/json' };
    if (this.apiKey) h['X-API-Key'] = this.apiKey;
    return h;
  }

  private async get<T>(path: string, params: Record<string, string> = {}): Promise<T> {
    const url = new URL(`${this.baseUrl}${path}`);
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);

    const res = await fetch(url.toString(), { headers: this.headers() });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`TON Center API error ${res.status}: ${text}`);
    }
    return res.json() as Promise<T>;
  }

  // ── Public API ────────────────────────────────────────────────────────────

  /**
   * Fetch live LYR jetton master metadata from the chain.
   */
  async getJettonMaster(address = LYR_TOKEN.jettonMaster): Promise<JettonMasterInfo> {
    const data = await this.get<{ jetton_masters: JettonMasterInfo[] }>(
      '/jetton/masters',
      { address, limit: '1' }
    );
    const master = data.jetton_masters[0];
    if (!master) throw new Error(`Jetton master not found: ${address}`);
    return master;
  }

  /**
   * Get the LYR jetton wallet address for a given TON wallet owner.
   */
  async getJettonWallet(ownerAddress: string, jettonAddress = LYR_TOKEN.jettonMaster): Promise<JettonWallet | null> {
    const data = await this.get<{ jetton_wallets: JettonWallet[] }>(
      '/jetton/wallets',
      { owner_address: ownerAddress, jetton_address: jettonAddress, limit: '1' }
    );
    return data.jetton_wallets[0] ?? null;
  }

  /**
   * Get LYR balance (in nano-LYR) for a TON wallet address.
   * Returns 0n if the wallet has never received LYR.
   */
  async getLyrBalance(ownerAddress: string): Promise<bigint> {
    const wallet = await this.getJettonWallet(ownerAddress);
    if (!wallet) return BigInt(0);
    return BigInt(wallet.balance);
  }

  /**
   * Get recent LYR transfers for a given jetton wallet address.
   * Use this to detect incoming deposits.
   */
  async getJettonTransfers(
    jettonWalletAddress: string,
    limit = 20,
  ): Promise<JettonTransfer[]> {
    const data = await this.get<{ jetton_transfers: JettonTransfer[] }>(
      '/jetton/transfers',
      { address: jettonWalletAddress, direction: 'in', limit: String(limit) }
    );
    return data.jetton_transfers;
  }

  /**
   * Scan vault wallet for new LYR deposits.
   * Returns transfers since the given logical time (lt).
   * Pass the last known lt to detect only new deposits.
   */
  async getVaultDeposits(
    vaultJettonWalletAddress: string,
    sinceLt?: string,
    limit = 20,
  ): Promise<JettonTransfer[]> {
    const params: Record<string, string> = {
      address: vaultJettonWalletAddress,
      direction: 'in',
      limit: String(limit),
    };
    if (sinceLt) params['start_lt'] = sinceLt;

    const data = await this.get<{ jetton_transfers: JettonTransfer[] }>(
      '/jetton/transfers',
      params
    );
    return data.jetton_transfers;
  }

  /**
   * Verify a specific LYR transfer by transaction hash.
   * Returns the transfer if found and amount matches, null otherwise.
   */
  async verifyTransfer(
    txHash: string,
    expectedAmountNano: bigint,
    expectedComment?: string,
  ): Promise<JettonTransfer | null> {
    const data = await this.get<{ jetton_transfers: JettonTransfer[] }>(
      '/jetton/transfers',
      { transaction_hash: txHash, limit: '1' }
    );
    const transfer = data.jetton_transfers[0];
    if (!transfer) return null;
    if (BigInt(transfer.amount) < expectedAmountNano) return null;
    if (expectedComment && transfer.comment !== expectedComment) return null;
    return transfer;
  }
}

// ─── Convenience helpers ──────────────────────────────────────────────────────

/**
 * Create a TonCenterService from a Cloudflare Worker Env.
 */
export function initTonCenterService(env: Env): TonCenterService {
  return new TonCenterService(env.TONCENTER_API_KEY);
}

/**
 * Format a nano-LYR bigint as a human-readable LYR string.
 * e.g. 1_500_000_000n → "1.50 LYR"
 */
export function formatLyr(amountNano: bigint): string {
  const units = amountNano / NANO_FACTOR;
  const nanos = amountNano % NANO_FACTOR;
  const decimals = nanos.toString().padStart(9, '0').replace(/0+$/, '').padEnd(2, '0');
  return `${units}.${decimals} LYR`;
}

/**
 * Build a TON deep-link for depositing LYR to the vault.
 * @param vaultJettonWallet  - vault jetton wallet address
 * @param amountNano         - required amount in nano-LYR
 * @param userId             - Telegram user ID (used as memo/comment)
 */
export function buildDepositLink(
  vaultJettonWallet: string,
  amountNano: bigint,
  userId: number,
): string {
  return `ton://transfer/${vaultJettonWallet}?amount=${amountNano.toString()}&text=${encodeURIComponent(String(userId))}`;
}
