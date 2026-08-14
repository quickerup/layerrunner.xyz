import { TelegramMessage } from './types';
import { parseIntent } from '../core/intent-parser';
import { generatePlan } from '../core/planner';
import { sendTelegramMessage } from './api';

export async function handleMessage(message: TelegramMessage): Promise<void> {
  const { text, chat } = message;
  
  if (!text) {
    return;
  }

  try {
    // Parse user's intent
    const intent = parseIntent(text);
    
    // Generate execution plan
    const plan = generatePlan(intent);
    
    // Format and send response
    const response = formatPlanResponse(plan);
    await sendTelegramMessage(chat.id, response);
  } catch (error) {
    console.error('Message handling error:', error);
    await sendTelegramMessage(
      chat.id,
      '❌ I encountered an error processing your request. Please try again.'
    );
  }
}

function formatPlanResponse(plan: any): string {
  const lines: string[] = [];
  lines.push(`*Intent*: ${plan.intent.type}`);
  lines.push(`*Description*: ${plan.intent.description}`);
  
  if (plan.steps.length > 0) {
    lines.push(`\n*Planned Actions*:`);
    plan.steps.forEach((step: any, index: number) => {
      lines.push(`${index + 1}. ${step.action}: ${step.description}`);
    });
  }
  
  if (plan.requiresApproval) {
    lines.push(`\n⚠️ *This requires human approval before execution*`);
  }
  
  return lines.join('\n');
}
