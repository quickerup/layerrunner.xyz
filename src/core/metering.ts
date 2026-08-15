import { Env } from '../config';
import { ledgerStub as sharedLedgerStub, telegramIdentity } from './identity';
import { escapeMarkdown } from './markdown';
import { ExecutionPlan } from './planner';
import { formatLyr, buildDepositLink } from '../services/ton';

const NANO_FACTOR = BigInt(1_000_000_000);

// Every new profile is credited this once, at setup — a free trial
// allowance so people can try the bot before buying LYR. Spends down
// through the normal reserve/commit flow like any other balance, so it
// needs no separate accounting: a github_deploy just costs more of it
// than a project_status does, same as paid balance.
export const FREE_TRIAL_CREDIT_NANO = BigInt(100) * NANO_FACTOR; // 100 LYR

export const FEE_TABLE: Record<string, number> = {
  help: 0,
  clarify: 0,
  project_status: 10_000_000,
  github_get_repo: 10_000_000,
  github_list_repos: 10_000_000,
  github_get_workflow_runs: 20_000_000,
  github_get_deployments: 10_000_000,
  diagnose_deployment: 50_000_000,
  github_create_repo: 250_000_000,
  github_deploy: 500_000_000,
};

export interface MeteringResult {
  ok: boolean;
  costNano: bigint;
  reservationId?: string;
  balanceNano?: bigint;
  reason?: 'insufficient_balance' | 'unpriced_action';
}

export class UserLedger {
  constructor(private readonly state: DurableObjectState) {}

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === '/reserve' && request.method === 'POST') return this.reserve(request);
    if (url.pathname === '/commit' && request.method === 'POST') return this.settleReservation(request, 'committed');
    if (url.pathname === '/release' && request.method === 'POST') return this.settleReservation(request, 'released');
    if (url.pathname === '/credit' && request.method === 'POST') return this.credit(request);
    if (url.pathname === '/balance') return json(await this.snapshot());
    if (url.pathname === '/profile' && request.method === 'GET') return this.getStored('profile');
    if (url.pathname === '/profile' && request.method === 'POST') return this.setStored('profile', request);
    if (url.pathname === '/onboarding' && request.method === 'GET') return this.getStored('onboarding');
    if (url.pathname === '/onboarding' && request.method === 'POST') return this.setStored('onboarding', request);
    if (url.pathname === '/onboarding' && request.method === 'DELETE') {
      await this.state.storage.delete('onboarding');
      return json({ ok: true });
    }
    if (url.pathname === '/secrets' && request.method === 'GET') return this.getStored('secrets');
    if (url.pathname === '/secrets' && request.method === 'POST') return this.setStored('secrets', request);
    if (url.pathname === '/secrets' && request.method === 'DELETE') {
      await this.state.storage.delete('secrets');
      return json({ ok: true });
    }
    if (url.pathname === '/pending-secret' && request.method === 'GET') return this.getStored('pendingSecret');
    if (url.pathname === '/pending-secret' && request.method === 'POST') return this.setStored('pendingSecret', request);
    if (url.pathname === '/pending-secret' && request.method === 'DELETE') {
      await this.state.storage.delete('pendingSecret');
      return json({ ok: true });
    }
    if (url.pathname === '/pending-wallet' && request.method === 'GET') return this.getStored('pendingWallet');
    if (url.pathname === '/pending-wallet' && request.method === 'POST') return this.setStored('pendingWallet', request);
    if (url.pathname === '/pending-wallet' && request.method === 'DELETE') {
      await this.state.storage.delete('pendingWallet');
      return json({ ok: true });
    }

    return new Response('not found', { status: 404 });
  }

  private async getStored(key: string): Promise<Response> {
    const value = await this.state.storage.get(key);
    if (value === undefined) return new Response('not found', { status: 404 });
    return json(value);
  }

  private async setStored(key: string, request: Request): Promise<Response> {
    const value = await request.json();
    await this.state.storage.put(key, value);
    return json({ ok: true });
  }

  private async reserve(request: Request): Promise<Response> {
    const { costNano, reservationId = crypto.randomUUID() } = await request.json() as { costNano: string; reservationId?: string };
    const cost = BigInt(costNano);
    const account = await this.snapshot();

    if (BigInt(account.balanceNano) < cost) {
      return json({ balanceNano: account.balanceNano }, { status: 402 });
    }

    const reservations = await this.reservations();
    if (reservations[reservationId]) return json({ reservationId });

    reservations[reservationId] = { amountNano: cost.toString(), status: 'reserved', createdAt: Date.now() };
    await this.state.storage.put({
      balanceNano: (BigInt(account.balanceNano) - cost).toString(),
      reservedNano: (BigInt(account.reservedNano) + cost).toString(),
      reservations,
    });

    return json({ reservationId });
  }

  private async settleReservation(request: Request, status: 'committed' | 'released'): Promise<Response> {
    const { reservationId } = await request.json() as { reservationId: string };
    const reservations = await this.reservations();
    const reservation = reservations[reservationId];
    const account = await this.snapshot();

    if (!reservation) return new Response('not found', { status: 404 });
    if (reservation.status !== 'reserved') return json({ ok: true, alreadySettled: true });

    const amount = BigInt(reservation.amountNano);
    reservation.status = status;
    reservation.settledAt = Date.now();

    const balanceNano = status === 'released'
      ? BigInt(account.balanceNano) + amount
      : BigInt(account.balanceNano);

    await this.state.storage.put({
      balanceNano: balanceNano.toString(),
      reservedNano: (BigInt(account.reservedNano) - amount).toString(),
      spentNano: (BigInt(account.spentNano) + (status === 'committed' ? amount : BigInt(0))).toString(),
      reservations,
    });

    return json({ ok: true });
  }

  private async credit(request: Request): Promise<Response> {
    const { amountNano } = await request.json() as { amountNano: string };
    const account = await this.snapshot();
    await this.state.storage.put('balanceNano', (BigInt(account.balanceNano) + BigInt(amountNano)).toString());
    return json({ ok: true });
  }

  private async snapshot(): Promise<{ balanceNano: string; reservedNano: string; spentNano: string }> {
    return {
      balanceNano: (await this.state.storage.get<string>('balanceNano')) ?? '0',
      reservedNano: (await this.state.storage.get<string>('reservedNano')) ?? '0',
      spentNano: (await this.state.storage.get<string>('spentNano')) ?? '0',
    };
  }

  private async reservations(): Promise<Record<string, { amountNano: string; status: 'reserved' | 'committed' | 'released'; createdAt: number; settledAt?: number }>> {
    return (await this.state.storage.get<Record<string, { amountNano: string; status: 'reserved' | 'committed' | 'released'; createdAt: number; settledAt?: number }>>('reservations')) ?? {};
  }
}

export async function checkAndReserve(env: Env, userId: number, plan: ExecutionPlan): Promise<MeteringResult> {
  const unpriced = plan.steps.find(step => !(step.action in FEE_TABLE));
  if (unpriced) return { ok: false, costNano: BigInt(0), reason: 'unpriced_action' };

  const totalCostNano = plan.steps.reduce((sum, step) => sum + BigInt(FEE_TABLE[step.action]), BigInt(0));
  if (totalCostNano === BigInt(0)) return { ok: true, costNano: BigInt(0) };

  const response = await ledgerStub(env, userId).fetch('https://ledger/reserve', {
    method: 'POST',
    body: JSON.stringify({ costNano: totalCostNano.toString() }),
  });

  if (response.status === 402) {
    const body = await response.json() as { balanceNano: string };
    return { ok: false, costNano: totalCostNano, balanceNano: BigInt(body.balanceNano), reason: 'insufficient_balance' };
  }

  if (!response.ok) throw new Error(`Ledger reserve failed: ${response.status}`);
  const body = await response.json() as { reservationId: string };
  return { ok: true, costNano: totalCostNano, reservationId: body.reservationId };
}

export async function commitReservation(env: Env, userId: number, reservationId?: string): Promise<void> {
  if (!reservationId) return;
  await settle(env, userId, reservationId, 'commit');
}

export async function releaseReservation(env: Env, userId: number, reservationId?: string): Promise<void> {
  if (!reservationId) return;
  await settle(env, userId, reservationId, 'release');
}

export async function creditBalance(env: Env, userId: number, amountNano: bigint): Promise<void> {
  const response = await ledgerStub(env, userId).fetch('https://ledger/credit', {
    method: 'POST',
    body: JSON.stringify({ amountNano: amountNano.toString() }),
  });
  if (!response.ok) throw new Error(`Ledger credit failed: ${response.status}`);
}

export async function getBalance(env: Env, userId: number): Promise<bigint> {
  const response = await ledgerStub(env, userId).fetch('https://ledger/balance');
  if (!response.ok) throw new Error(`Ledger balance failed: ${response.status}`);
  const body = await response.json() as { balanceNano: string };
  return BigInt(body.balanceNano);
}

export function formatTopUpPrompt(env: Env, userId: number, metering: MeteringResult): string {
  if (metering.reason === 'unpriced_action') return '⚠️ This action is not priced yet, so I cannot run it safely.';
  const balance = metering.balanceNano ?? BigInt(0);
  const shortfall = metering.costNano > balance ? metering.costNano - balance : BigInt(0);
  const vault = env.VAULT_JETTON_WALLET;
  const depositLink = vault ? buildDepositLink(vault, shortfall, userId) : null;
  return [
    `💎 *Top up required*`,
    `Balance: ${formatLyr(balance)}`,
    `Needed:  ${formatLyr(metering.costNano)}`,
    `Shortfall: ${formatLyr(shortfall)}`,
    depositLink
      ? `\nDeposit link:\n${escapeMarkdown(depositLink)}`
      : '\nVault deposit address is not configured yet.',
  ].join('\n');
}

function ledgerStub(env: Env, userId: number): DurableObjectStub {
  return sharedLedgerStub(env, telegramIdentity(userId));
}

async function settle(env: Env, userId: number, reservationId: string, action: 'commit' | 'release'): Promise<void> {
  const response = await ledgerStub(env, userId).fetch(`https://ledger/${action}`, {
    method: 'POST',
    body: JSON.stringify({ reservationId }),
  });
  if (!response.ok) throw new Error(`Ledger ${action} failed: ${response.status}`);
}

function json(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), { ...init, headers: { 'Content-Type': 'application/json', ...init.headers } });
}
