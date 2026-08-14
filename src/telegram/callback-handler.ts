import { Env } from '../config';
import { approveRequest, getApprovalRequest, rejectRequest } from '../core/approval';
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
  const request = getApprovalRequest(requestId);

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
    rejectRequest(requestId);
    await answerCallbackQuery(env, callbackQuery.id, 'Rejected.');
    await sendTelegramMessage(env, request.chatId, `❌ Cancelled approval request \`${request.id}\`.`);
    return;
  }

  if (action !== 'approve') {
    await answerCallbackQuery(env, callbackQuery.id, 'Unknown approval action.');
    return;
  }

  if (!approveRequest(requestId)) {
    await answerCallbackQuery(env, callbackQuery.id, 'Could not approve this request.');
    return;
  }

  await answerCallbackQuery(env, callbackQuery.id, 'Approved. Executing...');

  if (request.executableSteps.length === 0) {
    await sendTelegramMessage(env, request.chatId, `✅ Approved request \`${request.id}\`, but no executable action was available.`);
    return;
  }

  const executor = new ActionExecutor(env);
  const lines = [`✅ Approved request \`${request.id}\`.`, '', '*Execution Result*:'];

  for (const executable of request.executableSteps) {
    const result = await executor.executeAction(executable.action, executable.params);
    lines.push(formatExecutionResult(executable.action, result));
  }

  await sendTelegramMessage(env, request.chatId, lines.join('\n'));
}
