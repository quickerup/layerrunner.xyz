# Layer Runners - Development Guide

## Project Structure

```
src/
├── worker.ts                 # Cloudflare Worker entry point
├── config.ts                 # Environment configuration
├── telegram/
│   ├── webhook.ts           # Telegram webhook handler
│   ├── message-handler.ts   # Message processing orchestration
│   ├── api.ts               # Telegram API client
│   └── types.ts             # Type definitions
├── core/
│   ├── intent-parser.ts     # User intent extraction
│   ├── planner.ts           # Execution plan generation
│   └── approval.ts          # Approval workflow management
└── services/
    ├── github.ts            # GitHub API integration
    └── executor.ts          # Action execution engine
```

## Core Flow

1. **Webhook Reception** → `telegram/webhook.ts`
   - Validates incoming Telegram update
   - Extracts message and user info
   - Returns success response immediately

2. **Intent Parsing** → `core/intent-parser.ts`
   - Analyzes user message
   - Extracts intent type (query, action, diagnostic)
   - Identifies keywords and context

3. **Plan Generation** → `core/planner.ts`
   - Generates execution steps based on intent
   - Assesses risk level
   - Determines if approval is required

4. **Approval Decision** → `core/approval.ts`
   - For high-risk operations, creates approval request
   - Sends approval prompt to user
   - Waits for user confirmation

5. **Action Execution** → `services/executor.ts`
   - Executes approved actions
   - Integrates with external services (GitHub, Supabase, etc.)
   - Captures results and errors

6. **Response Formatting** → `telegram/message-handler.ts`
   - Formats execution results
   - Sends response back to user via Telegram

## Environment Variables

Required for production:
```env
TELEGRAM_BOT_TOKEN=your_telegram_bot_token
GITHUB_TOKEN=your_github_token
GITHUB_OWNER=your_github_username
```

## Adding New Integrations

### 1. Create Service Module
Create `src/services/yourservice.ts`:

```typescript
export class YourService {
  async performAction(params: any) {
    // Implementation
  }
}
```

### 2. Update Planner
Add intent handling in `src/core/planner.ts`:

```typescript
if (intent.includes('yourservice')) {
  return [{
    action: 'your_action',
    service: 'yourservice',
    requiresApproval: true,
  }];
}
```

### 3. Update Executor
Add action handling in `src/services/executor.ts`:

```typescript
case 'your_action':
  result = await this.performYourAction(params);
  break;
```

## Testing

```bash
# Type checking
npm run typecheck

# Local development
npm run dev:worker

# Build for deployment
npm run build
```

## Deployment

```bash
# Deploy to Cloudflare
npm run deploy:worker

# View logs
wrangler tail
```
