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
import { TonNetwork } from '../../lib/ton-network';

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

const TONCENTER_BASE: Record<TonNetwork, string> = {
  mainnet: 'https://toncenter.com/api/v3',
  testnet: 'https://testnet.toncenter.com/api/v3',
};

// ─── Types ────────────────────────────────────────────────────────────────────

export interface JettonWallet {
  address: string;
  owner: string;
  jetton: string;
  balance: string;
  last_transaction_lt: string;
}

// Field names verified directly against a live TonCenter v3 response for
// this project's own vault wallet -- the endpoint takes `jetton_wallet`
// (not `address`) and has no `direction`/`sender`/`created_lt` fields;
// "incoming" has to be determined client-side by comparing `destination`.
export interface JettonTransfer {
  transaction_hash: string;
  transaction_lt: string;
  transaction_now: number;
  transaction_aborted: boolean;
  amount: string;
  source: string | null; // sender's own jetton-wallet address
  destination: string | null; // recipient's own jetton-wallet address
  jetton_master: string;
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
  private readonly baseUrl: string;
  private readonly apiKey: string | undefined;

  constructor(apiKey?: string, network: TonNetwork = 'mainnet') {
    this.apiKey = apiKey;
    this.baseUrl = TONCENTER_BASE[network];
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
   * Get recent transfers touching a given jetton wallet (both directions).
   * Filter by `destination === jettonWalletAddress` for incoming only.
   */
  async getJettonTransfers(
    jettonWalletAddress: string,
    limit = 20,
  ): Promise<JettonTransfer[]> {
    const data = await this.get<{ jetton_transfers: JettonTransfer[] }>(
      '/jetton/transfers',
      { jetton_wallet: jettonWalletAddress, limit: String(limit) }
    );
    return data.jetton_transfers;
  }

  /**
   * Scan a vault wallet for new incoming LYR deposits since a given
   * logical time (pass the last-processed lt to get only new ones).
   * Excludes aborted transactions and anything not actually incoming
   * (the raw endpoint returns both directions -- see getJettonTransfers).
   */
  async getVaultDeposits(
    vaultJettonWalletAddress: string,
    sinceLt?: string,
    limit = 20,
  ): Promise<JettonTransfer[]> {
    const params: Record<string, string> = {
      jetton_wallet: vaultJettonWalletAddress,
      limit: String(limit),
    };
    if (sinceLt) params['start_lt'] = sinceLt;

    const data = await this.get<{ jetton_transfers: JettonTransfer[] }>('/jetton/transfers', params);
    return data.jetton_transfers.filter(t => !t.transaction_aborted && t.destination === vaultJettonWalletAddress);
  }

  /**
   * Verify a specific LYR transfer by transaction hash.
   * Returns the transfer if found and amount matches, null otherwise.
   */
  async verifyTransfer(
    txHash: string,
    expectedAmountNano: bigint,
  ): Promise<JettonTransfer | null> {
    const data = await this.get<{ jetton_transfers: JettonTransfer[] }>(
      '/jetton/transfers',
      { transaction_hash: txHash, limit: '1' }
    );
    const transfer = data.jetton_transfers[0];
    if (!transfer || transfer.transaction_aborted) return null;
    if (BigInt(transfer.amount) < expectedAmountNano) return null;
    return transfer;
  }

  /**
   * Runs a read-only get-method on any contract (Contract Studio's "test"
   * panel). `stack` items use TonCenter's own tuple encoding, e.g.
   * {type: 'num', value: '123'} or {type: 'slice', value: '<base64 boc>'}.
   */
  async runGetMethod(
    address: string,
    method: string,
    stack: Array<{ type: string; value: string }> = []
  ): Promise<RunGetMethodResult> {
    const url = new URL(`${this.baseUrl}/runGetMethod`);
    const res = await fetch(url.toString(), {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify({ address, method, stack }),
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`TON Center API error ${res.status}: ${text}`);
    }
    return res.json() as Promise<RunGetMethodResult>;
  }
}

export interface RunGetMethodResult {
  gas_used: number;
  exit_code: number;
  stack: Array<{ type: string; value?: string }>;
}

// ─── Convenience helpers ──────────────────────────────────────────────────────

/**
 * Create a TonCenterService from a Cloudflare Worker Env, scoped to the
 * given network (defaults to mainnet -- every existing caller before
 * Contract Studio only ever dealt with the mainnet LYR jetton).
 */
export function initTonCenterService(env: Env, network: TonNetwork = 'mainnet'): TonCenterService {
  const apiKey = network === 'testnet' ? env.TONCENTER_API_KEY_TESTNET : env.TONCENTER_API_KEY;
  return new TonCenterService(apiKey, network);
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
  memo: string,
): string {
  return `ton://transfer/${vaultJettonWallet}?amount=${amountNano.toString()}&text=${encodeURIComponent(memo)}`;
}
