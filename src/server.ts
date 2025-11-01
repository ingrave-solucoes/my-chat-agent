import { routeAgentRequest, type Schedule } from "agents";

import { getSchedulePrompt } from "agents/schedule";

import { AIChatAgent } from "agents/ai-chat-agent";
import {
  generateId,
  streamText,
  type StreamTextOnFinishCallback,
  stepCountIs,
  createUIMessageStream,
  convertToModelMessages,
  createUIMessageStreamResponse,
  type ToolSet
} from "ai";
import { openai } from "@ai-sdk/openai";
import { processToolCalls, cleanupMessages } from "./utils";
import { tools, executions } from "./tools";
import type { ChatwootWebhookEvent } from "./chatwoot-types";
import {
  ChatwootClient,
  chatwootMessageToUIMessage,
  validateWebhookSignature,
  getChatwootAgentId
} from "./chatwoot";
// import { env } from "cloudflare:workers";

const model = openai("gpt-4o-2024-11-20");
// Cloudflare AI Gateway
// const openai = createOpenAI({
//   apiKey: env.OPENAI_API_KEY,
//   baseURL: env.GATEWAY_BASE_URL,
// });

/**
 * Chat Agent implementation that handles real-time AI chat interactions
 */
export class Chat extends AIChatAgent<Env> {
  /**
   * Handles incoming chat messages and manages the response stream
   */
  async onChatMessage(
    onFinish: StreamTextOnFinishCallback<ToolSet>,
    _options?: { abortSignal?: AbortSignal }
  ) {
    // const mcpConnection = await this.mcp.connect(
    //   "https://path-to-mcp-server/sse"
    // );

    // Collect all tools, including MCP tools
    const allTools = {
      ...tools,
      ...this.mcp.getAITools()
    };

    const stream = createUIMessageStream({
      execute: async ({ writer }) => {
        // Clean up incomplete tool calls to prevent API errors
        const cleanedMessages = cleanupMessages(this.messages);

        // Process any pending tool calls from previous messages
        // This handles human-in-the-loop confirmations for tools
        const processedMessages = await processToolCalls({
          messages: cleanedMessages,
          dataStream: writer,
          tools: allTools,
          executions
        });

        const result = streamText({
          system: `You are a helpful assistant that can do various tasks... 

${getSchedulePrompt({ date: new Date() })}

If the user asks to schedule a task, use the schedule tool to schedule the task.
`,

          messages: convertToModelMessages(processedMessages),
          model,
          tools: allTools,
          // Type boundary: streamText expects specific tool types, but base class uses ToolSet
          // This is safe because our tools satisfy ToolSet interface (verified by 'satisfies' in tools.ts)
          onFinish: onFinish as unknown as StreamTextOnFinishCallback<
            typeof allTools
          >,
          stopWhen: stepCountIs(10)
        });

        writer.merge(result.toUIMessageStream());
      }
    });

    return createUIMessageStreamResponse({ stream });
  }
  async executeTask(description: string, _task: Schedule<string>) {
    await this.saveMessages([
      ...this.messages,
      {
        id: generateId(),
        role: "user",
        parts: [
          {
            type: "text",
            text: `Running scheduled task: ${description}`
          }
        ],
        metadata: {
          createdAt: new Date()
        }
      }
    ]);
  }

  /**
   * Process incoming message from Chatwoot and generate AI response
   */
  async processChatwootMessage(event: ChatwootWebhookEvent) {
    const uiMessage = chatwootMessageToUIMessage(event);
    if (!uiMessage) {
      return;
    }

    // Add the user message to conversation history
    await this.saveMessages([...this.messages, uiMessage]);

    // Collect all tools
    const allTools = {
      ...tools,
      ...this.mcp.getAITools()
    };

    // Clean up incomplete tool calls
    const cleanedMessages = cleanupMessages(this.messages);

    // Process pending tool calls
    const processedMessages = await processToolCalls({
      messages: cleanedMessages,
      dataStream: null,
      tools: allTools,
      executions
    });

    // Generate AI response
    const result = await streamText({
      system: `You are a helpful assistant responding to customer inquiries via Chatwoot.

${getSchedulePrompt({ date: new Date() })}

Provide clear, helpful, and professional responses.`,
      messages: convertToModelMessages(processedMessages),
      model,
      tools: allTools,
      stopWhen: stepCountIs(10)
    });

    // Collect the full response text
    let fullResponse = "";
    for await (const chunk of result.textStream) {
      fullResponse += chunk;
    }

    // Save assistant's response to conversation history
    const assistantMessage = {
      id: generateId(),
      role: "assistant" as const,
      parts: [
        {
          type: "text" as const,
          text: fullResponse
        }
      ],
      metadata: {
        createdAt: new Date()
      }
    };

    await this.saveMessages([...this.messages, assistantMessage]);

    return fullResponse;
  }
}

/**
 * Worker entry point that routes incoming requests to the appropriate handler
 */
export default {
  async fetch(request: Request, env: Env, _ctx: ExecutionContext) {
    const url = new URL(request.url);

    // Health check for OpenAI key
    if (url.pathname === "/check-open-ai-key") {
      const hasOpenAIKey = !!process.env.OPENAI_API_KEY;
      return Response.json({
        success: hasOpenAIKey
      });
    }

    // Chatwoot webhook endpoint
    if (url.pathname === "/chatwoot/webhook" && request.method === "POST") {
      try {
        // Validate webhook signature if configured
        const webhookSecret = process.env.CHATWOOT_WEBHOOK_SECRET;
        if (!validateWebhookSignature(request, webhookSecret)) {
          return new Response("Unauthorized", { status: 401 });
        }

        const event: ChatwootWebhookEvent = await request.json();

        // Only process message_created events
        if (event.event !== "message_created") {
          return Response.json({
            status: "ignored",
            reason: "not a message_created event"
          });
        }

        // Ignore outgoing messages (bot's own messages)
        if (event.message?.message_type === "outgoing") {
          return Response.json({
            status: "ignored",
            reason: "outgoing message"
          });
        }

        // Get or create agent for this conversation
        const conversationId = event.conversation?.id;
        if (!conversationId) {
          return Response.json({ status: "error", reason: "no conversation_id" }, { status: 400 });
        }

        // Get Durable Object for this conversation
        const agentId = getChatwootAgentId(conversationId);
        const durableObjectId = env.Chat.idFromName(agentId);
        const agentStub = env.Chat.get(durableObjectId);

        // Process the message and generate response
        const response = await agentStub.processChatwootMessage(event);

        // Send response back to Chatwoot
        if (response) {
          const chatwootClient = new ChatwootClient(
            process.env.CHATWOOT_BASE_URL || "",
            process.env.CHATWOOT_API_KEY || "",
            process.env.CHATWOOT_ACCOUNT_ID || ""
          );

          await chatwootClient.sendMessage(conversationId, response);
        }

        return Response.json({ status: "success" });
      } catch (error) {
        console.error("Error processing Chatwoot webhook:", error);
        return Response.json(
          {
            status: "error",
            message: error instanceof Error ? error.message : "Unknown error"
          },
          { status: 500 }
        );
      }
    }

    if (!process.env.OPENAI_API_KEY) {
      console.error(
        "OPENAI_API_KEY is not set, don't forget to set it locally in .dev.vars, and use `wrangler secret bulk .dev.vars` to upload it to production"
      );
    }
    return (
      // Route the request to our agent or return 404 if not found
      (await routeAgentRequest(request, env)) ||
      new Response("Not found", { status: 404 })
    );
  }
} satisfies ExportedHandler<Env>;
