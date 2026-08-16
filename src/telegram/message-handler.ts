import { Env } from '../config';
import { telegramIdentity } from '../core/identity';
import { formatPermissionDenied, runChatEngine } from '../core/chat-engine';
import {
  UserProfile,
  clearAwaitingWalletLink,
  getOnboardingState,
  getUserProfile,
  isAwaitingWalletLink,
  saveUserProfile,
  setAwaitingWalletLink,
} from '../core/profile';
import { beginOnboarding, handleOnboardingMessage, isStartCommand } from './onboarding';
import { formatLyr, initTonCenterService } from '../services/ton';
import { sendTelegramMessage, sendTelegramMessageWithButtons, deleteTelegramMessage } from './api';
import { TelegramMessage } from './types';
import {
  GITHUB_TOKEN_SECRET,
  clearPendingSecretInput,
  clearUserSecret,
  getPendingSecretInput,
  getUserSecret,
  hasUserSecret,
  setPendingSecretInput,
  setUserSecret,
} from '../core/user-secrets';

export async function handleMessage(env: Env, message: TelegramMessage): Promise<void> {
  const { text, chat, from, message_id } = message;

  if (!text) {
    return;
  }

  const identity = telegramIdentity(from.id);

  try {
    const onboarding = await getOnboardingState(env, identity);
    if (onboarding) {
      await handleOnboardingMessage(env, chat.id, from.id, text, onboarding);
      return;
    }

    const profile = await getUserProfile(env, identity);

    if (!profile) {
      if (isStartCommand(text)) {
        await beginOnboarding(env, chat.id, from.id);
      } else {
        await sendTelegramMessage(env, chat.id, 'Send /start to get set up first.');
      }
      return;
    }

    const pendingSecret = await getPendingSecretInput(env, identity);
    if (pendingSecret) {
      await handlePendingSecretInput(env, chat.id, identity, message_id, text, pendingSecret.name);
      return;
    }

    if (await isAwaitingWalletLink(env, identity)) {
      await handlePendingWalletLink(env, chat.id, profile, text);
      return;
    }

    if (/^\s*\/link_wallet\b/.test(text)) {
      await setAwaitingWalletLink(env, identity);
      await sendTelegramMessage(env, chat.id, [
        profile.walletAddress
          ? `🔗 You already have \`${profile.walletAddress}\` linked — paste a new address now to replace it.`
          : '🔗 Paste your TON wallet address now, as your next message.',
        '',
        "This is just your public address, not a secret — I'll use it to read its LYR balance and to detect when you send LYR to the vault, so I can top up your balance automatically once your free credit runs out. Remove it anytime with `/unlink_wallet`.",
        '',
        'Send `/cancel` to back out.',
      ].join('\n'));
      return;
    }

    if (/^\s*\/unlink_wallet\b/.test(text)) {
      if (!profile.walletAddress) {
        await sendTelegramMessage(env, chat.id, "You don't have a wallet linked.");
        return;
      }
      await saveUserProfile(env, { ...profile, walletAddress: undefined, lastDepositLt: undefined });
      await sendTelegramMessage(env, chat.id, '🔓 Wallet unlinked.');
      return;
    }

    if (/^\s*\/connect_github\b/.test(text)) {
      const alreadyConnected = await hasUserSecret(env, identity, GITHUB_TOKEN_SECRET);
      await setPendingSecretInput(env, identity, { name: GITHUB_TOKEN_SECRET });
      await sendTelegramMessage(env, chat.id, [
        alreadyConnected
          ? '🔐 You already have a GitHub token connected — send a new one now to replace it.'
          : '🔐 Send your GitHub personal access token now, as your next message.',
        '',
        "It'll be encrypted and stored on Cloudflare so I can act on your GitHub account instead of the default one — I'll delete your message with the token right after, so it doesn't sit in this chat. Remove it anytime with `/disconnect_github`.",
        '',
        'Send `/cancel` to back out without connecting anything.',
      ].join('\n'));
      return;
    }

    if (/^\s*\/disconnect_github\b/.test(text)) {
      const wasConnected = await hasUserSecret(env, identity, GITHUB_TOKEN_SECRET);
      await clearUserSecret(env, identity, GITHUB_TOKEN_SECRET);
      await sendTelegramMessage(
        env,
        chat.id,
        wasConnected
          ? "🔓 Disconnected. I'll use the default configured GitHub account for you from now on."
          : "You don't have a personal GitHub token connected."
      );
      return;
    }

    // Temporary: deploys the LYR sale contract via a connect-wallet-and-sign
    // page, so no deployer mnemonic ever touches this bot. Remove this
    // command (and unlink/remove /admin-deploy on the site) once the real
    // deploy is done — there's no reason to leave a "deploy a fresh sale
    // contract" button live indefinitely.
    if (/^\s*\/deploy\b/.test(text)) {
      if (profile.class !== 'deployer') {
        await sendTelegramMessage(env, chat.id, formatPermissionDenied(profile));
        return;
      }
      await sendTelegramMessageWithButtons(env, chat.id, '🛠️ Connect your wallet and sign the deploy transaction:', [
        [{ text: 'Deploy LYR sale contract', url: 'https://layerrunners.xyz/admin-deploy' }],
      ]);
      return;
    }

    // Withdraws accumulated TON revenue from the sale contract — every TON
    // someone pays to buy LYR sits in the contract itself until this is
    // run. Only the contract's actual admin wallet can sign a withdrawal
    // that succeeds; anyone else's transaction just fails on-chain.
    if (/^\s*\/collect\b/.test(text)) {
      if (profile.class !== 'deployer') {
        await sendTelegramMessage(env, chat.id, formatPermissionDenied(profile));
        return;
      }
      await sendTelegramMessageWithButtons(env, chat.id, '💰 Connect the admin wallet and sign to withdraw accumulated TON revenue:', [
        [{ text: 'Collect TON revenue', url: 'https://layerrunners.xyz/admin-collect' }],
      ]);
      return;
    }

    // Telegram itself needs no separate login -- this chat already IS your
    // identity. The web /login page is for the *other* identities (GitHub,
    // Google, TON wallet) that don't exist here, so route the button there
    // instead of letting "/login" fall through to the planner as an
    // unrecognized action.
    if (/^\s*\/login\b/.test(text)) {
      await sendTelegramMessageWithButtons(
        env,
        chat.id,
        "You're already signed in here — this chat is your account. `/login` is for the website, if you also want to connect GitHub, Google, or a TON wallet as a separate web identity:",
        [[{ text: 'Sign in on the website', url: 'https://layerrunners.xyz/login' }]],
      );
      return;
    }

    const response = await runChatEngine(env, identity, text, { telegramChatId: chat.id });

    if (response.kind === 'approval') {
      await sendTelegramMessageWithButtons(env, chat.id, response.text, [[
        { text: '✅ Approve', callback_data: `approve:${response.requestId}` },
        { text: '❌ Reject', callback_data: `reject:${response.requestId}` },
      ]]);
      return;
    }

    await sendTelegramMessage(env, chat.id, response.text);
  } catch (error) {
    console.error('Message handling error:', error);
    await sendTelegramMessage(
      env,
      chat.id,
      '❌ I encountered an error processing your request. Please try again.'
    );
  }
}

async function handlePendingSecretInput(
  env: Env,
  chatId: number,
  identity: string,
  messageId: number,
  text: string,
  secretName: string
): Promise<void> {
  if (/^\s*\/cancel\b/.test(text)) {
    await clearPendingSecretInput(env, identity);
    await sendTelegramMessage(env, chatId, 'Cancelled — nothing was saved.');
    return;
  }

  const value = text.trim();
  if (!value) {
    await sendTelegramMessage(env, chatId, "That doesn't look right — send the token as plain text, or `/cancel`.");
    return;
  }

  // Always clear pending state and scrub the message in `finally` --
  // whatever the token attempt was, it must not sit in the chat, and the
  // user must never get stuck re-attempting the same failing save on
  // every future message if setUserSecret throws (e.g. a config issue).
  try {
    await setUserSecret(env, identity, secretName, value);
    await sendTelegramMessage(env, chatId, '✅ Saved, encrypted, and your message with the token has been deleted from this chat.');
  } catch (error) {
    console.error('Failed to save user secret:', error);
    await sendTelegramMessage(env, chatId, "❌ Couldn't save that securely — nothing was stored. Try `/connect_github` again in a bit.");
  } finally {
    await clearPendingSecretInput(env, identity);
    await deleteTelegramMessage(env, chatId, messageId);
  }
}

async function handlePendingWalletLink(env: Env, chatId: number, profile: UserProfile, text: string): Promise<void> {
  if (/^\s*\/cancel\b/.test(text)) {
    await clearAwaitingWalletLink(env, profile.identity);
    await sendTelegramMessage(env, chatId, 'Cancelled — nothing was saved.');
    return;
  }

  const address = text.trim();
  if (!/^(?:[EU]Q[\w-]{46}|0:[0-9a-fA-F]{64})$/.test(address)) {
    await sendTelegramMessage(env, chatId, "That doesn't look like a TON address — paste it as-is, or `/cancel`.");
    return;
  }

  let balance: bigint;
  try {
    balance = await initTonCenterService(env).getLyrBalance(address);
  } catch {
    await sendTelegramMessage(env, chatId, "Couldn't look that address up on-chain — double check it, or `/cancel`.");
    return;
  }

  try {
    await saveUserProfile(env, { ...profile, walletAddress: address, lastDepositLt: undefined });
    await sendTelegramMessage(env, chatId, [
      `✅ Linked \`${address}\`.`,
      `Current balance: ${formatLyr(balance)}`,
      '',
      'Send LYR from this wallet to the vault anytime and I\'ll credit it to your balance automatically once your free credit runs out.',
    ].join('\n'));
  } catch (error) {
    console.error('Failed to save linked wallet:', error);
    await sendTelegramMessage(env, chatId, "❌ Couldn't save that — nothing was linked. Try `/link_wallet` again in a bit.");
  } finally {
    await clearAwaitingWalletLink(env, profile.identity);
  }
}
