import { Env } from './config';
import { ApprovalStore } from './core/approval';
import { UserLedger } from './core/metering';
import { handleTelegramWebhook } from './telegram/webhook';
import { handleGetSession, handleLogout, handleTelegramAuthCallback } from './auth/routes';
import { handleApiApprove, handleApiChat } from './api/routes';
import { Router } from 'itty-router';

const router = Router();

// Telegram webhook endpoint
router.post('/telegram/webhook', (request: Request, env: Env) => handleTelegramWebhook(request, env));

// Web login (Telegram Login Widget -- same identity/DO as the bot)
router.post('/auth/telegram/callback', (request: Request, env: Env) => handleTelegramAuthCallback(request, env));
router.post('/auth/logout', () => handleLogout());
router.get('/api/session', (request: Request, env: Env) => handleGetSession(request, env));

// Web chat -- same pipeline the Telegram bot runs, via core/chat-engine.ts
router.post('/api/chat', (request: Request, env: Env) => handleApiChat(request, env));
router.post('/api/approve', (request: Request, env: Env) => handleApiApprove(request, env));

// Initialize webhook (temporary - call once then remove)
router.get('/init', async (request: Request, env: Env) => {
  try {
    const botToken = env.TELEGRAM_BOT_TOKEN;
    if (!botToken) {
      return new Response(JSON.stringify({ error: 'TELEGRAM_BOT_TOKEN not configured' }), { status: 400 });
    }

    const webhookUrl = new URL(request.url).origin + '/telegram/webhook';
    const response = await fetch(`https://api.telegram.org/bot${botToken}/setWebhook`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: webhookUrl }),
    });

    const result = await response.json();
    return new Response(JSON.stringify({
      success: result.ok,
      webhook_url: webhookUrl,
      telegram_response: result
    }), { status: 200 });
  } catch (error) {
    return new Response(JSON.stringify({ error: error instanceof Error ? error.message : 'Unknown error' }), { status: 500 });
  }
});

// Health check
router.get('/health', () => new Response(JSON.stringify({ status: 'ok' }), { status: 200 }));

// 404 handler
router.all('*', () => new Response('Not Found', { status: 404 }));

export default {
  fetch: router.fetch,
};

// Re-export Durable Object classes so Wrangler can register them
export { ApprovalStore, UserLedger };
