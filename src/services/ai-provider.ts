import { Env } from '../config';

export type PlannerAction =
  | 'github_create_repo'
  | 'github_list_repos'
  | 'github_get_repo'
  | 'github_get_deployments'
  | 'github_get_workflow_runs'
  | 'github_deploy'
  | 'diagnose_deployment'
  | 'project_status';

const PLANNER_ACTIONS: PlannerAction[] = [
  'github_create_repo',
  'github_list_repos',
  'github_get_repo',
  'github_get_deployments',
  'github_get_workflow_runs',
  'github_deploy',
  'diagnose_deployment',
  'project_status',
];

export interface AIPlanExtraction {
  action: PlannerAction | 'help' | 'clarify';
  params: {
    repo?: string;
    owner?: string;
    environment?: string;
    ref?: string;
    name?: string;
    private?: boolean;
  };
  confidence: number;
  clarifyMessage?: string;
}

export interface AIProvider {
  extractPlan(input: string): Promise<AIPlanExtraction>;
}

const ACTION_GUIDE = [
  'github_list_repos - list the user\'s GitHub repositories. params: {}',
  'github_get_repo - details/status/info about ONE specific repository. params: {repo, owner?}',
  'github_get_deployments - recent deployments for a repository. params: {repo (required), owner?}',
  'github_get_workflow_runs - recent GitHub Actions / CI workflow runs for a repository. params: {repo?, owner?}',
  'github_deploy - trigger a deployment. params: {repo?, owner?, environment? (production|staging|development), ref? (branch/tag/sha)}',
  'diagnose_deployment - investigate why a deployment/build/workflow FAILED or had an error. params: {repo?, owner?}',
  'project_status - general health/status check (not specifically about a failure). params: {repo?, owner?}',
  'github_create_repo - create a new GitHub repository. params: {name (required), owner?, private? (boolean)}',
  'help - the user is asking what the bot can do / how to use it, not asking for an action. params: {}',
  'clarify - the request is ambiguous, missing required info (e.g. no repo name when one is required), or not something any of the above actions can do. params: {}, and set clarifyMessage to a short question or explanation for the user.',
].join('\n');

class CloudflareAIProvider implements AIProvider {
  // Listed in the Cloudflare Workers AI model catalog as a current text-generation model.
  private readonly model = '@cf/meta/llama-3.3-70b-instruct-fp8-fast';

  constructor(private readonly env: Env) {}

  async extractPlan(input: string): Promise<AIPlanExtraction> {
    if (!this.env.AI) {
      throw new Error('Workers AI binding is not configured');
    }

    const prompt = [
      'You are the planner for Layer Runners, a bot that operates a GitHub-backed project on behalf of the user.',
      'Read the request and decide which single action it maps to, and extract any parameters that action needs.',
      'Available actions:',
      ACTION_GUIDE,
      'Return strict JSON only, with keys: action, params, confidence, clarifyMessage.',
      'action must be exactly one of: ' + [...PLANNER_ACTIONS, 'help', 'clarify'].join(', ') + '.',
      'params is an object containing only the fields relevant to the chosen action (omit fields you cannot determine from the request).',
      'confidence is a number from 0 to 1 reflecting how sure you are action+params are correct.',
      'clarifyMessage is required (a short string) only when action is "clarify"; omit it otherwise.',
      `Request: ${JSON.stringify(input)}`,
    ].join('\n');

    const result = await this.env.AI.run(this.model, {
      messages: [
        { role: 'system', content: 'You are a strict JSON planning assistant. You only ever respond with JSON, never prose.' },
        { role: 'user', content: prompt },
      ],
      max_tokens: 400,
    });

    return parseExtraction(result);
  }
}

export function createPlanProvider(env: Env): AIProvider {
  if (!env.AI) {
    return {
      async extractPlan(): Promise<AIPlanExtraction> {
        throw new Error('Workers AI binding is not configured');
      },
    };
  }

  return new CloudflareAIProvider(env);
}

function parseExtraction(result: unknown): AIPlanExtraction {
  const text = extractText(result);
  const jsonText = text.match(/\{[\s\S]*\}/)?.[0] ?? text;
  const parsed = JSON.parse(jsonText) as Partial<AIPlanExtraction>;

  const validActions: string[] = [...PLANNER_ACTIONS, 'help', 'clarify'];
  if (!validActions.includes(parsed.action ?? '')) {
    throw new Error('AI returned an unknown action');
  }

  const confidence = Number(parsed.confidence);
  if (!Number.isFinite(confidence)) {
    throw new Error('AI returned invalid confidence');
  }

  const params = parsed.params && typeof parsed.params === 'object' ? parsed.params : {};

  return {
    action: parsed.action as AIPlanExtraction['action'],
    params,
    confidence: Math.max(0, Math.min(1, confidence)),
    clarifyMessage: typeof parsed.clarifyMessage === 'string' ? parsed.clarifyMessage : undefined,
  };
}

function extractText(result: unknown): string {
  if (typeof result === 'string') return result;
  if (result && typeof result === 'object') {
    const obj = result as Record<string, any>;
    if (typeof obj.response === 'string') return obj.response;
    if (typeof obj.result === 'string') return obj.result;
    if (Array.isArray(obj.choices) && typeof obj.choices[0]?.message?.content === 'string') {
      return obj.choices[0].message.content;
    }
  }
  throw new Error('AI returned no parseable text');
}
