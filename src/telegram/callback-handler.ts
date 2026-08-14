import { Env } from '../config';
import { approveRequest, getApprovalRequest, rejectRequest } from '../core/approval-store';
import { commitReservation, releaseReservation } from '../core/metering';
import { ActionExecutor } from '../services/executor';
import { answerCallbackQuery, sendTelegramMessage } from './api';
import { formatExecutionResult } from './message-handler';
import { TelegramCallbackQuery } from './types';

export async function handleCallbackQuery(env: Env, callbackQuery: TelegramCallbackQuery): Promise<void> {
  const data = callbackQuery.data;

  if (!data) {
    await answerCallbackQuery(env, callbackQuery.id, 'Missing callback data.');
    return;
  }

  const [action, requestId] = data.split(':');
  const request = await getApprovalRequest(env, requestId);

  if (!request || request.status !== 'pending') {
    await answerCallbackQuery(env, callbackQuery.id, 'This approval request is no longer pending.');
    if (callbackQuery.message?.chat.id) {
      await sendTelegramMessage(env, callbackQuery.message.chat.id, '⚠️ This approval request is no longer pending.');
    }
    return;
  }

  if (callbackQuery.from.id !== request.userId) {
    await answerCallbackQuery(env, callbackQuery.id, 'Only the requester can approve or reject this action.');
    return;
  }

  if (action === 'reject') {
    await rejectRequest(env, requestId);
    await releaseReservation(env, request.userId, request.meteringReservationId);
    await answerCallbackQuery(env, callbackQuery.id, 'Rejected.');
    await sendTelegramMessage(env, request.chatId, `❌ Cancelled approval request \`${request.id}\`.`);
    return;
  }

  if (action !== 'approve') {
    await answerCallbackQuery(env, callbackQuery.id, 'Unknown approval action.');
    return;
  }

  if (!await approveRequest(env, requestId)) {
    await answerCallbackQuery(env, callbackQuery.id, 'Could not approve this request.');
    return;
  }

  await answerCallbackQuery(env, callbackQuery.id, 'Approved. Executing...');

  if (request.executableSteps.length === 0) {
    await releaseReservation(env, request.userId, request.meteringReservationId);
    await sendTelegramMessage(env, request.chatId, `✅ Approved request \`${request.id}\`, but no executable action was available.`);
    return;
  }

  await commitReservation(env, request.userId, request.meteringReservationId);

  const executor = new ActionExecutor(env);
  const lines = [`✅ Approved request \`${request.id}\`.`, '', '*Execution Result*:'];

  for (const executable of request.executableSteps) {
    const result = await executor.executeAction(executable.action, executable.params);
    lines.push(formatExecutionResult(executable.action, result));
  }

  await sendTelegramMessage(env, request.chatId, lines.join('\n'));
}
