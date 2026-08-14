/**
 * Plan Generator
 * Converts intents into structured execution plans
 */

import { UserIntent } from './intent-parser';

export interface ExecutableAction {
  action: string;
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

export function generatePlan(intent: UserIntent): ExecutionPlan {
  const steps = planStepsForIntent(intent);
  const requiresApproval = steps.some(s => s.requiresApproval);

  return {
    intent,
    steps,
    requiresApproval,
    estimatedDuration: estimateDuration(steps),
    riskLevel: assessRisk(steps),
  };
}

function planStepsForIntent(intent: UserIntent): ExecutionStep[] {
  switch (intent.type) {
    case 'query':
      return handleQueryIntent(intent);
    case 'action':
      return handleActionIntent(intent);
    case 'diagnostic':
      return handleDiagnosticIntent(intent);
    default:
      return [{
        action: 'clarify',
        description: 'Clarify user request',
        service: 'chat',
        requiresApproval: false,
      }];
  }
}

function handleQueryIntent(intent: UserIntent): ExecutionStep[] {
  const text = intent.description.toLowerCase();

  if (mentionsGitHub(text) && /\b(repos?|repositories)\b/.test(text)) {
    return [{
      action: 'github_list_repos',
      description: 'List GitHub repositories',
      service: 'github',
      requiresApproval: false,
      executable: { action: 'github_list_repos', params: {} },
    }];
  }

  if (mentionsGitHub(text) && /\bdeployments?\b/.test(text)) {
    const repo = extractRepoName(intent.description);
    return [{
      action: 'github_get_deployments',
      description: repo ? `Get recent GitHub deployments for ${repo}` : 'Get recent GitHub deployments',
      service: 'github',
      requiresApproval: false,
      executable: { action: 'github_get_deployments', params: repo ? { repo } : {} },
    }];
  }

  return [{
    action: 'fetch_data',
    description: `Retrieve information: ${intent.description}`,
    service: 'query_engine',
    requiresApproval: false,
  }];
}

function handleActionIntent(intent: UserIntent): ExecutionStep[] {
  const text = intent.description.toLowerCase();

  if (mentionsGitHub(text) && /\b(create|add|make|new)\b/.test(text) && /\b(repo|repository)\b/.test(text)) {
    const name = extractRepoName(intent.description);
    return [{
      action: 'github_create_repo',
      description: name ? `Create GitHub repository ${name}` : 'Create GitHub repository',
      service: 'github',
      requiresApproval: true,
      executable: { action: 'github_create_repo', params: { name, private: false } },
    }];
  }

  return [
    {
      action: 'analyze',
      description: `Analyze action request: ${intent.description}`,
      service: 'planning_engine',
      requiresApproval: false,
    },
    {
      action: 'execute',
      description: 'Execute action',
      service: 'execution_engine',
      requiresApproval: true,
    },
  ];
}

function handleDiagnosticIntent(intent: UserIntent): ExecutionStep[] {
  const text = intent.description.toLowerCase();
  const repo = extractRepoName(intent.description);

  if (mentionsGitHub(text) && /\bdeployments?\b|\bdeploy(ed|ment)?\b/.test(text)) {
    return [{
      action: 'github_get_deployments',
      description: repo ? `Inspect recent GitHub deployments for ${repo}` : 'Inspect recent GitHub deployments',
      service: 'github',
      requiresApproval: false,
      executable: { action: 'github_get_deployments', params: repo ? { repo } : {} },
    }];
  }

  return [
    {
      action: 'collect_logs',
      description: 'Collect relevant logs and metrics',
      service: 'observability',
      requiresApproval: false,
    },
    {
      action: 'analyze',
      description: 'Analyze issues',
      service: 'diagnostic_engine',
      requiresApproval: false,
    },
  ];
}

function mentionsGitHub(text: string): boolean {
  return /\b(github|repo|repos|repository|repositories|deployment|deployments)\b/.test(text);
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
      return match[1].split('/').pop();
    }
  }

  return undefined;
}

function estimateDuration(steps: ExecutionStep[]): string {
  if (steps.length === 0) return '< 1 second';
  if (steps.length <= 2) return '5-10 seconds';
  return '15-30 seconds';
}

function assessRisk(steps: ExecutionStep[]): 'low' | 'medium' | 'high' {
  const hasDelete = steps.some(s => /delete|remove/.test(s.action));
  const hasMutatingOps = steps.some(s => s.requiresApproval || /create|update|execute/.test(s.action));

  if (hasDelete) return 'high';
  if (hasMutatingOps) return 'medium';
  return 'low';
}
