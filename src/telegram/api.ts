import { Env } from '../config';
import { TelegramInlineKeyboardButton, TelegramSendMessageParams } from './types';

const TELEGRAM_API_BASE = 'https://api.telegram.org/bot';

export async function sendTelegramMessage(
  env: Env,
  chatId: number,
  text: string,
  parseMode: 'Markdown' | 'MarkdownV2' | 'HTML' = 'Markdown'
): Promise<void> {
  await callTelegramApi(env, 'sendMessage', {
    chat_id: chatId,
    text,
    parse_mode: parseMode,
  });
}

export async function sendTelegramMessageWithButtons(
  env: Env,
  chatId: number,
  text: string,
  buttons: TelegramInlineKeyboardButton[][],
  parseMode: 'Markdown' | 'MarkdownV2' | 'HTML' = 'Markdown'
): Promise<void> {
  const params: TelegramSendMessageParams = {
    chat_id: chatId,
    text,
    parse_mode: parseMode,
    reply_markup: { inline_keyboard: buttons },
  };

  await callTelegramApi(env, 'sendMessage', { ...params });
}

export async function answerCallbackQuery(
  env: Env,
  callbackQueryId: string,
  text?: string
): Promise<void> {
  await callTelegramApi(env, 'answerCallbackQuery', {
    callback_query_id: callbackQueryId,
    text,
  });
}

/**
 * Best-effort delete — used to scrub a message containing a plaintext
 * secret right after it's stored. Telegram only allows bots to delete
 * incoming messages in private chats within 48h; if that's not met (or
 * anything else goes wrong), this returns false rather than throwing —
 * a failed scrub shouldn't block the secret having already been saved.
 */
export async function deleteTelegramMessage(env: Env, chatId: number, messageId: number): Promise<boolean> {
  try {
    await callTelegramApi(env, 'deleteMessage', { chat_id: chatId, message_id: messageId });
    return true;
  } catch (error) {
    console.warn('Failed to delete Telegram message:', error);
    return false;
  }
}

async function callTelegramApi(env: Env, method: string, params: Record<string, unknown>): Promise<void> {
  const botToken = env.TELEGRAM_BOT_TOKEN;

  if (!botToken) {
    throw new Error('TELEGRAM_BOT_TOKEN is not configured');
  }

  const url = `${TELEGRAM_API_BASE}${botToken}/${method}`;
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  });

  if (response.ok) return;

  const error = await response.json();

  // A Markdown parse error means *something* in the text wasn't escaped
  // right -- rather than the whole message silently vanishing behind a
  // generic error, retry once as plain text so the user still gets a
  // response. The full text is logged so the actual unescaped field can
  // still be found and fixed properly.
  if (params.parse_mode && isMarkdownParseError(error)) {
    console.error('Telegram Markdown parse error, retrying as plain text:', JSON.stringify(error), '| text:', params.text);
    const retryResponse = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...params, parse_mode: undefined }),
    });
    if (retryResponse.ok) return;
    const retryError = await retryResponse.json();
    throw new Error(`Telegram API error: ${JSON.stringify(retryError)}`);
  }

  throw new Error(`Telegram API error: ${JSON.stringify(error)}`);
}

function isMarkdownParseError(error: any): boolean {
  return error?.error_code === 400 && typeof error?.description === 'string' && /can't parse entities/i.test(error.description);
}
