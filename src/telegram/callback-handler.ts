import { Env } from '../config';
import { telegramIdentity } from '../core/identity';
import { approveRequest, getApprovalRequest, rejectRequest } from '../core/approval';
import { commitReservation, releaseReservation } from '../core/metering';
import { CLASS_INFO, UserClass, getOnboardingState, getUserProfile } from '../core/profile';
import { handleClassSelection } from './onboarding';
import { ActionExecutor } from '../services/executor';
import { answerCallbackQuery, sendTelegramMessage } from './api';
import { formatExecutionResult } from '../core/chat-engine';
import { TelegramCallbackQuery } from './types';
import { GITHUB_TOKEN_SECRET, getUserSecret } from '../core/user-secrets';

export async function handleCallbackQuery(env: Env, callbackQuery: TelegramCallbackQuery): Promise<void> {
  const data = callbackQuery.data;

  if (!data) {
    await answerCallbackQuery(env, callbackQuery.id, 'Missing callback data.');
    return;
  }

  const [action, param] = data.split(':');

  if (action === 'class') {
    const userId = callbackQuery.from.id;
    const state = await getOnboardingState(env, telegramIdentity(userId));

    if (!state || state.step !== 'class' || !(param in CLASS_INFO)) {
      await answerCallbackQuery(env, callbackQuery.id, 'This setup step already passed.');
      return;
    }

    await handleClassSelection(env, callbackQuery.message?.chat.id ?? userId, userId, param as UserClass, state);
    await answerCallbackQuery(env, callbackQuery.id, 'Class selected.');
    return;
  }

  const requestId = param;
  const request = await getApprovalRequest(env, requestId);

  if (!request || request.status !== 'pending') {
    await answerCallbackQuery(env, callbackQuery.id, 'This approval request is no longer pending.');
    if (callbackQuery.message?.chat.id) {
      await sendTelegramMessage(env, callbackQuery.message.chat.id, '⚠️ This approval request is no longer pending.');
    }
    return;
  }

  const requesterIdentity = request.identity;
  const isRequester = telegramIdentity(callbackQuery.from.id) === requesterIdentity;
  const requesterProfile = isRequester ? undefined : await getUserProfile(env, telegramIdentity(callbackQuery.from.id));
  const isReviewer = requesterProfile?.class === 'reviewer';

  if (!isRequester && !isReviewer) {
    await answerCallbackQuery(env, callbackQuery.id, 'Only the requester or a Reviewer can approve or reject this action.');
    return;
  }

  // chatId is only set for Telegram-originated requests -- always true here
  // (this handler only ever fires from a Telegram callback button), but the
  // field stays optional on ApprovalRequest since web-originated requests
  // (POST /api/approve) have no Telegram chat to notify.
  const chatId = request.chatId;

  if (action === 'reject') {
    await rejectRequest(env, requestId);
    await releaseReservation(env, requesterIdentity, request.meteringReservationId);
    await answerCallbackQuery(env, callbackQuery.id, 'Rejected.');
    if (chatId) await sendTelegramMessage(env, chatId, `❌ Cancelled approval request \`${request.id}\`.`);
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
    await releaseReservation(env, requesterIdentity, request.meteringReservationId);
    if (chatId) await sendTelegramMessage(env, chatId, `✅ Approved request \`${request.id}\`, but no executable action was available.`);
    return;
  }

  await commitReservation(env, requesterIdentity, request.meteringReservationId);

  const userGithubToken = await getUserSecret(env, requesterIdentity, GITHUB_TOKEN_SECRET);
  const executor = new ActionExecutor(env, userGithubToken);
  const lines = [`✅ Approved request \`${request.id}\`.`, '', '*Execution Result*:'];

  const results = await executor.executePlan(request.executableSteps);
  for (const executable of request.executableSteps) {
    lines.push(formatExecutionResult(executable.action, results.get(executable.id)!));
  }

  if (chatId) await sendTelegramMessage(env, chatId, lines.join('\n'));
}
