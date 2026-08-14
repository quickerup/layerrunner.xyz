/**
 * Approval System
 * Handles approval workflow for sensitive operations
 */

import { Env } from '../config';
import { escapeMarkdown } from './markdown';
import { ExecutableAction } from './planner';

export interface ApprovalRequest {
  id: string;
  userId: number;
  chatId: number;
  intent: string;
  plan: string;
  steps: string[];
  riskLevel: 'low' | 'medium' | 'high';
  status: 'pending' | 'approved' | 'rejected' | 'expired';
  createdAt: number;
  expiresAt: number;
  executableSteps: ExecutableAction[];
  meteringReservationId?: string;
  meteringCostNano?: string;
}

export interface ApprovalResponse {
  requestId: string;
  approved: boolean;
  feedback?: string;
  timestamp: number;
}

export class ApprovalStore {
  constructor(private readonly state: DurableObjectState) {}

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === '/create' && request.method === 'POST') {
      const approval = await request.json() as ApprovalRequest;
      await this.state.storage.put('request', approval);
      return json(approval);
    }

    const approval = await this.state.storage.get<ApprovalRequest>('request');
    if (!approval) {
      return new Response('not found', { status: 404 });
    }

    const current = expireIfNeeded(approval);

    if (url.pathname === '/get') {
      if (current.status !== approval.status) await this.state.storage.put('request', current);
      return json(current);
    }

    if (url.pathname === '/approve' && request.method === 'POST') {
      if (current.status !== 'pending') return json({ ok: false, request: current }, { status: 409 });
      current.status = 'approved';
      await this.state.storage.put('request', current);
      return json({ ok: true, request: current });
    }

    if (url.pathname === '/reject' && request.method === 'POST') {
      if (current.status !== 'pending') return json({ ok: false, request: current }, { status: 409 });
      current.status = 'rejected';
      await this.state.storage.put('request', current);
      return json({ ok: true, request: current });
    }

    return new Response('not found', { status: 404 });
  }
}

export async function createApprovalRequest(
  env: Env,
  userId: number,
  chatId: number,
  intent: string,
  plan: string,
  steps: string[],
  riskLevel: 'low' | 'medium' | 'high',
  executableSteps: ExecutableAction[] = [],
  meteringReservationId?: string,
  meteringCostNano?: string
): Promise<ApprovalRequest> {
  const id = generateRequestId();
  const now = Date.now();
  const expiresAt = now + 15 * 60 * 1000;

  const approval: ApprovalRequest = {
    id,
    userId,
    chatId,
    intent,
    plan,
    steps,
    riskLevel,
    status: 'pending',
    createdAt: now,
    expiresAt,
    executableSteps,
    meteringReservationId,
    meteringCostNano,
  };

  const response = await approvalStub(env, id).fetch('https://approval/create', {
    method: 'POST',
    body: JSON.stringify(approval),
  });

  if (!response.ok) throw new Error(`Failed to persist approval request: ${response.status}`);
  return approval;
}

export async function getApprovalRequest(env: Env, requestId: string): Promise<ApprovalRequest | undefined> {
  const response = await approvalStub(env, requestId).fetch('https://approval/get');
  if (response.status === 404) return undefined;
  if (!response.ok) throw new Error(`Failed to load approval request: ${response.status}`);
  return response.json() as Promise<ApprovalRequest>;
}

export async function approveRequest(env: Env, requestId: string): Promise<boolean> {
  const response = await approvalStub(env, requestId).fetch('https://approval/approve', { method: 'POST' });
  return response.ok;
}

export async function rejectRequest(env: Env, requestId: string): Promise<boolean> {
  const response = await approvalStub(env, requestId).fetch('https://approval/reject', { method: 'POST' });
  return response.ok;
}

export function formatApprovalMessage(request: ApprovalRequest): string {
  const riskEmoji = { low: '🟢', medium: '🟡', high: '🔴' };
  const lines: string[] = [];
  lines.push(`${riskEmoji[request.riskLevel]} *Approval Required*`);
  lines.push(`\n*Intent*: ${escapeMarkdown(request.intent)}`);
  lines.push(`*Plan*: ${escapeMarkdown(request.plan)}`);

  if (request.meteringCostNano && BigInt(request.meteringCostNano) > BigInt(0)) {
    lines.push(`*Reserved fee*: ${formatJettonAmount(BigInt(request.meteringCostNano))} JETTON`);
  }

  if (request.steps.length > 0) {
    lines.push(`\n*Steps*:`);
    request.steps.forEach((step, i) => lines.push(`${i + 1}. ${escapeMarkdown(step)}`));
  }

  lines.push(`\n*Request ID*: \`${request.id}\``);
  lines.push(`_Expires in 15 minutes_`);
  return lines.join('\n');
}

function approvalStub(env: Env, requestId: string): DurableObjectStub {
  const id = env.APPROVALS.idFromName(requestId);
  return env.APPROVALS.get(id);
}

function expireIfNeeded(request: ApprovalRequest): ApprovalRequest {
  if (request.status === 'pending' && request.expiresAt < Date.now()) {
    return { ...request, status: 'expired' };
  }
  return request;
}

function formatJettonAmount(amountNano: bigint): string {
  const units = amountNano / BigInt(1_000_000_000);
  const nanos = amountNano % BigInt(1_000_000_000);
  return `${units}.${nanos.toString().padStart(9, '0').replace(/0+$/, '').padEnd(2, '0')}`;
}

function json(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    ...init,
    headers: { 'Content-Type': 'application/json', ...init.headers },
  });
}

function generateRequestId(): string {
  return crypto.randomUUID().slice(0, 8);
}
