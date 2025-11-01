/**
 * Tool definitions for the AI chat agent
 * Tools can either require human confirmation or execute automatically
 */
import { tool, type ToolSet } from "ai";
import { z } from "zod/v3";

import type { Chat } from "./server";
import { getCurrentAgent } from "agents";
import { scheduleSchema } from "agents/schedule";
import { ChatwootClient, getChatwootConversationId } from "./chatwoot";

/**
 * Weather information tool that requires human confirmation
 * When invoked, this will present a confirmation dialog to the user
 */
const getWeatherInformation = tool({
  description: "show the weather in a given city to the user",
  inputSchema: z.object({ city: z.string() })
  // Omitting execute function makes this tool require human confirmation
});

/**
 * Local time tool that executes automatically
 * Since it includes an execute function, it will run without user confirmation
 * This is suitable for low-risk operations that don't need oversight
 */
const getLocalTime = tool({
  description: "get the local time for a specified location",
  inputSchema: z.object({ location: z.string() }),
  execute: async ({ location }) => {
    console.log(`Getting local time for ${location}`);
    return "10am";
  }
});

const scheduleTask = tool({
  description: "A tool to schedule a task to be executed at a later time",
  inputSchema: scheduleSchema,
  execute: async ({ when, description }) => {
    // we can now read the agent context from the ALS store
    const { agent } = getCurrentAgent<Chat>();

    function throwError(msg: string): string {
      throw new Error(msg);
    }
    if (when.type === "no-schedule") {
      return "Not a valid schedule input";
    }
    const input =
      when.type === "scheduled"
        ? when.date // scheduled
        : when.type === "delayed"
          ? when.delayInSeconds // delayed
          : when.type === "cron"
            ? when.cron // cron
            : throwError("not a valid schedule input");
    try {
      agent!.schedule(input!, "executeTask", description);
    } catch (error) {
      console.error("error scheduling task", error);
      return `Error scheduling task: ${error}`;
    }
    return `Task scheduled for type "${when.type}" : ${input}`;
  }
});

/**
 * Tool to list all scheduled tasks
 * This executes automatically without requiring human confirmation
 */
const getScheduledTasks = tool({
  description: "List all tasks that have been scheduled",
  inputSchema: z.object({}),
  execute: async () => {
    const { agent } = getCurrentAgent<Chat>();

    try {
      const tasks = agent!.getSchedules();
      if (!tasks || tasks.length === 0) {
        return "No scheduled tasks found.";
      }
      return tasks;
    } catch (error) {
      console.error("Error listing scheduled tasks", error);
      return `Error listing scheduled tasks: ${error}`;
    }
  }
});

/**
 * Tool to cancel a scheduled task by its ID
 * This executes automatically without requiring human confirmation
 */
const cancelScheduledTask = tool({
  description: "Cancel a scheduled task using its ID",
  inputSchema: z.object({
    taskId: z.string().describe("The ID of the task to cancel")
  }),
  execute: async ({ taskId }) => {
    const { agent } = getCurrentAgent<Chat>();
    try {
      await agent!.cancelSchedule(taskId);
      return `Task ${taskId} has been successfully canceled.`;
    } catch (error) {
      console.error("Error canceling scheduled task", error);
      return `Error canceling task ${taskId}: ${error}`;
    }
  }
});

/**
 * Chatwoot Tools (optional - only available when Chatwoot is configured)
 */

/**
 * Tool to send a private note in Chatwoot conversation
 * Private notes are only visible to agents, not customers
 */
const sendChatwootNote = tool({
  description:
    "Send a private note in the Chatwoot conversation (only visible to agents)",
  inputSchema: z.object({
    note: z.string().describe("The private note content")
  }),
  execute: async ({ note }) => {
    if (
      !process.env.CHATWOOT_API_KEY ||
      !process.env.CHATWOOT_BASE_URL ||
      !process.env.CHATWOOT_ACCOUNT_ID
    ) {
      return "Chatwoot is not configured";
    }

    const { agent } = getCurrentAgent<Chat>();
    const conversationId = getChatwootConversationId(agent!.messages);

    if (!conversationId) {
      return "This conversation is not associated with Chatwoot";
    }

    try {
      const client = new ChatwootClient(
        process.env.CHATWOOT_BASE_URL,
        process.env.CHATWOOT_API_KEY,
        process.env.CHATWOOT_ACCOUNT_ID
      );

      await client.sendMessage(conversationId, note, true);
      return "Private note sent successfully";
    } catch (error) {
      console.error("Error sending Chatwoot note", error);
      return `Error sending note: ${error}`;
    }
  }
});

/**
 * Tool to resolve/close a Chatwoot conversation
 */
const resolveChatwootConversation = tool({
  description: "Resolve (close) the current Chatwoot conversation",
  inputSchema: z.object({}),
  execute: async () => {
    if (
      !process.env.CHATWOOT_API_KEY ||
      !process.env.CHATWOOT_BASE_URL ||
      !process.env.CHATWOOT_ACCOUNT_ID
    ) {
      return "Chatwoot is not configured";
    }

    const { agent } = getCurrentAgent<Chat>();
    const conversationId = getChatwootConversationId(agent!.messages);

    if (!conversationId) {
      return "This conversation is not associated with Chatwoot";
    }

    try {
      const client = new ChatwootClient(
        process.env.CHATWOOT_BASE_URL,
        process.env.CHATWOOT_API_KEY,
        process.env.CHATWOOT_ACCOUNT_ID
      );

      await client.toggleConversationStatus(conversationId, "resolved");
      return "Conversation resolved successfully";
    } catch (error) {
      console.error("Error resolving Chatwoot conversation", error);
      return `Error resolving conversation: ${error}`;
    }
  }
});

/**
 * Export all available tools
 * These will be provided to the AI model to describe available capabilities
 */
export const tools = {
  getWeatherInformation,
  getLocalTime,
  scheduleTask,
  getScheduledTasks,
  cancelScheduledTask,
  sendChatwootNote,
  resolveChatwootConversation
} satisfies ToolSet;

/**
 * Implementation of confirmation-required tools
 * This object contains the actual logic for tools that need human approval
 * Each function here corresponds to a tool above that doesn't have an execute function
 */
export const executions = {
  getWeatherInformation: async ({ city }: { city: string }) => {
    console.log(`Getting weather information for ${city}`);
    return `The weather in ${city} is sunny`;
  }
};
