import { Env } from '../config';
import { createApprovalRequest, formatApprovalMessage } from '../core/approval';
import { checkAndReserve, commitReservation, formatTopUpPrompt, releaseReservation } from '../core/metering';
import { parseIntent } from '../core/intent-parser';
import { ExecutableAction, ExecutionPlan, generatePlan } from '../core/planner';
import { CLASS_INFO, UserProfile, getOnboardingState, getUserProfile } from '../core/profile';
import { beginOnboarding, formatCharacterSheet, handleOnboardingMessage, isStartCommand } from './onboarding';
import { createIntentProvider } from '../services/ai-provider';
import { ActionExecutor, ExecutionResult } from '../services/executor';
import { sendTelegramMessage, sendTelegramMessageWithButtons } from './api';
import { TelegramMessage } from './types';

export async function handleMessage(env: Env, message: TelegramMessage): Promise<void> {
  const { text, chat, from } = message;

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
        await sendTelegramMessage(env, chat.id, 'Send /start to set up your character first.');
      }
      return;
    }

    if (/^\s*\/profile\b/.test(text)) {
      await sendTelegramMessage(env, chat.id, formatCharacterSheet(profile, false));
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

    const metering = await checkAndReserve(env, from.id, plan);

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
      const response = await executeAndFormat(env, plan, executableSteps);
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

async function executeAndFormat(env: Env, plan: ExecutionPlan, executableSteps: ExecutableAction[]): Promise<string> {
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

  const executor = new ActionExecutor(env);
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
  lines.push(`*Description*: ${plan.intent.description}`);

  if (plan.steps.length > 0) {
    lines.push('\n*Planned Actions*:');
    plan.steps.forEach((step, index) => {
      lines.push(`${index + 1}. ${step.action}: ${step.description}`);
    });
  }

  return lines;
}

function formatPermissionDenied(profile: UserProfile): string {
  const info = CLASS_INFO[profile.class];
  return [
    `🔒 Your class (${info.emoji} ${info.label}) is read-only.`,
    'Ask a Deployer to run this, or check `/profile` to confirm your class.',
  ].join('\n');
}

function summarizePlan(plan: ExecutionPlan): string {
  return `${plan.steps.length} step(s), risk ${plan.riskLevel}, estimated ${plan.estimatedDuration}`;
}

export function formatExecutionResult(action: string, result: ExecutionResult): string {
  if (!result.success) {
    return `❌ ${action} failed: ${result.error ?? 'Unknown error'}`;
  }

  if (action === 'github_list_repos' && Array.isArray(result.output)) {
    const repos = result.output.slice(0, 10).map((repo: any) => `• ${repo.full_name ?? repo.name}`).join('\n');
    return `✅ Repositories (${result.output.length})\n${repos || 'No repositories found.'}`;
  }

  if (action === 'github_create_repo') {
    const repo = result.output as any;
    return `✅ Created repository ${repo.full_name ?? repo.name}`;
  }

  if (action === 'github_get_repo') {
    const repo = result.output as any;
    const visibility = repo.private ? 'private' : 'public';
    const description = repo.description ? `\n${repo.description}` : '';
    return `✅ Repository ${repo.full_name ?? repo.name} (${visibility})${description}\nUpdated: ${repo.updated_at ?? 'unknown'}`;
  }

  if (action === 'github_get_workflow_runs' && Array.isArray(result.output)) {
    return formatWorkflowRuns(result.output);
  }

  if (action === 'github_deploy') {
    const deployment = result.output as any;
    return `✅ Deployment workflow dispatched\nWorkflow: ${deployment.workflowId}\nRef: ${deployment.ref}\nEnvironment: ${deployment.inputs?.environment ?? 'unknown'}`;
  }

  if ((action === 'project_status' || action === 'diagnose_deployment') && result.output) {
    return formatProjectStatus(result.output as any, action === 'diagnose_deployment');
  }

  if (action === 'github_get_deployments' && Array.isArray(result.output)) {
    const deployments = result.output.slice(0, 5).map((deployment: any) => `• ${deployment.environment ?? 'unknown'} — ${deployment.sha ?? deployment.id}`).join('\n');
    return `✅ Deployments (${result.output.length})\n${deployments || 'No deployments found.'}`;
  }

  return `✅ ${action} succeeded in ${result.executionTime}ms`;
}


function formatHelpMessage(): string {
  return [
    '*Layer Runners is online.*',
    '',
    'Try:',
    '• `show production status` — checks the configured repo, recent CI/deployments, and health URL',
    '• `why did my last deployment fail?` — summarizes recent failed GitHub Actions/deployments',
    '• `deploy latest to staging` — asks for approval, then dispatches the configured GitHub workflow',
    '• `list GitHub repos` — lists accessible repositories for the configured owner',
    '• `/profile` — see your character sheet (name, class, default repo)',
    '',
    'Required secrets/bindings: `TELEGRAM_BOT_TOKEN`, `GITHUB_TOKEN`, `GITHUB_OWNER`, and `GITHUB_REPO`.',
  ].join('\n');
}

function formatWorkflowRuns(runs: any[]): string {
  const rows = runs.slice(0, 5).map(run => `• ${run.name ?? 'Workflow'} — ${run.status ?? 'unknown'}${run.conclusion ? `/${run.conclusion}` : ''} on ${run.head_branch ?? 'unknown'} (${String(run.head_sha ?? '').slice(0, 7)})`);
  return `✅ Recent workflow runs (${runs.length})\n${rows.join('\n') || 'No workflow runs found.'}`;
}

function formatProjectStatus(output: any, diagnostic: boolean): string {
  const repo = output.repository;
  const latestRun = output.workflowRuns?.[0];
  const latestDeployment = output.deployments?.[0];
  const health = output.health;
  const lines = [diagnostic ? '✅ Deployment diagnosis' : '✅ Project status'];

  if (repo) {
    lines.push(`Repo: ${repo.full_name ?? repo.name} (${repo.default_branch ?? 'default branch unknown'})`);
    lines.push(`Updated: ${repo.updated_at ?? 'unknown'}`);
  }

  if (latestRun) {
    lines.push(`Latest CI: ${latestRun.name ?? 'Workflow'} — ${latestRun.status ?? 'unknown'}${latestRun.conclusion ? `/${latestRun.conclusion}` : ''}`);
    lines.push(`CI URL: ${latestRun.html_url}`);
  } else {
    lines.push('Latest CI: no workflow runs found');
  }

  if (latestDeployment) {
    lines.push(`Latest deployment: ${latestDeployment.environment ?? 'unknown'} — ${latestDeployment.sha ?? latestDeployment.id}`);
  } else {
    lines.push('Latest deployment: no deployments found');
  }

  if (health?.configured) {
    lines.push(`Health: ${health.ok ? 'healthy' : 'unhealthy'} (${health.status}) in ${health.responseTimeMs}ms`);
  } else {
    lines.push('Health: APP_HEALTH_URL is not configured');
  }

  return lines.join('\n');
}
