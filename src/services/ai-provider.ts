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

const VALID_ACTIONS: string[] = [...PLANNER_ACTIONS, 'help', 'clarify'];

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
  // Rewrites an already-correct, already-templated response (a fact sheet
  // of exact repo names/counts/statuses/URLs from formatExecutionResult) in
  // a warmer, more natural chat tone. This never generates new claims --
  // only restyles ones the caller already verified -- so a bad or missing
  // provider just means the caller keeps the raw templated text.
  rewriteConversationally(rawText: string): Promise<string>;
  // Contract Studio's "Fix with AI": given Tolk source and the real
  // compiler's error message, returns corrected source. The caller (never
  // this method) is the one that decides whether the fix actually worked,
  // by recompiling it -- this only ever proposes a source string.
  fixTolkSource(source: string, errorMessage: string): Promise<string>;
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

// Shared between every backend -- keeps the two providers' behavior from
// drifting on what each action means or expects as params.
function buildExtractionPrompt(input: string): string {
  return [
    'You are the planner for Layer Runners, a bot that operates a GitHub-backed project on behalf of the user.',
    'Read the request and decide which single action it maps to, and extract any parameters that action needs.',
    'Available actions:',
    ACTION_GUIDE,
    'Return strict JSON only, with keys: action, params, confidence, clarifyMessage.',
    'action must be exactly one of: ' + VALID_ACTIONS.join(', ') + '.',
    'params is an object containing only the fields relevant to the chosen action (omit fields you cannot determine from the request).',
    'confidence is a number from 0 to 1 reflecting how sure you are action+params are correct.',
    'clarifyMessage is required (a short string) only when action is "clarify"; omit it otherwise.',
    `Request: ${JSON.stringify(input)}`,
  ].join('\n');
}

// Shared between every backend's rewriteConversationally. Deliberately
// constrains the model to restyling, not authoring -- it must not add,
// drop, or guess at any fact that isn't already in rawText.
function buildRewritePrompt(rawText: string): string {
  return [
    'You are Layer Runners, a bot chatting with someone about their GitHub-backed project.',
    'Rewrite the following bot response as warm, natural chat prose -- like a helpful teammate reporting back, not a report generator.',
    'Rules:',
    '- Preserve every fact exactly: repo names, counts, statuses, branch/ref names, URLs, error messages, and numbers must all still be present and unchanged.',
    '- Do not add any fact, claim, or speculation that is not already in the original text.',
    '- You may reorganize into flowing sentences instead of a bullet list, and drop markdown formatting characters (*, _, #) since they will not render.',
    '- Keep it concise -- a few sentences, not a wall of text.',
    '- Do not add a greeting or sign-off.',
    '',
    'Original response:',
    rawText,
  ].join('\n');
}

// Shared between every backend's fixTolkSource. Deliberately constrains the
// model to the minimal fix for the reported error, not a rewrite -- the
// caller recompiles the result for real before trusting it, but a smaller
// diff is easier for a human to review and less likely to introduce new
// behavior the user didn't ask for.
function buildFixPrompt(source: string, errorMessage: string): string {
  return [
    'You are fixing a Tolk smart contract (Tolk is TON\'s smart contract language, a modern FunC successor).',
    'The following source failed to compile. Make the MINIMAL change needed to fix the specific reported error --',
    'do not refactor, rename, reformat, or change unrelated logic. Preserve the contract\'s existing intent.',
    'Respond with ONLY the corrected, complete Tolk source code. No markdown code fences, no explanation, no commentary.',
    '',
    'Compiler error:',
    errorMessage,
    '',
    'Source:',
    source,
  ].join('\n');
}

// Strips a leading/trailing ```tolk or ``` fence if the model added one
// despite being told not to -- cheap insurance, not load-bearing.
function stripCodeFence(text: string): string {
  const trimmed = text.trim();
  const fenced = trimmed.match(/^```[a-zA-Z]*\n([\s\S]*?)\n```$/);
  return fenced ? fenced[1] : trimmed;
}

// Validates/normalizes a provider's already-parsed JSON response into the
// shape planner.ts expects. Shared so no backend can silently hand back
// something the planner wasn't built to trust.
function validateExtraction(parsed: unknown): AIPlanExtraction {
  const obj = (parsed && typeof parsed === 'object' ? parsed : {}) as Partial<AIPlanExtraction>;

  if (!VALID_ACTIONS.includes(obj.action ?? '')) {
    throw new Error('AI returned an unknown action');
  }

  const confidence = Number(obj.confidence);
  if (!Number.isFinite(confidence)) {
    throw new Error('AI returned invalid confidence');
  }

  const params = obj.params && typeof obj.params === 'object' ? obj.params : {};

  return {
    action: obj.action as AIPlanExtraction['action'],
    params,
    confidence: Math.max(0, Math.min(1, confidence)),
    clarifyMessage: typeof obj.clarifyMessage === 'string' ? obj.clarifyMessage : undefined,
  };
}

// Primary planner backend. Google's Generative Language API, called via
// plain fetch (no SDK -- keeps the Worker bundle small). Uses response_schema
// so the model is constrained to valid JSON server-side, rather than relying
// on prompt discipline + a best-effort regex extraction like the Workers AI
// path below.
class GeminiProvider implements AIProvider {
  // Pinned to a specific stable release per Google's own guidance -- "-latest"
  // aliases hot-swap the underlying model with only two weeks' notice, which
  // is exactly the kind of surprise a live production planner shouldn't eat.
  // Flash-Lite is Google's fastest/cheapest tier, a good match for a
  // single-shot structured-extraction call like this one.
  private readonly model = 'gemini-3.5-flash-lite';

  constructor(private readonly apiKey: string) {}

  async extractPlan(input: string): Promise<AIPlanExtraction> {
    const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${this.model}:generateContent?key=${this.apiKey}`;

    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [{ text: buildExtractionPrompt(input) }] }],
        generationConfig: {
          responseMimeType: 'application/json',
          responseSchema: {
            type: 'OBJECT',
            properties: {
              action: { type: 'STRING', enum: VALID_ACTIONS },
              params: {
                type: 'OBJECT',
                properties: {
                  repo: { type: 'STRING' },
                  owner: { type: 'STRING' },
                  environment: { type: 'STRING' },
                  ref: { type: 'STRING' },
                  name: { type: 'STRING' },
                  private: { type: 'BOOLEAN' },
                },
              },
              confidence: { type: 'NUMBER' },
              clarifyMessage: { type: 'STRING' },
            },
            required: ['action', 'params', 'confidence'],
          },
        },
      }),
    });

    if (!response.ok) {
      throw new Error(`Gemini API error ${response.status}: ${await response.text()}`);
    }

    const data = (await response.json()) as any;
    const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
    if (typeof text !== 'string') {
      throw new Error('Gemini returned no parseable text');
    }

    return validateExtraction(JSON.parse(text));
  }

  async rewriteConversationally(rawText: string): Promise<string> {
    const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${this.model}:generateContent?key=${this.apiKey}`;

    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [{ text: buildRewritePrompt(rawText) }] }],
        // Low temperature -- this is a faithful restyle, not creative writing.
        generationConfig: { temperature: 0.3 },
      }),
    });

    if (!response.ok) {
      throw new Error(`Gemini API error ${response.status}: ${await response.text()}`);
    }

    const data = (await response.json()) as any;
    const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
    if (typeof text !== 'string' || !text.trim()) {
      throw new Error('Gemini returned no parseable text');
    }

    return text.trim();
  }

  async fixTolkSource(source: string, errorMessage: string): Promise<string> {
    const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${this.model}:generateContent?key=${this.apiKey}`;

    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [{ text: buildFixPrompt(source, errorMessage) }] }],
        generationConfig: { temperature: 0.2 },
      }),
    });

    if (!response.ok) {
      throw new Error(`Gemini API error ${response.status}: ${await response.text()}`);
    }

    const data = (await response.json()) as any;
    const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
    if (typeof text !== 'string' || !text.trim()) {
      throw new Error('Gemini returned no parseable text');
    }

    return stripCodeFence(text);
  }
}

// Backup planner backend -- Cloudflare Workers AI, already bound as env.AI
// for other Worker use, so it costs nothing extra to keep as the fallback
// when Gemini is unset, erroring, or rate-limited.
class CloudflareAIProvider implements AIProvider {
  // Listed in the Cloudflare Workers AI model catalog as a current text-generation model.
  private readonly model = '@cf/meta/llama-3.3-70b-instruct-fp8-fast';

  constructor(private readonly env: Env) {}

  async extractPlan(input: string): Promise<AIPlanExtraction> {
    if (!this.env.AI) {
      throw new Error('Workers AI binding is not configured');
    }

    const result = await this.env.AI.run(this.model, {
      messages: [
        { role: 'system', content: 'You are a strict JSON planning assistant. You only ever respond with JSON, never prose.' },
        { role: 'user', content: buildExtractionPrompt(input) },
      ],
      max_tokens: 400,
    });

    const text = extractText(result);
    const jsonText = text.match(/\{[\s\S]*\}/)?.[0] ?? text;
    return validateExtraction(JSON.parse(jsonText));
  }

  async rewriteConversationally(rawText: string): Promise<string> {
    if (!this.env.AI) {
      throw new Error('Workers AI binding is not configured');
    }

    const result = await this.env.AI.run(this.model, {
      messages: [
        { role: 'system', content: 'You restyle chat responses to sound natural, without changing any facts.' },
        { role: 'user', content: buildRewritePrompt(rawText) },
      ],
      max_tokens: 500,
      temperature: 0.3,
    });

    const text = extractText(result).trim();
    if (!text) {
      throw new Error('Workers AI returned no parseable text');
    }
    return text;
  }

  async fixTolkSource(source: string, errorMessage: string): Promise<string> {
    if (!this.env.AI) {
      throw new Error('Workers AI binding is not configured');
    }

    const result = await this.env.AI.run(this.model, {
      messages: [
        { role: 'system', content: 'You fix smart contract compile errors with the smallest possible change. You respond with only source code, never commentary.' },
        { role: 'user', content: buildFixPrompt(source, errorMessage) },
      ],
      max_tokens: 2000,
      temperature: 0.2,
    });

    const text = extractText(result).trim();
    if (!text) {
      throw new Error('Workers AI returned no parseable text');
    }
    return stripCodeFence(text);
  }
}

// Tries the primary backend; on any failure (unset, network error, bad
// JSON, rate limit) falls back to the backup instead of throwing straight
// through -- planner.ts's own try/catch is the last resort after this,
// falling back further to the regex pipeline.
class CompositeAIProvider implements AIProvider {
  constructor(private readonly primary: AIProvider, private readonly backup?: AIProvider) {}

  async extractPlan(input: string): Promise<AIPlanExtraction> {
    try {
      return await this.primary.extractPlan(input);
    } catch (error) {
      if (!this.backup) throw error;
      console.warn('Primary AI provider failed; falling back to backup provider.', error);
      return this.backup.extractPlan(input);
    }
  }

  async rewriteConversationally(rawText: string): Promise<string> {
    try {
      return await this.primary.rewriteConversationally(rawText);
    } catch (error) {
      if (!this.backup) throw error;
      console.warn('Primary AI provider failed; falling back to backup provider.', error);
      return this.backup.rewriteConversationally(rawText);
    }
  }

  async fixTolkSource(source: string, errorMessage: string): Promise<string> {
    try {
      return await this.primary.fixTolkSource(source, errorMessage);
    } catch (error) {
      if (!this.backup) throw error;
      console.warn('Primary AI provider failed; falling back to backup provider.', error);
      return this.backup.fixTolkSource(source, errorMessage);
    }
  }
}

export function createPlanProvider(env: Env): AIProvider {
  const workersAI = env.AI ? new CloudflareAIProvider(env) : undefined;

  if (env.GEMINI_API_KEY) {
    return new CompositeAIProvider(new GeminiProvider(env.GEMINI_API_KEY), workersAI);
  }

  if (workersAI) {
    return workersAI;
  }

  return {
    async extractPlan(): Promise<AIPlanExtraction> {
      throw new Error('No AI provider configured');
    },
    async rewriteConversationally(): Promise<string> {
      throw new Error('No AI provider configured');
    },
    async fixTolkSource(): Promise<string> {
      throw new Error('No AI provider configured');
    },
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
