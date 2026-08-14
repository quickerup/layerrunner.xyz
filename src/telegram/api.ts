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

async function callTelegramApi(env: Env, method: string, params: Record<string, unknown>): Promise<void> {
  const botToken = env.TELEGRAM_BOT_TOKEN;

  if (!botToken) {
    throw new Error('TELEGRAM_BOT_TOKEN is not configured');
  }

  const response = await fetch(`${TELEGRAM_API_BASE}${botToken}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(`Telegram API error: ${JSON.stringify(error)}`);
  }
}
