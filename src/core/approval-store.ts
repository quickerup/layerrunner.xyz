/**
 * ApprovalStore Durable Object
 * Persists approval requests using Durable Object SQLite storage.
 */

import { Env } from '../config';

export interface ApprovalRequest {
  id: string;
  userId: number;
  chatId: number;
  intent: string;
  plan: string;
  steps: string[];
  executableSteps: Array<{ action: string; params: Record<string, any> }>;
  riskLevel: 'low' | 'medium' | 'high';
  status: 'pending' | 'approved' | 'rejected' | 'expired';
  meteringReservationId?: string;
  createdAt: number;
  expiresAt: number;
}

export class ApprovalStore {
  constructor(private readonly state: DurableObjectState) {}

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === '/create' && request.method === 'POST') return this.create(request);
    if (url.pathname === '/get' && request.method === 'GET') return this.get(url);
    if (url.pathname === '/approve' && request.method === 'POST') return this.setStatus(request, 'approved');
    if (url.pathname === '/reject' && request.method === 'POST') return this.setStatus(request, 'rejected');

    return new Response('not found', { status: 404 });
  }

  private async create(request: Request): Promise<Response> {
    const data = await request.json() as ApprovalRequest;
    await this.state.storage.put(`request:${data.id}`, data);
    return json({ ok: true, id: data.id });
  }

  private async get(url: URL): Promise<Response> {
    const id = url.searchParams.get('id');
    if (!id) return new Response('missing id', { status: 400 });
    const record = await this.state.storage.get<ApprovalRequest>(`request:${id}`);
    if (!record) return new Response('not found', { status: 404 });
    // Check expiry
    if (record.expiresAt < Date.now() && record.status === 'pending') {
      record.status = 'expired';
      await this.state.storage.put(`request:${id}`, record);
    }
    return json(record);
  }

  private async setStatus(request: Request, status: 'approved' | 'rejected'): Promise<Response> {
    const { id } = await request.json() as { id: string };
    const record = await this.state.storage.get<ApprovalRequest>(`request:${id}`);
    if (!record) return new Response('not found', { status: 404 });
    if (record.status !== 'pending') return json({ ok: false, reason: 'not_pending' });
    record.status = status;
    await this.state.storage.put(`request:${id}`, record);
    return json({ ok: true });
  }
}

// ---------------------------------------------------------------------------
// Helper functions used by callback-handler and other modules
// ---------------------------------------------------------------------------

function approvalStub(env: Env, requestId: string): DurableObjectStub {
  // Shard by request ID so each request gets its own DO instance
  const id = env.APPROVALS.idFromName(requestId);
  return env.APPROVALS.get(id);
}

export async function getApprovalRequest(env: Env, requestId: string): Promise<ApprovalRequest | undefined> {
  const stub = approvalStub(env, requestId);
  const res = await stub.fetch(`https://approvals/get?id=${encodeURIComponent(requestId)}`);
  if (res.status === 404) return undefined;
  return res.json() as Promise<ApprovalRequest>;
}

export async function approveRequest(env: Env, requestId: string): Promise<boolean> {
  const stub = approvalStub(env, requestId);
  const res = await stub.fetch('https://approvals/approve', {
    method: 'POST',
    body: JSON.stringify({ id: requestId }),
  });
  const body = await res.json() as { ok: boolean };
  return body.ok;
}

export async function rejectRequest(env: Env, requestId: string): Promise<void> {
  const stub = approvalStub(env, requestId);
  await stub.fetch('https://approvals/reject', {
    method: 'POST',
    body: JSON.stringify({ id: requestId }),
  });
}

export async function createApprovalRequest(
  env: Env,
  data: Omit<ApprovalRequest, 'id' | 'status' | 'createdAt' | 'expiresAt'>
): Promise<ApprovalRequest> {
  const id = `approve_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
  const now = Date.now();
  const request: ApprovalRequest = {
    ...data,
    id,
    status: 'pending',
    createdAt: now,
    expiresAt: now + 15 * 60 * 1000,
  };
  const stub = approvalStub(env, id);
  await stub.fetch('https://approvals/create', {
    method: 'POST',
    body: JSON.stringify(request),
  });
  return request;
}

function json(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    ...init,
    headers: { 'Content-Type': 'application/json', ...init.headers },
  });
}
