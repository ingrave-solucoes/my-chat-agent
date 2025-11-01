# WARP.md

This file provides guidance to WARP (warp.dev) when working with code in this repository.

## Project Overview

This is a Cloudflare Agents starter project built with TypeScript, React, and Vite. It implements an AI-powered chat agent using Cloudflare's Agent platform and the Vercel AI SDK, with OpenAI as the default model provider.

The project showcases a chat interface with:
- Real-time streaming AI responses
- Tool system with human-in-the-loop confirmations
- Task scheduling (one-time, delayed, and cron-based)
- Durable Object-backed state management
- Dark/light theme support

## Essential Commands

### Development
```bash
# Start local development server
npm start

# Check code formatting and linting
npm run check

# Format code
npm run format

# Run tests
npm test
```

### Deployment
```bash
# Deploy to Cloudflare Workers
npm run deploy
```

### Type Generation
```bash
# Generate TypeScript types for Cloudflare Workers environment
npm run types
```

### Environment Setup
Create a `.dev.vars` file in the root directory:
```
OPENAI_API_KEY=your_openai_api_key
```

For production, use Wrangler to upload secrets:
```bash
wrangler secret bulk .dev.vars
```

## Architecture

### Core Architecture Pattern
The project follows a **client-server agent architecture** where:

1. **Client (React)**: `src/app.tsx` and `src/client.tsx`
   - Uses `useAgent` hook from `agents/react` to establish WebSocket connection
   - Uses `useAgentChat` hook from `agents/ai-react` for chat functionality
   - Manages UI state and tool confirmation dialogs

2. **Server (Cloudflare Worker)**: `src/server.ts`
   - Implements `Chat` class extending `AIChatAgent<Env>`
   - Routes requests via `routeAgentRequest` from the `agents` package
   - Handles AI streaming via `streamText` from the Vercel AI SDK

3. **Durable Objects**: The `Chat` class is a Durable Object with SQLite storage
   - Configured in `wrangler.jsonc` with `new_sqlite_classes: ["Chat"]`
   - Provides state persistence and agent-specific memory

### Key Architectural Concepts

#### Tool System Architecture
Tools operate in two modes:

1. **Auto-executing tools** (defined with `execute` function in `tools.ts`):
   - Run immediately without confirmation
   - Examples: `getLocalTime`, `scheduleTask`, `getScheduledTasks`, `cancelScheduledTask`

2. **Human-in-the-loop tools** (no `execute` function):
   - Require user approval via UI confirmation dialog
   - Defined in `tools.ts` without `execute` function
   - Execution logic in `executions` object in `tools.ts`
   - Must be listed in `toolsRequiringConfirmation` array in `app.tsx`
   - Example: `getWeatherInformation`

The `processToolCalls` function in `utils.ts` handles the confirmation flow by:
- Detecting pending tool calls with `state === "output-available"`
- Checking for user approval (`APPROVAL.YES` or `APPROVAL.NO`)
- Executing approved tools via the `executions` object

#### Message Processing Flow
1. User sends message via UI → `sendMessage` from `useAgentChat`
2. Message stored in agent's Durable Object state
3. `onChatMessage` method in `Chat` class invoked
4. Messages cleaned via `cleanupMessages` (removes incomplete tool calls)
5. Tool calls processed via `processToolCalls` (handles confirmations)
6. `streamText` generates AI response with tool invocations
7. Response streamed back to client via `createUIMessageStream`

#### Task Scheduling System
The agent supports scheduling tasks via the `this.schedule` API:
- **Delayed tasks**: Pass seconds as number (e.g., `10` for 10 seconds)
- **Scheduled tasks**: Pass Date object (e.g., `new Date("2025-01-01")`)
- **Recurring tasks**: Pass cron string (e.g., `"*/10 * * * *"` for every 10 seconds)

When a scheduled task fires, the `executeTask` method is called with the task description and schedule metadata.

The `getSchedulePrompt` utility generates a system prompt explaining scheduling capabilities to the AI model.

### Project Structure
```
src/
├── server.ts          # Chat agent logic (Durable Object + AI streaming)
├── app.tsx           # React chat UI with WebSocket connection
├── client.tsx        # React entry point
├── tools.ts          # Tool definitions and execution handlers
├── utils.ts          # Message processing (tool confirmations, cleanup)
├── shared.ts         # Shared constants (e.g., APPROVAL enum)
├── styles.css        # Tailwind CSS styling
├── components/       # UI components (Button, Card, Avatar, etc.)
├── hooks/            # Custom React hooks
├── lib/              # Utility functions
└── providers/        # React context providers
```

### State Management
- **Agent state**: Managed by Durable Objects with SQLite backing via `this.setState`
- **Chat messages**: Persisted in agent state via `saveMessages`
- **UI state**: Local React state for theme, debug mode, text input

### Alternative AI Model Providers
The starter uses OpenAI by default, but can be switched to:

1. **Workers AI** (Cloudflare's inference):
   - Install: `npm install workers-ai-provider`
   - Replace `openai` import with `createWorkersAI` from `workers-ai-provider`
   - Add `ai` binding to `wrangler.jsonc`

2. **Anthropic**:
   - Install: `npm install @ai-sdk/anthropic`
   - Replace `openai` with `anthropic` from `@ai-sdk/anthropic`

3. **AI Gateway**: Can be used with any provider for caching and logging
   - Set `baseURL` in SDK client to AI Gateway URL

## Development Guidelines

### Adding New Tools
1. Define tool in `tools.ts` using `tool` from `ai` package
2. Use Zod (`z`) for parameter validation via `inputSchema`
3. **For auto-executing tools**: Include `execute` function
4. **For confirmation-required tools**:
   - Omit `execute` function in tool definition
   - Add execution logic to `executions` object in `tools.ts`
   - Add tool name to `toolsRequiringConfirmation` in `app.tsx`

### Extending Agent Capabilities
To add custom agent methods:
1. Add method to `Chat` class in `server.ts`
2. Use `this.setState` to persist state changes
3. Use `this.sql` to query SQLite database directly (if needed)
4. Use `this.schedule` to schedule future tasks
5. Access environment bindings via `this.env`

### Type Safety
- The `Chat` class extends `Agent<Env>` where `Env` is the Cloudflare Workers environment interface
- Use `getCurrentAgent<Chat>()` from `agents` package to access agent context in tool executions
- Type parameters ensure type safety for agent state and scheduled tasks

### Message Handling
- Use `convertToModelMessages` from `ai` to convert UI messages to model format
- Use `isToolUIPart` to check if a message part is a tool invocation
- Clean messages with `cleanupMessages` before sending to AI API (prevents errors from incomplete tool calls)

### MCP Integration
The agent supports Model Context Protocol (MCP) servers:
```typescript
// Connect to MCP server
const mcpConnection = await this.mcp.connect("https://path-to-mcp-server/sse");

// Merge MCP tools with regular tools
const allTools = {
  ...tools,
  ...this.mcp.getAITools()
};
```

## Code Standards

### TypeScript Configuration
- ES modules format exclusively (configured in `package.json` with `"type": "module"`)
- TypeScript strict mode enabled
- Cloudflare Workers types via `@cloudflare/workers-types`

### Code Quality Tools
- **Biome**: Linting (configured in `biome.json`)
- **Prettier**: Code formatting (configured in `.prettierrc`)
- **TypeScript**: Type checking via `tsc`

Run all checks with: `npm run check`

### Testing
- **Vitest**: Test runner with Cloudflare Workers pool
- Test configuration: `vitest.config.ts`
- Workers-specific testing via `@cloudflare/vitest-pool-workers`
- Run tests: `npm test`

### Cloudflare-Specific Guidelines
- Use `nodejs_compat` compatibility flag for Node.js APIs
- Set `compatibility_date` in `wrangler.jsonc` to ensure consistent behavior
- Use `satisfies ExportedHandler<Env>` for Worker exports
- Bindings must match between TypeScript interface and `wrangler.jsonc`

## Important Notes

### Human-in-the-Loop Tool Pattern
When adding tools requiring confirmation:
1. Tool definition in `tools.ts` MUST NOT have `execute` function
2. Execution logic MUST be in `executions` object
3. Tool name MUST be added to `toolsRequiringConfirmation` array in `app.tsx`

Failure to sync these three locations will result in tools not working correctly.

### Message State Management
The agent uses UI messages (`UIMessage` type) which include:
- `parts`: Array of message parts (text, tool invocations)
- `metadata`: Optional metadata like `createdAt`
- Tool parts have states: `input-streaming`, `input-available`, `output-available`

Always use helper functions like `isToolUIPart` and `cleanupMessages` to handle messages safely.

### Scheduling Best Practices
- Use descriptive task descriptions (passed as second argument to `this.schedule`)
- The callback name (first argument to `this.schedule`) must match a method name on the agent class
- Schedule IDs are returned and can be used to cancel tasks via `this.cancelSchedule`
- Use `this.getSchedules()` to retrieve all scheduled tasks

### AI Gateway Integration
To enable logging and caching for AI requests:
1. Create an AI Gateway in Cloudflare dashboard
2. Set `baseURL` in OpenAI client to: `https://gateway.ai.cloudflare.com/v1/{account_id}/{gateway_id}/openai`
3. No code changes needed beyond baseURL configuration
