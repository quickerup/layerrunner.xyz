/**
 * Intent Parser
 * Analyzes user input and extracts structured intent
 */

export interface UserIntent {
  type: 'query' | 'action' | 'diagnostic' | 'unknown';
  description: string;
  keywords: string[];
  confidence: number;
  context?: Record<string, any>;
}

const INTENT_PATTERNS = {
  query: {
    keywords: ['what', 'how', 'where', 'when', 'why', 'show', 'tell', 'list', 'get'],
    confidence: 0.9,
  },
  action: {
    keywords: ['create', 'deploy', 'add', 'update', 'delete', 'remove', 'setup', 'configure'],
    confidence: 0.95,
  },
  diagnostic: {
    keywords: ['why', 'failed', 'error', 'issue', 'problem', 'investigate', 'debug', 'status'],
    confidence: 0.85,
  },
};

export function classifyIntentWithRules(userInput: string): UserIntent {
  const normalizedInput = userInput.toLowerCase();
  const words = normalizedInput.split(/\s+/);
  
  let detectedType: keyof typeof INTENT_PATTERNS = 'unknown' as any;
  let maxConfidence = 0;
  
  for (const [type, pattern] of Object.entries(INTENT_PATTERNS)) {
    const matchCount = pattern.keywords.filter(kw => 
      words.some(word => word.includes(kw))
    ).length;
    
    if (matchCount > 0) {
      const confidence = (matchCount / pattern.keywords.length) * pattern.confidence;
      if (confidence > maxConfidence) {
        maxConfidence = confidence;
        detectedType = type as keyof typeof INTENT_PATTERNS;
      }
    }
  }
  
  return {
    type: detectedType as any,
    description: userInput,
    keywords: extractKeywords(userInput),
    confidence: maxConfidence || 0.5,
    context: {
      timestamp: new Date().toISOString(),
    },
  };
}

function extractKeywords(input: string): string[] {
  // Simple keyword extraction - can be enhanced
  const words = input.toLowerCase().split(/\s+/);
  return words.filter(word => word.length > 3);
}

export function parseIntent(userInput: string): UserIntent {
  return classifyIntentWithRules(userInput);
}
