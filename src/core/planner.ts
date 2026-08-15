/**
 * Plan Generator
 * Converts intents into structured execution plans
 */

import { UserIntent } from './intent-parser';
import { AIProvider, PlannerAction } from '../services/ai-provider';

/**
 * A reference to another step's output, resolved by the executor
 * immediately before that step runs (see services/executor.ts ::
 * resolveStepRefs) -- the n8n-style "connect this node's input to that
 * node's output" primitive. `path` is a dot-path into the referenced
 * step's `ExecutionResult.output`.
 */
export interface StepRef {
  $stepRef: string;
  path: string;
}

export interface ExecutableAction {
  /** Unique within one plan -- the "node name" other steps link to via StepRef. */
  id: string;
  action: string;
  /** Values may be a StepRef (or contain one, nested in an object/array) instead of a literal. */
  params: Record<string, any>;
}

export interface ExecutionStep {
  action: string;
  description: string;
  service: string;
  requiresApproval: boolean;
  executable?: ExecutableAction;
}

export interface ExecutionPlan {
  intent: UserIntent;
  steps: ExecutionStep[];
  requiresApproval: boolean;
  estimatedDuration: string;
  riskLevel: 'low' | 'medium' | 'high';
}

// Below this, an AI plan extraction is discarded in favor of the regex
// fallback rather than acted on -- low enough to accept confident, clearly
// worded requests, high enough that a shaky guess doesn't misfire an
// approval-requiring action like a deploy.
const AI_CONFIDENCE_THRESHOLD = 0.55;

export async function generatePlan(intent: UserIntent, aiProvider?: AIProvider): Promise<ExecutionPlan> {
  const steps = await planSteps(intent, aiProvider);
  const requiresApproval = steps.some(s => s.requiresApproval);

  return {
    intent,
    steps,
    requiresApproval,
    estimatedDuration: estimateDuration(steps),
    riskLevel: assessRisk(steps),
  };
}

async function planSteps(intent: UserIntent, aiProvider?: AIProvider): Promise<ExecutionStep[]> {
  const text = intent.description.toLowerCase();

  // Trivial and free -- skip the AI round-trip entirely for /help.
  if (isHelpRequest(text)) {
    return helpStep();
  }

  if (aiProvider) {
    try {
      const extraction = await aiProvider.extractPlan(intent.description);
      if (extraction.confidence >= AI_CONFIDENCE_THRESHOLD && extraction.action !== 'clarify') {
        if (extraction.action === 'help') {
          return helpStep();
        }
        return buildStepsForAction(extraction.action, extraction.params);
      }
    } catch (error) {
      console.warn('AI plan extraction failed; using rule-based fallback.', error);
    }
  }

  return planStepsForIntent(intent);
}

function helpStep(): ExecutionStep[] {
  return [{ action: 'help', description: 'Show supported Telegram bot commands', service: 'chat', requiresApproval: false }];
}

interface StepParams {
  repo?: string;
  owner?: string;
  environment?: string;
  ref?: string;
  name?: string;
  private?: boolean;
}

// Shared between the AI-extracted plan and the regex fallback below, so the
// two paths can never drift on what a given action actually looks like as
// an ExecutionStep -- only how {action, params} gets derived differs.
function buildStepsForAction(action: PlannerAction, params: StepParams): ExecutionStep[] {
  switch (action) {
    case 'project_status':
      return [{
        action: 'project_status',
        description: 'Check repository, CI, deployment, and application health',
        service: 'github',
        requiresApproval: false,
        executable: { id: 'project_status', action: 'project_status', params: { repo: params.repo, owner: params.owner } },
      }];

    case 'github_deploy': {
      const environment = params.environment ?? 'staging';
      const deployDescription = `Trigger the GitHub deployment workflow for ${environment}`;

      if (params.ref) {
        return [{
          action: 'github_deploy',
          description: deployDescription,
          service: 'github',
          requiresApproval: true,
          executable: { id: 'github_deploy', action: 'github_deploy', params: { repo: params.repo, owner: params.owner, environment, ref: params.ref } },
        }];
      }

      // No explicit ref -- chain a repo lookup ahead of the deploy step and
      // link its result in, rather than guessing 'main' (the repo's actual
      // default branch may not be 'main'). `ref` here is a StepRef, resolved
      // by the executor from the lookup step's output right before deploy.
      return [
        {
          action: 'github_get_repo',
          description: `Look up the default branch${params.repo ? ` for ${params.repo}` : ''}`,
          service: 'github',
          requiresApproval: false,
          executable: { id: 'github_get_repo', action: 'github_get_repo', params: { repo: params.repo, owner: params.owner } },
        },
        {
          action: 'github_deploy',
          description: deployDescription,
          service: 'github',
          requiresApproval: true,
          executable: {
            id: 'github_deploy',
            action: 'github_deploy',
            params: { repo: params.repo, owner: params.owner, environment, ref: { $stepRef: 'github_get_repo', path: 'default_branch' } },
          },
        },
      ];
    }

    case 'github_get_workflow_runs':
      return [{
        action: 'github_get_workflow_runs',
        description: 'Get recent GitHub Actions workflow runs',
        service: 'github',
        requiresApproval: false,
        executable: { id: 'github_get_workflow_runs', action: 'github_get_workflow_runs', params: { repo: params.repo, owner: params.owner } },
      }];

    case 'github_get_repo': {
      if (!params.repo) return [repoClarificationStep()];
      return [{
        action: 'github_get_repo',
        description: `Get GitHub repository details for ${params.repo}`,
        service: 'github',
        requiresApproval: false,
        executable: { id: 'github_get_repo', action: 'github_get_repo', params: { repo: params.repo, owner: params.owner } },
      }];
    }

    case 'github_list_repos':
      return [{
        action: 'github_list_repos',
        description: 'List GitHub repositories',
        service: 'github',
        requiresApproval: false,
        executable: { id: 'github_list_repos', action: 'github_list_repos', params: { owner: params.owner } },
      }];

    case 'github_get_deployments': {
      if (!params.repo) return [repoClarificationStep()];
      return [{
        action: 'github_get_deployments',
        description: `Get recent GitHub deployments for ${params.repo}`,
        service: 'github',
        requiresApproval: false,
        executable: { id: 'github_get_deployments', action: 'github_get_deployments', params: { repo: params.repo, owner: params.owner } },
      }];
    }

    case 'diagnose_deployment':
      return [{
        action: 'diagnose_deployment',
        description: 'Inspect recent workflow runs and deployments for failures',
        service: 'github',
        requiresApproval: false,
        executable: { id: 'diagnose_deployment', action: 'diagnose_deployment', params: { repo: params.repo, owner: params.owner } },
      }];

    case 'github_create_repo': {
      if (!params.name) {
        return [{ action: 'clarify', description: 'Please provide a repository name to create.', service: 'chat', requiresApproval: false }];
      }
      return [{
        action: 'github_create_repo',
        description: `Create GitHub repository ${params.name}`,
        service: 'github',
        requiresApproval: true,
        executable: { id: 'github_create_repo', action: 'github_create_repo', params: { name: params.name, owner: params.owner, private: params.private ?? false } },
      }];
    }

    default:
      return [{ action: 'clarify', description: 'Clarify user request', service: 'chat', requiresApproval: false }];
  }
}

// Regex-driven fallback -- used when there's no AI provider, the AI call
// fails, or its confidence is too low. Behavior here is unchanged from
// before the AI extraction path was added.
function planStepsForIntent(intent: UserIntent): ExecutionStep[] {
  const text = intent.description.toLowerCase();

  if (isHelpRequest(text)) {
    return helpStep();
  }

  if (isStatusRequest(text)) {
    return buildStepsForAction('project_status', { repo: extractRepoName(intent.description) });
  }

  if (isDeployRequest(text)) {
    return buildStepsForAction('github_deploy', {
      repo: extractRepoName(intent.description),
      environment: extractEnvironment(text),
      ref: extractRef(intent.description),
    });
  }

  switch (intent.type) {
    case 'query':
      return handleQueryIntent(intent);
    case 'action':
      return handleActionIntent(intent);
    case 'diagnostic':
      return handleDiagnosticIntent(intent);
    default:
      return [{ action: 'clarify', description: 'Clarify user request', service: 'chat', requiresApproval: false }];
  }
}

function handleQueryIntent(intent: UserIntent): ExecutionStep[] {
  const text = intent.description.toLowerCase();

  if (mentionsGitHub(text) && /\b(workflows?|actions?|ci|builds?|checks?)\b/.test(text)) {
    return buildStepsForAction('github_get_workflow_runs', { repo: extractRepoName(intent.description) });
  }

  if (mentionsGitHub(text) && isRepoDetailQuery(text)) {
    return buildStepsForAction('github_get_repo', { repo: extractRepoName(intent.description) });
  }

  if (mentionsGitHub(text) && /\b(repos?|repositories)\b/.test(text)) {
    return buildStepsForAction('github_list_repos', {});
  }

  if (mentionsGitHub(text) && /\bdeployments?\b/.test(text)) {
    return buildStepsForAction('github_get_deployments', { repo: extractRepoName(intent.description) });
  }

  return [{ action: 'fetch_data', description: `Retrieve information: ${intent.description}`, service: 'query_engine', requiresApproval: false }];
}

function handleActionIntent(intent: UserIntent): ExecutionStep[] {
  const text = intent.description.toLowerCase();

  if (mentionsGitHub(text) && /\b(create|add|make|new)\b/.test(text) && /\b(repo|repository)\b/.test(text)) {
    return buildStepsForAction('github_create_repo', { name: extractRepoName(intent.description), private: text.includes('private') });
  }

  return [{ action: 'clarify', description: 'I can currently execute GitHub repo queries, CI/deployment status, and approved deploy workflow runs. Try “deploy latest to staging” or “show production status”.', service: 'chat', requiresApproval: false }];
}

function handleDiagnosticIntent(intent: UserIntent): ExecutionStep[] {
  const text = intent.description.toLowerCase();

  if (/\b(failed|failure|error|issue|problem|debug|investigate|why)\b/.test(text)) {
    return buildStepsForAction('diagnose_deployment', { repo: extractRepoName(intent.description) });
  }

  return handleQueryIntent(intent);
}

function isHelpRequest(text: string): boolean {
  return /^\s*\/(start|help)\b/.test(text) || /\b(help|what can you do|commands)\b/.test(text);
}

function isStatusRequest(text: string): boolean {
  return /\b(status|health|production|staging|prod)\b/.test(text) && !/\b(repo|repository)\b/.test(text);
}

function isDeployRequest(text: string): boolean {
  return /\b(deploy|release|ship)\b/.test(text);
}

function extractEnvironment(text: string): string {
  if (/\bprod(uction)?\b/.test(text)) return 'production';
  if (/\bstag(e|ing)?\b/.test(text)) return 'staging';
  if (/\bdev(elopment)?\b/.test(text)) return 'development';
  return 'staging';
}

function extractRef(input: string): string | undefined {
  const match = input.match(/(?:ref|branch|tag|sha)\s+([a-zA-Z0-9._\/-]+)/i);
  return match?.[1];
}

function mentionsGitHub(text: string): boolean {
  return /\b(github|repo|repos|repository|repositories|deployment|deployments|workflow|actions|ci)\b/.test(text);
}

function isRepoDetailQuery(text: string): boolean {
  return /\b(status|details?|info|information|show|get|what'?s|what is)\b/.test(text)
    && /\b(repo|repository)\b/.test(text)
    && !/\b(repos|repositories)\b/.test(text);
}

function extractRepoName(input: string): string | undefined {
  const patterns = [
    /(?:called|named)\s+([a-zA-Z0-9._-]+)/i,
    /(?:repo|repository)\s+([a-zA-Z0-9._-]+)/i,
    /(?:for|in)\s+([a-zA-Z0-9._-]+\/[a-zA-Z0-9._-]+|[a-zA-Z0-9._-]+)/i,
  ];

  for (const pattern of patterns) {
    const match = input.match(pattern);
    if (match?.[1]) {
      const candidate = match[1].split('/').pop();
      if (candidate && isPlausibleRepoName(candidate)) return candidate;
    }
  }

  return undefined;
}

const REPO_NAME_DENYLIST = new Set(['a', 'an', 'and', 'app', 'application', 'for', 'in', 'latest', 'main', 'me', 'my', 'of', 'page', 'prod', 'production', 'repo', 'repository', 'site', 'staging', 'status', 'the', 'this', 'that']);

function isPlausibleRepoName(candidate: string): boolean {
  const normalized = candidate.toLowerCase();
  return /^[a-zA-Z0-9._-]{2,100}$/.test(candidate) && !REPO_NAME_DENYLIST.has(normalized);
}

function repoClarificationStep(): ExecutionStep {
  return { action: 'clarify', description: "Couldn't identify a repository name. Please specify the exact GitHub repo name.", service: 'chat', requiresApproval: false };
}

function estimateDuration(steps: ExecutionStep[]): string {
  if (steps.length === 0) return '< 1 second';
  if (steps.some(step => step.action === 'github_deploy')) return '10-30 seconds to start, then CI continues in GitHub';
  if (steps.length <= 2) return '5-10 seconds';
  return '15-30 seconds';
}

function assessRisk(steps: ExecutionStep[]): 'low' | 'medium' | 'high' {
  const hasDelete = steps.some(s => /delete|remove/.test(s.action));
  const hasDeploy = steps.some(s => /deploy/.test(s.action));
  const hasMutatingOps = steps.some(s => s.requiresApproval || /create|update|execute/.test(s.action));

  if (hasDelete) return 'high';
  if (hasDeploy || hasMutatingOps) return 'medium';
  return 'low';
}
