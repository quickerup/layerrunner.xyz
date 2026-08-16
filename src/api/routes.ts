/**
 * Web chat API -- the browser-facing counterpart to the Telegram webhook,
 * both driving core/chat-engine.ts. Every route here requires a valid
 * session cookie (see core/session.ts); there is no separate web-only auth.
 */

import { Env } from '../config';
import { ApprovalResolution, resolveApproval, runChatEngine } from '../core/chat-engine';
import { SessionPayload, mintSession, readSessionCookie, sessionCookieHeader, shouldRefresh, verifySession } from '../core/session';
import { createPlanProvider } from '../services/ai-provider';
import { getTrackedContracts, saveTrackedContract, TrackedContract } from '../core/contracts';
import { initTonCenterService } from '../services/ton';
import { TonNetwork } from '../../lib/ton-network';

function json(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    ...init,
    headers: { 'Content-Type': 'application/json', ...init.headers },
  });
}

// Active sessions get quietly reissued once past half-life, on any
// authenticated request, so a browsing user never hits a hard logout.
async function refreshHeaders(env: Env, payload: SessionPayload): Promise<HeadersInit> {
  if (!shouldRefresh(payload)) return {};
  const token = await mintSession(env, payload.identity, payload.provider);
  return { 'Set-Cookie': sessionCookieHeader(token) };
}

export async function handleApiChat(request: Request, env: Env): Promise<Response> {
  const payload = await verifySession(env, readSessionCookie(request));
  if (!payload) return json({ ok: false, error: 'Not signed in.' }, { status: 401 });

  let body: { text?: string };
  try {
    body = await request.json();
  } catch {
    return json({ ok: false, error: 'Invalid request body' }, { status: 400 });
  }

  const text = typeof body.text === 'string' ? body.text.trim() : '';
  if (!text) return json({ ok: false, error: 'Message text is required.' }, { status: 400 });

  const headers = await refreshHeaders(env, payload);

  try {
    const response = await runChatEngine(env, payload.identity, text);
    if (response.kind === 'approval') {
      return json({ ok: true, text: response.text, pendingApproval: { requestId: response.requestId } }, { headers });
    }
    return json({ ok: true, text: response.text }, { headers });
  } catch (error) {
    console.error('Chat engine error:', error);
    return json({ ok: false, error: 'Something went wrong processing that.' }, { status: 500, headers });
  }
}

export async function handleApiApprove(request: Request, env: Env): Promise<Response> {
  const payload = await verifySession(env, readSessionCookie(request));
  if (!payload) return json({ ok: false, error: 'Not signed in.' }, { status: 401 });

  let body: { requestId?: string; action?: string };
  try {
    body = await request.json();
  } catch {
    return json({ ok: false, error: 'Invalid request body' }, { status: 400 });
  }

  if (typeof body.requestId !== 'string' || (body.action !== 'approve' && body.action !== 'reject')) {
    return json({ ok: false, error: 'requestId and action ("approve" or "reject") are required.' }, { status: 400 });
  }

  const headers = await refreshHeaders(env, payload);
  const resolution = await resolveApproval(env, body.requestId, payload.identity, body.action);
  return json(formatResolution(resolution), { status: resolutionStatus(resolution), headers });
}

function formatResolution(resolution: ApprovalResolution): { ok: boolean; text?: string; error?: string } {
  switch (resolution.kind) {
    case 'not_pending':
      return { ok: false, error: 'This approval request is no longer pending.' };
    case 'forbidden':
      return { ok: false, error: 'Only the requester or a Reviewer can approve or reject this action.' };
    case 'reject_failed':
      return { ok: false, error: 'Could not reject this request.' };
    case 'approve_failed':
      return { ok: false, error: 'Could not approve this request.' };
    case 'rejected':
      return { ok: true, text: `Cancelled approval request ${resolution.requestId}.` };
    case 'approved_empty':
      return { ok: true, text: `Approved request ${resolution.requestId}, but no executable action was available.` };
    case 'executed':
      return { ok: true, text: resolution.text };
  }
}

function isTonNetwork(value: unknown): value is TonNetwork {
  return value === 'mainnet' || value === 'testnet';
}

// Contract Studio: compiling happens entirely client-side (no server call,
// no auth needed). These three routes cover the pieces that need a secret
// (AI fix, TonCenter's API key for get-methods) or shared per-identity
// storage (the tracked-contracts list) -- all gated the same way /api/chat
// is, via the session cookie.
export async function handleApiContractFix(request: Request, env: Env): Promise<Response> {
  const payload = await verifySession(env, readSessionCookie(request));
  if (!payload) return json({ ok: false, error: 'Not signed in.' }, { status: 401 });

  let body: { source?: string; error?: string };
  try {
    body = await request.json();
  } catch {
    return json({ ok: false, error: 'Invalid request body' }, { status: 400 });
  }

  if (typeof body.source !== 'string' || !body.source.trim() || typeof body.error !== 'string' || !body.error.trim()) {
    return json({ ok: false, error: 'source and error are required.' }, { status: 400 });
  }

  try {
    const fixed = await createPlanProvider(env).fixTolkSource(body.source, body.error);
    return json({ ok: true, source: fixed });
  } catch (error) {
    console.error('Contract fix error:', error);
    return json({ ok: false, error: 'Could not get an AI fix right now.' }, { status: 502 });
  }
}

export async function handleApiContractsList(request: Request, env: Env): Promise<Response> {
  const payload = await verifySession(env, readSessionCookie(request));
  if (!payload) return json({ ok: false, error: 'Not signed in.' }, { status: 401 });

  const contracts = await getTrackedContracts(env, payload.identity);
  return json({ ok: true, contracts });
}

export async function handleApiContractsTrack(request: Request, env: Env): Promise<Response> {
  const payload = await verifySession(env, readSessionCookie(request));
  if (!payload) return json({ ok: false, error: 'Not signed in.' }, { status: 401 });

  let body: Partial<TrackedContract>;
  try {
    body = await request.json();
  } catch {
    return json({ ok: false, error: 'Invalid request body' }, { status: 400 });
  }

  if (
    typeof body.address !== 'string' || !body.address.trim() ||
    !isTonNetwork(body.network) ||
    typeof body.label !== 'string' || !body.label.trim()
  ) {
    return json({ ok: false, error: 'address, network, and label are required.' }, { status: 400 });
  }

  const contracts = await saveTrackedContract(env, payload.identity, {
    address: body.address,
    network: body.network,
    label: body.label,
    codeHash: typeof body.codeHash === 'string' ? body.codeHash : undefined,
    deployedAt: typeof body.deployedAt === 'number' ? body.deployedAt : Date.now(),
  });
  return json({ ok: true, contracts });
}

export async function handleApiContractsCall(request: Request, env: Env): Promise<Response> {
  const payload = await verifySession(env, readSessionCookie(request));
  if (!payload) return json({ ok: false, error: 'Not signed in.' }, { status: 401 });

  let body: { address?: string; network?: string; method?: string; stack?: Array<{ type: string; value: string }> };
  try {
    body = await request.json();
  } catch {
    return json({ ok: false, error: 'Invalid request body' }, { status: 400 });
  }

  if (
    typeof body.address !== 'string' || !body.address.trim() ||
    !isTonNetwork(body.network) ||
    typeof body.method !== 'string' || !body.method.trim()
  ) {
    return json({ ok: false, error: 'address, network, and method are required.' }, { status: 400 });
  }

  try {
    const ton = initTonCenterService(env, body.network);
    const result = await ton.runGetMethod(body.address, body.method, Array.isArray(body.stack) ? body.stack : []);
    return json({ ok: true, result });
  } catch (error) {
    console.error('Contract get-method call error:', error);
    return json({ ok: false, error: error instanceof Error ? error.message : 'Get-method call failed.' }, { status: 502 });
  }
}

function resolutionStatus(resolution: ApprovalResolution): number {
  switch (resolution.kind) {
    case 'not_pending': return 409;
    case 'forbidden': return 403;
    case 'reject_failed':
    case 'approve_failed': return 500;
    default: return 200;
  }
}
