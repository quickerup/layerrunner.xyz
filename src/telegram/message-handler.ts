import { Env } from '../config';
import { createApprovalRequest, formatApprovalMessage } from '../core/approval';
import { parseIntent } from '../core/intent-parser';
import { ExecutableAction, ExecutionPlan, generatePlan } from '../core/planner';
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
    const intent = await parseIntent(text, createIntentProvider(env));
    const plan = generatePlan(intent);
    const executableSteps = plan.steps.flatMap(step => step.executable ? [step.executable] : []);

    if (plan.requiresApproval) {
      const request = createApprovalRequest(
        from.id,
        chat.id,
        intent.description,
        summarizePlan(plan),
        plan.steps.map(step => step.description),
        plan.riskLevel,
        executableSteps
      );

      await sendTelegramMessageWithButtons(env, chat.id, formatApprovalMessage(request), [[
        { text: '✅ Approve', callback_data: `approve:${request.id}` },
        { text: '❌ Reject', callback_data: `reject:${request.id}` },
      ]]);
      return;
    }

    const response = await executeAndFormat(env, plan, executableSteps);
    await sendTelegramMessage(env, chat.id, response);
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

  if (action === 'github_get_deployments' && Array.isArray(result.output)) {
    const deployments = result.output.slice(0, 5).map((deployment: any) => `• ${deployment.environment ?? 'unknown'} — ${deployment.sha ?? deployment.id}`).join('\n');
    return `✅ Deployments (${result.output.length})\n${deployments || 'No deployments found.'}`;
  }

  return `✅ ${action} succeeded in ${result.executionTime}ms`;
}
