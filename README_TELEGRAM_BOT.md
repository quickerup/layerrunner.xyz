/**
 * Layer Runners - Telegram Bot
 * 
 * This is the main entry point for the Cloudflare Worker that handles
 * Telegram webhook requests and orchestrates the intent → plan → execute flow.
 * 
 * Architecture:
 * 1. Telegram sends updates to /telegram/webhook
 * 2. Webhook handler validates and extracts message
 * 3. Message handler parses intent and generates plan
 * 4. Response is sent back to user via Telegram API
 */

export {};
