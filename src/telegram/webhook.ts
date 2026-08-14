import { Env } from '../config';
import { handleCallbackQuery } from './callback-handler';
import { handleMessage } from './message-handler';
import { TelegramMessage, TelegramUpdate } from './types';

export async function handleTelegramWebhook(request: Request, env: Env): Promise<Response> {
  try {
    const update: TelegramUpdate = await request.json();

    if (update.callback_query) {
      handleCallbackQuery(env, update.callback_query).catch(error => {
        console.error('Error handling callback query:', error);
      });
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    }

    if (!update.message) {
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    }

    const message: TelegramMessage = update.message;

    handleMessage(env, message).catch(error => {
      console.error('Error handling message:', error);
    });

    return new Response(JSON.stringify({ ok: true }), { status: 200 });
  } catch (error) {
    console.error('Webhook error:', error);
    return new Response(JSON.stringify({ ok: false, error: 'Internal error' }), { status: 500 });
  }
}
