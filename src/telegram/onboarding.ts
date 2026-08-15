/**
 * First-run setup wizard
 * New users are walked through: display name -> role -> default repo,
 * before they can use any other command.
 */

import { Env } from '../config';
import { FREE_TRIAL_CREDIT_NANO, creditBalance, getBalance } from '../core/metering';
import {
  CLASS_INFO,
  OnboardingState,
  UserClass,
  UserProfile,
  clearOnboardingState,
  saveOnboardingState,
  saveUserProfile,
} from '../core/profile';
import { sendTelegramMessage, sendTelegramMessageWithButtons } from './api';
import { escapeMarkdown } from '../core/markdown';
import { formatLyr } from '../services/ton';

export function isStartCommand(text: string): boolean {
  return /^\s*\/start\b/.test(text);
}

export async function beginOnboarding(env: Env, chatId: number, userId: number): Promise<void> {
  await saveOnboardingState(env, userId, { step: 'name' });
  await sendTelegramMessage(env, chatId, [
    '*Welcome to Layer Runners.*',
    '',
    "I'm an AI operator for your stack — plain-English requests, planned and run against GitHub (more integrations coming).",
    '',
    `Quick setup first, a few questions so I know how to work with you. Everything here runs on LYR — you'll start with ${formatLyr(FREE_TRIAL_CREDIT_NANO)} free to try it out, then top up anytime at layerrunners.xyz.`,
    '',
    'What should I call you?',
  ].join('\n'));
}

export async function handleOnboardingMessage(
  env: Env,
  chatId: number,
  userId: number,
  text: string,
  state: OnboardingState
): Promise<void> {
  if (state.step === 'name') {
    const displayName = text.trim().slice(0, 40);
    if (!displayName) {
      await sendTelegramMessage(env, chatId, "That name won't work — send a short display name.");
      return;
    }

    await saveOnboardingState(env, userId, { step: 'class', displayName });
    await sendTelegramMessageWithButtons(
      env,
      chatId,
      [
        `Thanks, *${escapeMarkdown(displayName)}*.`,
        '',
        "What's your role?",
        '',
        ...Object.values(CLASS_INFO).map(info => `${info.emoji} *${info.label}* — ${info.blurb}`),
      ].join('\n'),
      [classButtons()]
    );
    return;
  }

  if (state.step === 'class') {
    await sendTelegramMessage(env, chatId, 'Choose a role using the buttons above to continue.');
    return;
  }

  if (state.step === 'repo') {
    const trimmed = text.trim();

    if (/^skip$/i.test(trimmed)) {
      await finishOnboarding(env, chatId, userId, state.displayName!, state.className!, undefined);
      return;
    }

    if (!/^[a-zA-Z0-9._-]+(\/[a-zA-Z0-9._-]+)?$/.test(trimmed)) {
      await sendTelegramMessage(
        env,
        chatId,
        'Send a repo as `owner/repo` or just `repo`, or send "skip" to use the server default.'
      );
      return;
    }

    await finishOnboarding(env, chatId, userId, state.displayName!, state.className!, trimmed);
    return;
  }
}

export async function handleClassSelection(
  env: Env,
  chatId: number,
  userId: number,
  className: UserClass,
  state: OnboardingState
): Promise<void> {
  await saveOnboardingState(env, userId, { step: 'repo', displayName: state.displayName, className });
  await sendTelegramMessage(env, chatId, [
    `${CLASS_INFO[className].emoji} Got it — *${CLASS_INFO[className].label}*.`,
    '',
    "Last question: which repo should I default to for you? (`owner/repo`, or just `repo`)",
    '_Send "skip" to use the server default._',
  ].join('\n'));
}

async function finishOnboarding(
  env: Env,
  chatId: number,
  userId: number,
  displayName: string,
  className: UserClass,
  defaultRepo: string | undefined
): Promise<void> {
  const profile: UserProfile = {
    userId,
    displayName,
    class: className,
    defaultRepo,
    createdAt: Date.now(),
  };

  await saveUserProfile(env, profile);
  await clearOnboardingState(env, userId);
  await creditBalance(env, userId, FREE_TRIAL_CREDIT_NANO);
  const balance = await getBalance(env, userId);
  await sendTelegramMessage(env, chatId, formatProfile(profile, true, balance));
}

export function formatProfile(profile: UserProfile, justSetUp: boolean, balanceNano: bigint): string {
  const info = CLASS_INFO[profile.class];
  const lines = [
    justSetUp ? "*You're set up.*" : '*Your profile*',
    '',
    `Name: *${escapeMarkdown(profile.displayName)}*`,
    `Role: ${info.emoji} *${info.label}* — ${info.blurb}`,
    `Default repo: ${profile.defaultRepo ? `\`${profile.defaultRepo}\`` : '_server default_'}`,
    `Balance: ${formatLyr(balanceNano)}`,
  ];

  if (justSetUp) {
    lines.push('', `You've got ${formatLyr(FREE_TRIAL_CREDIT_NANO)} free to try things out — try \`show production status\` to get started. Buy more anytime at layerrunners.xyz.`);
  }

  return lines.join('\n');
}

function classButtons() {
  return Object.entries(CLASS_INFO).map(([key, info]) => ({
    text: `${info.emoji} ${info.label}`,
    callback_data: `class:${key}`,
  }));
}
