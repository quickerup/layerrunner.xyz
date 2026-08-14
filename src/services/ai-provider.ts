import { Env } from '../config';
import { classifyIntentWithRules } from '../core/intent-parser';

export type IntentClassificationType = 'query' | 'action' | 'diagnostic' | 'unknown';

export interface IntentClassification {
  type: IntentClassificationType;
  confidence: number;
  reasoning?: string;
}

export interface AIProvider {
  classifyIntent(input: string): Promise<IntentClassification>;
}

export class RuleBasedProvider implements AIProvider {
  async classifyIntent(input: string): Promise<IntentClassification> {
    const intent = classifyIntentWithRules(input);
    return {
      type: intent.type,
      confidence: intent.confidence,
      reasoning: 'Rule-based keyword fallback',
    };
  }
}

export class CloudflareAIProvider implements AIProvider {
  // Listed in the Cloudflare Workers AI model catalog as a current text-generation model.
  private readonly model = '@cf/meta/llama-3.3-70b-instruct-fp8-fast';

  constructor(private readonly env: Env) {}

  async classifyIntent(input: string): Promise<IntentClassification> {
    if (!this.env.AI) {
      throw new Error('Workers AI binding is not configured');
    }

    const prompt = [
      'Classify this Layer Runners Telegram request.',
      'Return strict JSON only with keys: type, confidence, reasoning.',
      'type must be one of: query, action, diagnostic, unknown.',
      'query is read-only information retrieval. action changes or creates resources. diagnostic investigates failures/status.',
      'confidence must be a number from 0 to 1.',
      `Request: ${JSON.stringify(input)}`,
    ].join('\n');

    const result = await this.env.AI.run(this.model, {
      messages: [
        { role: 'system', content: 'You are a strict JSON intent classifier.' },
        { role: 'user', content: prompt },
      ],
      max_tokens: 256,
    });

    return parseClassification(result);
  }
}

export function createIntentProvider(env: Env): AIProvider {
  const fallback = new RuleBasedProvider();

  if (!env.AI) {
    return fallback;
  }

  return {
    async classifyIntent(input: string): Promise<IntentClassification> {
      try {
        return await new CloudflareAIProvider(env).classifyIntent(input);
      } catch (error) {
        console.warn('Workers AI intent classification failed; using rule fallback.', error);
        return fallback.classifyIntent(input);
      }
    },
  };
}

function parseClassification(result: unknown): IntentClassification {
  const text = extractText(result);
  const jsonText = text.match(/\{[\s\S]*\}/)?.[0] ?? text;
  const parsed = JSON.parse(jsonText) as Partial<IntentClassification>;

  if (!['query', 'action', 'diagnostic', 'unknown'].includes(parsed.type ?? '')) {
    throw new Error('AI returned invalid intent type');
  }

  const confidence = Number(parsed.confidence);
  if (!Number.isFinite(confidence)) {
    throw new Error('AI returned invalid confidence');
  }

  return {
    type: parsed.type as IntentClassificationType,
    confidence: Math.max(0, Math.min(1, confidence)),
    reasoning: typeof parsed.reasoning === 'string' ? parsed.reasoning : undefined,
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
