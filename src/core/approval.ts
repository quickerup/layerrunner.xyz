/**
 * Approval System
 * Handles approval workflow for sensitive operations
 */

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
}

export interface ApprovalResponse {
  requestId: string;
  approved: boolean;
  feedback?: string;
  timestamp: number;
}

/**
 * In-memory approval store
 * In production, this should be persisted to a database (Supabase, D1, etc)
 */
const approvalStore = new Map<string, ApprovalRequest>();

export function createApprovalRequest(
  userId: number,
  chatId: number,
  intent: string,
  plan: string,
  steps: string[],
  riskLevel: 'low' | 'medium' | 'high'
): ApprovalRequest {
  const id = generateRequestId();
  const now = Date.now();
  const expiresAt = now + 15 * 60 * 1000; // 15 minute expiration
  
  const request: ApprovalRequest = {
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
  };
  
  approvalStore.set(id, request);
  return request;
}

export function getApprovalRequest(requestId: string): ApprovalRequest | undefined {
  const request = approvalStore.get(requestId);
  
  if (request && request.expiresAt < Date.now()) {
    request.status = 'expired';
  }
  
  return request;
}

export function approveRequest(requestId: string): boolean {
  const request = getApprovalRequest(requestId);
  
  if (!request || request.status !== 'pending') {
    return false;
  }
  
  request.status = 'approved';
  return true;
}

export function rejectRequest(requestId: string): boolean {
  const request = getApprovalRequest(requestId);
  
  if (!request || request.status !== 'pending') {
    return false;
  }
  
  request.status = 'rejected';
  return true;
}

export function formatApprovalMessage(request: ApprovalRequest): string {
  const riskEmoji = {
    low: '🟢',
    medium: '🟡',
    high: '🔴',
  };
  
  const lines: string[] = [];
  lines.push(`${riskEmoji[request.riskLevel]} *Approval Required*`);
  lines.push(`\n*Intent*: ${request.intent}`);
  lines.push(`*Plan*: ${request.plan}`);
  
  if (request.steps.length > 0) {
    lines.push(`\n*Steps*:`);
    request.steps.forEach((step, i) => {
      lines.push(`${i + 1}. ${step}`);
    });
  }
  
  lines.push(`\n*Request ID*: \`${request.id}\``);
  lines.push(`_Expires in 15 minutes_`);
  
  return lines.join('\n');
}

function generateRequestId(): string {
  return `approve_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}
