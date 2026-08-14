/**
 * Character creation onboarding wizard
 * New users are walked through: display name -> class -> default repo,
 * before they can use any other command.
 */

import { Env } from '../config';
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

export function isStartCommand(text: string): boolean {
  return /^\s*\/start\b/.test(text);
}

export async function beginOnboarding(env: Env, chatId: number, userId: number): Promise<void> {
  await saveOnboardingState(env, userId, { step: 'name' });
  await sendTelegramMessage(env, chatId, [
    '*Welcome to Layer Runners.*',
    '',
    "Before you start running ops, let's build your character.",
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
        `Nice to meet you, *${escapeMarkdown(displayName)}*.`,
        '',
        'Pick your class:',
        '',
        ...Object.values(CLASS_INFO).map(info => `${info.emoji} *${info.label}* — ${info.blurb}`),
      ].join('\n'),
      [classButtons()]
    );
    return;
  }

  if (state.step === 'class') {
    await sendTelegramMessage(env, chatId, 'Pick a class using the buttons above to continue.');
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
    `${CLASS_INFO[className].emoji} Locked in as *${CLASS_INFO[className].label}*.`,
    '',
    "Last step — what repo should I default to for you? (\`owner/repo\`, or just \`repo\`)",
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
  await sendTelegramMessage(env, chatId, formatCharacterSheet(profile, true));
}

export function formatCharacterSheet(profile: UserProfile, justCreated: boolean): string {
  const info = CLASS_INFO[profile.class];
  const lines = [
    justCreated ? '*Character created.*' : '*Your character*',
    '',
    `Name: *${escapeMarkdown(profile.displayName)}*`,
    `Class: ${info.emoji} *${info.label}* — ${info.blurb}`,
    `Default repo: ${profile.defaultRepo ? `\`${profile.defaultRepo}\`` : '_server default_'}`,
  ];

  if (justCreated) {
    lines.push('', 'Try `show production status` to get started.');
  }

  return lines.join('\n');
}

function classButtons() {
  return Object.entries(CLASS_INFO).map(([key, info]) => ({
    text: `${info.emoji} ${info.label}`,
    callback_data: `class:${key}`,
  }));
}

function escapeMarkdown(text: string): string {
  return text.replace(/([_*[\]()`])/g, '\\$1');
}
