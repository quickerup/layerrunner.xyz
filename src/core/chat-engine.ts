/**
 * Channel-agnostic core of "user sends text, bot plans/runs/replies" --
 * originally the middle of telegram/message-handler.ts, extracted so both
 * the Telegram webhook and the web chat (POST /api/chat) drive the exact
 * same intent -> plan -> role/metering gate -> approval-or-execute pipeline
 * instead of duplicating it per channel.
 *
 * Channel-specific UX stays out of here on purpose: Telegram's onboarding
 * wizard (inline-keyboard role picker), the "paste your token/address as
 * your next message" pending-input flows, and the admin-only /deploy and
 * /collect commands all stay in telegram/message-handler.ts. Web-originated
 * users instead get `ensureProfile`'s sensible defaults (see below) rather
 * than a forced wizard.
 */

import { Env } from '../config';
import { approveRequest, createApprovalRequest, formatApprovalMessage, getApprovalRequest, rejectRequest } from './approval';
import { checkAndReserve, commitReservation, formatTopUpPrompt, getBalance, releaseReservation } from './metering';
import { parseIntent } from './intent-parser';
import { ExecutableAction, ExecutionPlan, generatePlan } from './planner';
import { CLASS_INFO, UserProfile, formatProfile, getUserProfile, saveUserProfile } from './profile';
import { FREE_TRIAL_CREDIT_NANO, creditBalance } from './metering';
import { reconcileVaultDeposits } from './wallet-link';
import { createIntentProvider } from '../services/ai-provider';
import { ActionExecutor, ExecutionResult } from '../services/executor';
import { formatLyr, initTonCenterService } from '../services/ton';
import { escapeMarkdown } from './markdown';
import { GITHUB_TOKEN_SECRET, getUserSecret } from './user-secrets';

const md = (value: unknown, fallback = 'unknown'): string =>
  value === undefined || value === null || value === '' ? fallback : escapeMarkdown(String(value));

export type ChatEngineResponse =
  | { kind: 'text'; text: string }
  | { kind: 'approval'; text: string; requestId: string };

export interface ChatEngineOptions {
  /** Set only when the message came in over Telegram -- lets the created
   *  approval request notify that chat when it's later approved/rejected.
   *  Web callers omit this; the frontend just reads POST /api/approve's response. */
  telegramChatId?: number;
}

// New identities (currently: anyone logging into the web chat for the
// first time -- Telegram users still go through the full wizard in
// telegram/onboarding.ts before ever reaching this) get a profile with
// safe defaults instead of a forced setup flow. Role defaults to
// read-only Watcher rather than Deployer: unlike the Telegram wizard,
// nobody explicitly saw and chose a role here, and login only proves
// "has a Telegram account" today (GitHub/Google logins later prove even
// less), not vetted trust for real deploys against the shared GitHub token.
export async function ensureProfile(env: Env, identity: string): Promise<UserProfile> {
  const existing = await getUserProfile(env, identity);
  if (existing) return existing;

  const profile: UserProfile = {
    identity,
    displayName: 'Layer Runners user',
    class: 'watcher',
    createdAt: Date.now(),
  };
  await saveUserProfile(env, profile);
  await creditBalance(env, identity, FREE_TRIAL_CREDIT_NANO);
  return profile;
}

export async function runChatEngine(
  env: Env,
  identity: string,
  text: string,
  options: ChatEngineOptions = {}
): Promise<ChatEngineResponse> {
  const profile = await ensureProfile(env, identity);

  if (/^\s*\/profile\b/.test(text)) {
    const balance = await getBalance(env, identity);
    const lines = [formatProfile(profile, false, balance)];
    if (profile.walletAddress) {
      try {
        const walletBalance = await initTonCenterService(env).getLyrBalance(profile.walletAddress);
        lines.push(`Linked wallet: \`${profile.walletAddress}\` (${formatLyr(walletBalance)} on-chain)`);
      } catch {
        lines.push(`Linked wallet: \`${profile.walletAddress}\``);
      }
    }
    return { kind: 'text', text: lines.join('\n') };
  }

  const intent = await parseIntent(text, createIntentProvider(env));
  const plan = generatePlan(intent);
  const executableSteps = plan.steps.flatMap(step => step.executable ? [step.executable] : []);

  for (const executable of executableSteps) {
    if (!executable.params.repo && profile.defaultRepo) {
      // defaultRepo may be "owner/repo" (as shown in /profile and accepted
      // during onboarding) or just "repo" -- split it so params.repo never
      // ends up holding a slash, which would double up with params.owner
      // (falling back to GITHUB_OWNER) and produce a malformed GitHub API
      // path like /repos/<owner>/<owner>/<repo>.
      const [first, second] = profile.defaultRepo.split('/');
      if (second) {
        if (!executable.params.owner) executable.params.owner = first;
        executable.params.repo = second;
      } else {
        executable.params.repo = first;
      }
    }
  }

  if (plan.steps.some(step => step.action === 'help')) {
    return { kind: 'text', text: formatHelpMessage() };
  }

  if (plan.requiresApproval && profile.class !== 'deployer') {
    return { kind: 'text', text: formatPermissionDenied(profile) };
  }

  let metering = await checkAndReserve(env, identity, plan);

  if (!metering.ok && metering.reason === 'insufficient_balance' && profile.walletAddress) {
    const credited = await reconcileVaultDeposits(env, profile);
    if (credited > BigInt(0)) {
      metering = await checkAndReserve(env, identity, plan);
    }
  }

  if (!metering.ok) {
    return { kind: 'text', text: formatTopUpPrompt(env, identity, metering) };
  }

  if (plan.requiresApproval) {
    const request = await createApprovalRequest(
      env,
      identity,
      options.telegramChatId,
      intent.description,
      summarizePlan(plan),
      plan.steps.map(step => step.description),
      plan.riskLevel,
      executableSteps,
      metering.reservationId,
      metering.costNano.toString()
    );

    return { kind: 'approval', text: formatApprovalMessage(request), requestId: request.id };
  }

  try {
    await commitReservation(env, identity, metering.reservationId);
    const userGithubToken = await getUserSecret(env, identity, GITHUB_TOKEN_SECRET);
    const text = await executeAndFormat(env, plan, executableSteps, userGithubToken);
    return { kind: 'text', text };
  } catch (error) {
    await releaseReservation(env, identity, metering.reservationId);
    throw error;
  }
}

export type ApprovalResolution =
  | { kind: 'not_pending' }
  | { kind: 'forbidden' }
  | { kind: 'reject_failed' }
  | { kind: 'approve_failed' }
  | { kind: 'rejected'; requestId: string; chatId?: number }
  | { kind: 'approved_empty'; requestId: string; chatId?: number }
  | { kind: 'executed'; requestId: string; chatId?: number; text: string };

// Shared by telegram/callback-handler.ts (inline-keyboard Approve/Reject)
// and POST /api/approve (web) -- same permission check, same
// reserve/commit/release/execute sequence, so the two channels can't drift.
// `chatId` on the successful variants is just passed through from the
// approval request for Telegram callers to notify; web callers ignore it.
export async function resolveApproval(
  env: Env,
  requestId: string,
  actingIdentity: string,
  action: 'approve' | 'reject'
): Promise<ApprovalResolution> {
  const request = await getApprovalRequest(env, requestId);
  if (!request || request.status !== 'pending') return { kind: 'not_pending' };

  const isRequester = actingIdentity === request.identity;
  const actingProfile = isRequester ? undefined : await getUserProfile(env, actingIdentity);
  const isReviewer = actingProfile?.class === 'reviewer';
  if (!isRequester && !isReviewer) return { kind: 'forbidden' };

  const requesterIdentity = request.identity;

  if (action === 'reject') {
    if (!await rejectRequest(env, requestId)) return { kind: 'reject_failed' };
    await releaseReservation(env, requesterIdentity, request.meteringReservationId);
    return { kind: 'rejected', requestId, chatId: request.chatId };
  }

  if (!await approveRequest(env, requestId)) return { kind: 'approve_failed' };

  if (request.executableSteps.length === 0) {
    await releaseReservation(env, requesterIdentity, request.meteringReservationId);
    return { kind: 'approved_empty', requestId, chatId: request.chatId };
  }

  await commitReservation(env, requesterIdentity, request.meteringReservationId);

  const userGithubToken = await getUserSecret(env, requesterIdentity, GITHUB_TOKEN_SECRET);
  const executor = new ActionExecutor(env, userGithubToken);
  const lines = [`✅ Approved request \`${request.id}\`.`, '', '*Execution Result*:'];

  const results = await executor.executePlan(request.executableSteps);
  for (const executable of request.executableSteps) {
    lines.push(formatExecutionResult(executable.action, results.get(executable.id)!));
  }

  return { kind: 'executed', requestId, chatId: request.chatId, text: lines.join('\n') };
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

  const results = await executor.executePlan(executableSteps);
  for (const executable of executableSteps) {
    lines.push(formatExecutionResult(executable.action, results.get(executable.id)!));
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

export function formatPermissionDenied(profile: UserProfile): string {
  const info = CLASS_INFO[profile.class];
  return [
    `🔒 Your role (${info.emoji} ${info.label}) is read-only.`,
    'Ask a Deployer to run this, or check `/profile` to confirm your role.',
  ].join('\n');
}

function summarizePlan(plan: ExecutionPlan): string {
  return `${plan.steps.length} step(s), risk ${plan.riskLevel}, estimated ${plan.estimatedDuration}`;
}

// Turns a known GitHub API failure into something the person on the other
// end of the chat can actually act on, instead of a raw status code --
// errorStatus is only set when the failure was a classifiable
// GitHubApiError (see services/github.ts), so anything else (StepRef
// resolution errors, a failed health-check fetch, ...) just falls through
// to the underlying message unchanged.
function translateExecutionError(result: ExecutionResult): string {
  switch (result.errorStatus) {
    case 401:
      return "GitHub rejected the token as invalid or expired. If you connected your own with `/connect_github`, send a fresh one there. If this is the shared account, it needs to be replaced by whoever runs the bot.";
    case 403:
      return /rate limit/i.test(result.error ?? '')
        ? 'Hit a GitHub rate limit — wait a few minutes and try again.'
        : "GitHub rejected this for lack of permission. If you're on the shared token, connect your own with more access via `/connect_github`; otherwise check the token's scopes.";
    case 404:
      return "Repo not found, or the current token can't see it -- GitHub hides private repos a token has no access to rather than saying so directly. Double check the repo name, or connect a token with access via `/connect_github`.";
    default:
      return md(result.error, 'Unknown error');
  }
}

export function formatExecutionResult(action: string, result: ExecutionResult): string {
  if (!result.success) {
    return `❌ ${action} failed: ${translateExecutionError(result)}`;
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

export function formatHelpMessage(): string {
  return [
    '*Layer Runners* — an AI operator for your stack, from Telegram or the web chat.',
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
    lines.push(`CI URL: ${md(latestRun.html_url)}`);
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
