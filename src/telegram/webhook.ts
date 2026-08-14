import { TelegramUpdate, TelegramMessage } from './types';
import { handleMessage } from './message-handler';

export async function handleTelegramWebhook(request: Request): Promise<Response> {
  try {
    const update: TelegramUpdate = await request.json();
    
    // Only process messages
    if (!update.message) {
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    }

    const message: TelegramMessage = update.message;
    
    // Process the message asynchronously
    handleMessage(message).catch(error => {
      console.error('Error handling message:', error);
    });

    // Return immediately to Telegram (required)
    return new Response(JSON.stringify({ ok: true }), { status: 200 });
  } catch (error) {
    console.error('Webhook error:', error);
    return new Response(JSON.stringify({ ok: false, error: 'Internal error' }), { status: 500 });
  }
}
