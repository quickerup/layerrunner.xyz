/**
 * Telegram API Types
 * Minimal type definitions for message and callback handling
 */

export interface TelegramUpdate {
  update_id: number;
  message?: TelegramMessage;
  callback_query?: TelegramCallbackQuery;
}

export interface TelegramMessage {
  message_id: number;
  date: number;
  chat: TelegramChat;
  from: TelegramUser;
  text?: string;
}

export interface TelegramCallbackQuery {
  id: string;
  from: TelegramUser;
  message?: TelegramMessage;
  data?: string;
}

export interface TelegramChat {
  id: number;
  type: 'private' | 'group' | 'supergroup' | 'channel';
  username?: string;
}

export interface TelegramUser {
  id: number;
  is_bot: boolean;
  first_name: string;
  last_name?: string;
  username?: string;
}

export type TelegramInlineKeyboardButton =
  | { text: string; callback_data: string; url?: never }
  | { text: string; url: string; callback_data?: never };

export interface TelegramSendMessageParams {
  chat_id: number;
  text: string;
  parse_mode?: 'Markdown' | 'MarkdownV2' | 'HTML';
  reply_to_message_id?: number;
  reply_markup?: {
    inline_keyboard: TelegramInlineKeyboardButton[][];
  };
}
