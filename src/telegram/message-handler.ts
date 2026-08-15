import { Env } from '../config';
import { createApprovalRequest, formatApprovalMessage } from '../core/approval';
import { checkAndReserve, commitReservation, formatTopUpPrompt, getBalance, releaseReservation } from '../core/metering';
import { parseIntent } from '../core/intent-parser';
import { ExecutableAction, ExecutionPlan, generatePlan } from '../core/planner';
import {
  CLASS_INFO,
  UserProfile,
  clearAwaitingWalletLink,
  getOnboardingState,
  getUserProfile,
  isAwaitingWalletLink,
  saveUserProfile,
  setAwaitingWalletLink,
} from '../core/profile';
import { reconcileVaultDeposits } from '../core/wallet-link';
import { beginOnboarding, formatProfile, handleOnboardingMessage, isStartCommand } from './onboarding';
import { createIntentProvider } from '../services/ai-provider';
import { ActionExecutor, ExecutionResult } from '../services/executor';
import { formatLyr, initTonCenterService } from '../services/ton';
import { sendTelegramMessage, sendTelegramMessageWithButtons, deleteTelegramMessage } from './api';
import { escapeMarkdown } from '../core/markdown';
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

const md = (value: unknown, fallback = 'unknown'): string =>
  value === undefined || value === null || value === '' ? fallback : escapeMarkdown(String(value));

export async function handleMessage(env: Env, message: TelegramMessage): Promise<void> {
  const { text, chat, from, message_id } = message;

  if (!text) {
    return;
  }

  try {
    const onboarding = await getOnboardingState(env, from.id);
    if (onboarding) {
      await handleOnboardingMessage(env, chat.id, from.id, text, onboarding);
      return;
    }

    const profile = await getUserProfile(env, from.id);

    if (!profile) {
      if (isStartCommand(text)) {
        await beginOnboarding(env, chat.id, from.id);
      } else {
        await sendTelegramMessage(env, chat.id, 'Send /start to get set up first.');
      }
      return;
    }

    const pendingSecret = await getPendingSecretInput(env, from.id);
    if (pendingSecret) {
      await handlePendingSecretInput(env, chat.id, from.id, message_id, text, pendingSecret.name);
      return;
    }

    if (await isAwaitingWalletLink(env, from.id)) {
      await handlePendingWalletLink(env, chat.id, profile, text);
      return;
    }

    if (/^\s*\/profile\b/.test(text)) {
      const balance = await getBalance(env, from.id);
      const lines = [formatProfile(profile, false, balance)];
      if (profile.walletAddress) {
        try {
          const walletBalance = await initTonCenterService(env).getLyrBalance(profile.walletAddress);
          lines.push(`Linked wallet: \`${profile.walletAddress}\` (${formatLyr(walletBalance)} on-chain)`);
        } catch {
          lines.push(`Linked wallet: \`${profile.walletAddress}\``);
        }
      }
      await sendTelegramMessage(env, chat.id, lines.join('\n'));
      return;
    }

    if (/^\s*\/link_wallet\b/.test(text)) {
      await setAwaitingWalletLink(env, from.id);
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
      const alreadyConnected = await hasUserSecret(env, from.id, GITHUB_TOKEN_SECRET);
      await setPendingSecretInput(env, from.id, { name: GITHUB_TOKEN_SECRET });
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
      const wasConnected = await hasUserSecret(env, from.id, GITHUB_TOKEN_SECRET);
      await clearUserSecret(env, from.id, GITHUB_TOKEN_SECRET);
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

    const intent = await parseIntent(text, createIntentProvider(env));
    const plan = generatePlan(intent);
    const executableSteps = plan.steps.flatMap(step => step.executable ? [step.executable] : []);

    for (const executable of executableSteps) {
      if (!executable.params.repo && profile.defaultRepo) {
        executable.params.repo = profile.defaultRepo;
      }
    }

    if (plan.steps.some(step => step.action === 'help')) {
      await sendTelegramMessage(env, chat.id, formatHelpMessage());
      return;
    }

    if (plan.requiresApproval && profile.class !== 'deployer') {
      await sendTelegramMessage(env, chat.id, formatPermissionDenied(profile));
      return;
    }

    let metering = await checkAndReserve(env, from.id, plan);

    if (!metering.ok && metering.reason === 'insufficient_balance' && profile.walletAddress) {
      const credited = await reconcileVaultDeposits(env, profile);
      if (credited > BigInt(0)) {
        metering = await checkAndReserve(env, from.id, plan);
      }
    }

    if (!metering.ok) {
      await sendTelegramMessage(env, chat.id, formatTopUpPrompt(env, from.id, metering));
      return;
    }

    if (plan.requiresApproval) {
      const request = await createApprovalRequest(
        env,
        from.id,
        chat.id,
        intent.description,
        summarizePlan(plan),
        plan.steps.map(step => step.description),
        plan.riskLevel,
        executableSteps,
        metering.reservationId,
        metering.costNano.toString()
      );

      await sendTelegramMessageWithButtons(env, chat.id, formatApprovalMessage(request), [[
        { text: '✅ Approve', callback_data: `approve:${request.id}` },
        { text: '❌ Reject', callback_data: `reject:${request.id}` },
      ]]);
      return;
    }

    try {
      await commitReservation(env, from.id, metering.reservationId);
      const userGithubToken = await getUserSecret(env, from.id, GITHUB_TOKEN_SECRET);
      const response = await executeAndFormat(env, plan, executableSteps, userGithubToken);
      await sendTelegramMessage(env, chat.id, response);
    } catch (error) {
      await releaseReservation(env, from.id, metering.reservationId);
      throw error;
    }
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
  userId: number,
  messageId: number,
  text: string,
  secretName: string
): Promise<void> {
  if (/^\s*\/cancel\b/.test(text)) {
    await clearPendingSecretInput(env, userId);
    await sendTelegramMessage(env, chatId, 'Cancelled — nothing was saved.');
    return;
  }

  const value = text.trim();
  if (!value) {
    await sendTelegramMessage(env, chatId, "That doesn't look right — send the token as plain text, or `/cancel`.");
    return;
  }

  await setUserSecret(env, userId, secretName, value);
  await clearPendingSecretInput(env, userId);
  await deleteTelegramMessage(env, chatId, messageId);
  await sendTelegramMessage(env, chatId, '✅ Saved, encrypted, and your message with the token has been deleted from this chat.');
}

async function handlePendingWalletLink(env: Env, chatId: number, profile: UserProfile, text: string): Promise<void> {
  if (/^\s*\/cancel\b/.test(text)) {
    await clearAwaitingWalletLink(env, profile.userId);
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

  await saveUserProfile(env, { ...profile, walletAddress: address, lastDepositLt: undefined });
  await clearAwaitingWalletLink(env, profile.userId);
  await sendTelegramMessage(env, chatId, [
    `✅ Linked \`${address}\`.`,
    `Current balance: ${formatLyr(balance)}`,
    '',
    'Send LYR from this wallet to the vault anytime and I\'ll credit it to your balance automatically once your free credit runs out.',
  ].join('\n'));
}

async function executeAndFormat(
  env: Env,
  plan: ExecutionPlan,
  executableSteps: ExecutableAction[],
  userGithubToken?: string
): Promise<string> {
  const lines = formatPlanResponse(plan);

  if (executableSteps.length === 0) {
    const clarification = plan.steps.find(step => step.action === 'clarify');
    if (clarification) {
      lines.push(`\n${clarification.description}`);
      return lines.join('\n');
    }

    lines.push('\n_No executable GitHub action was identified yet._');
    return lines.join('\n');
  }

  const executor = new ActionExecutor(env, userGithubToken);
  lines.push('\n*Execution Result*:');

  for (const executable of executableSteps) {
    const result = await executor.executeAction(executable.action, executable.params);
    lines.push(formatExecutionResult(executable.action, result));
  }

  return lines.join('\n');
}

function formatPlanResponse(plan: ExecutionPlan): string[] {
  const lines: string[] = [];
  lines.push(`*Intent*: ${plan.intent.type}`);
  lines.push(`*Description*: ${escapeMarkdown(plan.intent.description)}`);

  if (plan.steps.length > 0) {
    lines.push('\n*Planned Actions*:');
    plan.steps.forEach((step, index) => {
      lines.push(`${index + 1}. ${step.action}: ${escapeMarkdown(step.description)}`);
    });
  }

  return lines;
}

function formatPermissionDenied(profile: UserProfile): string {
  const info = CLASS_INFO[profile.class];
  return [
    `🔒 Your role (${info.emoji} ${info.label}) is read-only.`,
    'Ask a Deployer to run this, or check `/profile` to confirm your role.',
  ].join('\n');
}

function summarizePlan(plan: ExecutionPlan): string {
  return `${plan.steps.length} step(s), risk ${plan.riskLevel}, estimated ${plan.estimatedDuration}`;
}

export function formatExecutionResult(action: string, result: ExecutionResult): string {
  if (!result.success) {
    return `❌ ${action} failed: ${md(result.error, 'Unknown error')}`;
  }

  if (action === 'github_list_repos' && Array.isArray(result.output)) {
    const repos = result.output.slice(0, 10).map((repo: any) => `• ${md(repo.full_name ?? repo.name)}`).join('\n');
    return `✅ Repositories (${result.output.length})\n${repos || 'No repositories found.'}`;
  }

  if (action === 'github_create_repo') {
    const repo = result.output as any;
    return `✅ Created repository ${md(repo.full_name ?? repo.name)}`;
  }

  if (action === 'github_get_repo') {
    const repo = result.output as any;
    const visibility = repo.private ? 'private' : 'public';
    const description = repo.description ? `\n${escapeMarkdown(repo.description)}` : '';
    return `✅ Repository ${md(repo.full_name ?? repo.name)} (${visibility})${description}\nUpdated: ${md(repo.updated_at)}`;
  }

  if (action === 'github_get_workflow_runs' && Array.isArray(result.output)) {
    return formatWorkflowRuns(result.output);
  }

  if (action === 'github_deploy') {
    const deployment = result.output as any;
    return `✅ Deployment workflow dispatched\nWorkflow: ${md(deployment.workflowId)}\nRef: ${md(deployment.ref)}\nEnvironment: ${md(deployment.inputs?.environment)}`;
  }

  if ((action === 'project_status' || action === 'diagnose_deployment') && result.output) {
    return formatProjectStatus(result.output as any, action === 'diagnose_deployment');
  }

  if (action === 'github_get_deployments' && Array.isArray(result.output)) {
    const deployments = result.output.slice(0, 5).map((deployment: any) => `• ${md(deployment.environment)} — ${md(deployment.sha ?? deployment.id)}`).join('\n');
    return `✅ Deployments (${result.output.length})\n${deployments || 'No deployments found.'}`;
  }

  return `✅ ${action} succeeded in ${result.executionTime}ms`;
}


function formatHelpMessage(): string {
  return [
    '*Layer Runners* — an AI operator for your stack, right here in Telegram.',
    '',
    'Just ask, in plain English:',
    '• `show production status` — repo, CI, deployments, and health, in one shot',
    '• `why did my last deployment fail?` — digs into recent failures and explains why',
    '• `deploy latest to staging` — plans it, asks you to approve, then runs it',
    '• `list GitHub repos` — repos you have access to',
    '',
    'Sensitive actions (deploys, creating repos) always ask for your approval first before running.',
    '',
    'By default everything runs against a shared GitHub account. Want it to act on your own instead? `/connect_github` walks you through it — your token is encrypted at rest and your message gets deleted right after (`/disconnect_github` to remove it anytime).',
    '',
    '*About LYR* — every request that actually does something costs a small amount of LYR, priced by how much work it is: a status check is cheap, a diagnosis costs more, a deploy costs the most. Chat and help are always free. Buy LYR anytime at layerrunners.xyz — `/profile` shows your role, default repo, and current balance.',
    '',
    'Once your free credit runs out, `/link_wallet` lets you top up by sending LYR to the vault from your own wallet — I detect the deposit and credit it automatically.',
  ].join('\n');
}

function formatWorkflowRuns(runs: any[]): string {
  const rows = runs.slice(0, 5).map(run => `• ${md(run.name, 'Workflow')} — ${md(run.status)}${run.conclusion ? `/${md(run.conclusion)}` : ''} on ${md(run.head_branch)} (${escapeMarkdown(String(run.head_sha ?? '').slice(0, 7))})`);
  return `✅ Recent workflow runs (${runs.length})\n${rows.join('\n') || 'No workflow runs found.'}`;
}

function formatProjectStatus(output: any, diagnostic: boolean): string {
  const repo = output.repository;
  const latestRun = output.workflowRuns?.[0];
  const latestDeployment = output.deployments?.[0];
  const health = output.health;
  const lines = [diagnostic ? '✅ Deployment diagnosis' : '✅ Project status'];

  if (repo) {
    lines.push(`Repo: ${md(repo.full_name ?? repo.name)} (${md(repo.default_branch, 'default branch unknown')})`);
    lines.push(`Updated: ${md(repo.updated_at)}`);
  }

  if (latestRun) {
    lines.push(`Latest CI: ${md(latestRun.name, 'Workflow')} — ${md(latestRun.status)}${latestRun.conclusion ? `/${md(latestRun.conclusion)}` : ''}`);
    lines.push(`CI URL: ${latestRun.html_url}`);
  } else {
    lines.push('Latest CI: no workflow runs found');
  }

  if (latestDeployment) {
    lines.push(`Latest deployment: ${md(latestDeployment.environment)} — ${md(latestDeployment.sha ?? latestDeployment.id)}`);
  } else {
    lines.push('Latest deployment: no deployments found');
  }

  if (health?.configured) {
    lines.push(`Health: ${health.ok ? 'healthy' : 'unhealthy'} (${md(health.status)}) in ${health.responseTimeMs}ms`);
  } else {
    lines.push('Health: APP_HEALTH_URL is not configured');
  }

  return lines.join('\n');
}
