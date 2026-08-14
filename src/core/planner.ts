/**
 * Plan Generator
 * Converts intents into structured execution plans
 */

import { UserIntent } from './intent-parser';

export interface ExecutionStep {
  action: string;
  description: string;
  service: string;
  requiresApproval: boolean;
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
  // This is a simple router - can be enhanced with ML/LLM
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
  // Queries typically don't require approval
  return [{
    action: 'fetch_data',
    description: `Retrieve information: ${intent.description}`,
    service: 'query_engine',
    requiresApproval: false,
  }];
}

function handleActionIntent(intent: UserIntent): ExecutionStep[] {
  // Actions might require approval depending on risk
  return [
    {
      action: 'analyze',
      description: `Analyze action request: ${intent.description}`,
      service: 'planning_engine',
      requiresApproval: false,
    },
    {
      action: 'execute',
      description: `Execute action`,
      service: 'execution_engine',
      requiresApproval: true, // Actions require approval
    },
  ];
}

function handleDiagnosticIntent(intent: UserIntent): ExecutionStep[] {
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

function estimateDuration(steps: ExecutionStep[]): string {
  // Simple estimation - can be enhanced
  if (steps.length === 0) return '< 1 second';
  if (steps.length <= 2) return '5-10 seconds';
  return '15-30 seconds';
}

function assessRisk(steps: ExecutionStep[]): 'low' | 'medium' | 'high' {
  const hasMutatingOps = steps.some(s => 
    ['execute', 'delete', 'update'].includes(s.action)
  );
  
  if (hasMutatingOps) {
    return steps.some(s => s.action === 'delete') ? 'high' : 'medium';
  }
  
  return 'low';
}
