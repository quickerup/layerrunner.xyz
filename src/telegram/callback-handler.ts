import { Env } from '../config';
import { telegramIdentity } from '../core/identity';
import { resolveApproval } from '../core/chat-engine';
import { CLASS_INFO, UserClass, getOnboardingState } from '../core/profile';
import { handleClassSelection } from './onboarding';
import { answerCallbackQuery, sendTelegramMessage } from './api';
import { TelegramCallbackQuery } from './types';

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

  if (action !== 'approve' && action !== 'reject') {
    await answerCallbackQuery(env, callbackQuery.id, 'Unknown callback action.');
    return;
  }

  const actingIdentity = telegramIdentity(callbackQuery.from.id);
  const resolution = await resolveApproval(env, param, actingIdentity, action);

  switch (resolution.kind) {
    case 'not_pending':
      await answerCallbackQuery(env, callbackQuery.id, 'This approval request is no longer pending.');
      if (callbackQuery.message?.chat.id) {
        await sendTelegramMessage(env, callbackQuery.message.chat.id, '⚠️ This approval request is no longer pending.');
      }
      return;
    case 'forbidden':
      await answerCallbackQuery(env, callbackQuery.id, 'Only the requester or a Reviewer can approve or reject this action.');
      return;
    case 'reject_failed':
      await answerCallbackQuery(env, callbackQuery.id, 'Could not reject this request.');
      return;
    case 'approve_failed':
      await answerCallbackQuery(env, callbackQuery.id, 'Could not approve this request.');
      return;
    case 'rejected':
      await answerCallbackQuery(env, callbackQuery.id, 'Rejected.');
      if (resolution.chatId) await sendTelegramMessage(env, resolution.chatId, `❌ Cancelled approval request \`${resolution.requestId}\`.`);
      return;
    case 'approved_empty':
      await answerCallbackQuery(env, callbackQuery.id, 'Approved. Executing...');
      if (resolution.chatId) await sendTelegramMessage(env, resolution.chatId, `✅ Approved request \`${resolution.requestId}\`, but no executable action was available.`);
      return;
    case 'executed':
      await answerCallbackQuery(env, callbackQuery.id, 'Approved. Executing...');
      if (resolution.chatId) await sendTelegramMessage(env, resolution.chatId, resolution.text);
      return;
  }
}
