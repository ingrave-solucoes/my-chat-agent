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
import { ElevenLabsClient } from "./elevenlabs";

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
 * Payment Tools (Mercado Pago Integration via Payment Workflow)
 */

/**
 * Tool to create a payment link via Mercado Pago
 */
const createPayment = tool({
  description: "Create a payment link using Mercado Pago for the customer to complete their purchase",
  inputSchema: z.object({
    title: z.string().describe("Product or service title"),
    amount: z.number().describe("Payment amount in the currency"),
    currency: z.string().optional().describe("Currency code (default: BRL)"),
    quantity: z.number().optional().describe("Quantity of items (default: 1)"),
    customerEmail: z.string().email().optional().describe("Customer email"),
    customerName: z.string().optional().describe("Customer name"),
    externalReference: z.string().optional().describe("External reference ID for tracking")
  }),
  execute: async ({ title, amount, currency = "BRL", quantity = 1, customerEmail, customerName, externalReference }) => {
    const { env } = getCurrentAgent<Chat>();

    if (!env?.PAYMENT_SERVICE) {
      return "Payment service is not configured";
    }

    try {
      const preference = {
        items: [
          {
            title,
            quantity,
            unit_price: amount,
            currency_id: currency
          }
        ],
        payer: customerEmail || customerName ? {
          email: customerEmail,
          name: customerName
        } : undefined,
        external_reference: externalReference,
        auto_return: "approved" as const
      };

      const response = await env.PAYMENT_SERVICE.fetch("https://payment-service/payment/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(preference)
      });

      if (!response.ok) {
        const error = await response.text();
        return `Failed to create payment: ${error}`;
      }

      const result = await response.json() as {
        success: boolean;
        preference_id: string;
        init_point: string;
        sandbox_init_point: string;
      };

      return `Payment link created successfully!

Payment ID: ${result.preference_id}
Payment Link: ${result.init_point}

Share this link with the customer to complete the payment.`;
    } catch (error) {
      console.error("Error creating payment", error);
      return `Error creating payment: ${error}`;
    }
  }
});

/**
 * Tool to check payment status
 */
const checkPaymentStatus = tool({
  description: "Check the status of a payment using its payment ID",
  inputSchema: z.object({
    paymentId: z.string().describe("The payment ID to check")
  }),
  execute: async ({ paymentId }) => {
    const { env } = getCurrentAgent<Chat>();

    if (!env?.PAYMENT_SERVICE) {
      return "Payment service is not configured";
    }

    try {
      const response = await env.PAYMENT_SERVICE.fetch(
        `https://payment-service/payment/status?id=${paymentId}`
      );

      if (!response.ok) {
        return `Payment not found or error checking status`;
      }

      const payment = await response.json() as {
        id: number;
        status: string;
        status_detail: string;
        amount: number;
        currency: string;
        description: string;
        external_reference?: string;
        payer_email: string;
      };

      const statusMessages: Record<string, string> = {
        approved: "✅ Approved - Payment completed successfully",
        pending: "⏳ Pending - Waiting for payment",
        in_process: "🔄 In Process - Payment being processed",
        rejected: "❌ Rejected - Payment was rejected",
        refunded: "↩️ Refunded - Payment was refunded",
        cancelled: "🚫 Cancelled - Payment was cancelled"
      };

      return `Payment Status for ID ${payment.id}:

Status: ${statusMessages[payment.status] || payment.status}
Amount: ${payment.currency} ${payment.amount}
Description: ${payment.description}
Payer Email: ${payment.payer_email}
${payment.external_reference ? `Reference: ${payment.external_reference}` : ""}
${payment.status_detail ? `Details: ${payment.status_detail}` : ""}`;
    } catch (error) {
      console.error("Error checking payment status", error);
      return `Error checking payment status: ${error}`;
    }
  }
});

/**
 * Workflow Tools (Customer Support Automation)
 */

/**
 * Tool to schedule a follow-up message after a delay
 */
const scheduleFollowUp = tool({
  description: "Schedule an automated follow-up message to be sent to the customer after a specified delay",
  inputSchema: z.object({
    delayMinutes: z.number().describe("Number of minutes to wait before sending the follow-up"),
    message: z.string().optional().describe("Custom follow-up message (optional)")
  }),
  execute: async ({ delayMinutes, message }) => {
    const { agent, env } = getCurrentAgent<Chat>();

    if (!env?.CUSTOMER_SUPPORT_WORKFLOW) {
      return "Workflow service is not configured";
    }

    const conversationId = getChatwootConversationId(agent!.messages);
    if (!conversationId) {
      return "This conversation is not associated with Chatwoot";
    }

    try {
      const instance = await env.CUSTOMER_SUPPORT_WORKFLOW.create({
        params: {
          conversationId,
          customerId: 0, // Will be populated from conversation
          action: "follow_up",
          delayMinutes,
          message
        }
      });

      return `Follow-up scheduled successfully! Workflow ID: ${instance.id}. The message will be sent in ${delayMinutes} minutes.`;
    } catch (error) {
      console.error("Error scheduling follow-up workflow", error);
      return `Error scheduling follow-up: ${error}`;
    }
  }
});

/**
 * Tool to escalate conversation to human agent
 */
const escalateToHuman = tool({
  description: "Escalate the current conversation to a human agent when the AI cannot help",
  inputSchema: z.object({
    reason: z.string().describe("Reason for escalation")
  }),
  execute: async ({ reason }) => {
    const { agent, env } = getCurrentAgent<Chat>();

    if (!env?.CUSTOMER_SUPPORT_WORKFLOW) {
      return "Workflow service is not configured";
    }

    const conversationId = getChatwootConversationId(agent!.messages);
    if (!conversationId) {
      return "This conversation is not associated with Chatwoot";
    }

    try {
      const instance = await env.CUSTOMER_SUPPORT_WORKFLOW.create({
        params: {
          conversationId,
          customerId: 0,
          action: "escalate",
          message: reason
        }
      });

      return `Conversation escalated to human agent. Workflow ID: ${instance.id}`;
    } catch (error) {
      console.error("Error escalating conversation", error);
      return `Error escalating conversation: ${error}`;
    }
  }
});

/**
 * Tool to send satisfaction survey after conversation
 */
const sendSatisfactionSurvey = tool({
  description: "Send a satisfaction survey to the customer after resolving their issue",
  inputSchema: z.object({
    delayMinutes: z.number().optional().describe("Delay before sending survey (default: 5 minutes)")
  }),
  execute: async ({ delayMinutes = 5 }) => {
    const { agent, env } = getCurrentAgent<Chat>();

    if (!env?.CUSTOMER_SUPPORT_WORKFLOW) {
      return "Workflow service is not configured";
    }

    const conversationId = getChatwootConversationId(agent!.messages);
    if (!conversationId) {
      return "This conversation is not associated with Chatwoot";
    }

    try {
      const instance = await env.CUSTOMER_SUPPORT_WORKFLOW.create({
        params: {
          conversationId,
          customerId: 0,
          action: "send_survey",
          delayMinutes
        }
      });

      return `Satisfaction survey scheduled! Workflow ID: ${instance.id}. Survey will be sent in ${delayMinutes} minutes.`;
    } catch (error) {
      console.error("Error scheduling survey", error);
      return `Error scheduling survey: ${error}`;
    }
  }
});

/**
 * ElevenLabs Text-to-Speech Tool
 */
const textToSpeech = tool({
  description: "Convert text to speech audio using ElevenLabs and send it to the customer via Chatwoot",
  inputSchema: z.object({
    text: z.string().describe("The text to convert to speech"),
    voiceId: z.string().optional().describe("Voice ID (default: Rachel - professional female voice)"),
    language: z.enum(["portuguese", "english", "spanish"]).optional().describe("Language hint for better pronunciation (default: portuguese)")
  }),
  execute: async ({ text, voiceId, language = "portuguese" }) => {
    // Check if ElevenLabs is configured
    if (
      !process.env.ELEVENLABS_API_KEY ||
      !process.env.CLOUDFLARE_ACCOUNT_ID ||
      !process.env.AI_GATEWAY_ID
    ) {
      return "ElevenLabs integration is not configured. Please set ELEVENLABS_API_KEY, CLOUDFLARE_ACCOUNT_ID, and AI_GATEWAY_ID environment variables.";
    }

    // Check if Chatwoot is configured
    if (
      !process.env.CHATWOOT_API_KEY ||
      !process.env.CHATWOOT_BASE_URL ||
      !process.env.CHATWOOT_ACCOUNT_ID
    ) {
      return "Chatwoot is not configured. Cannot send audio message.";
    }

    const { agent } = getCurrentAgent<Chat>();
    const conversationId = getChatwootConversationId(agent!.messages);

    if (!conversationId) {
      return "This conversation is not associated with Chatwoot";
    }

    try {
      // Create ElevenLabs client
      const elevenlabsClient = new ElevenLabsClient({
        accountId: process.env.CLOUDFLARE_ACCOUNT_ID,
        gatewayId: process.env.AI_GATEWAY_ID,
        apiKey: process.env.ELEVENLABS_API_KEY
      });

      // Convert text to speech
      const result = await elevenlabsClient.textToSpeech({
        text,
        voiceId,
        modelId: "eleven_multilingual_v2" // Supports Portuguese, English, Spanish, and more
      });

      // Send audio to Chatwoot
      const chatwootClient = new ChatwootClient(
        process.env.CHATWOOT_BASE_URL,
        process.env.CHATWOOT_API_KEY,
        process.env.CHATWOOT_ACCOUNT_ID
      );

      // Send audio attachment to Chatwoot
      await chatwootClient.sendAudioAttachment(
        conversationId,
        result.audio,
        "voice-message.mp3",
        result.contentType
      );

      return `Audio message sent successfully! Size: ${Math.round(result.audio.byteLength / 1024)}KB. The customer received the voice message: "${text.substring(0, 100)}${text.length > 100 ? '...' : ''}"`;
    } catch (error) {
      console.error("Error generating text-to-speech", error);
      return `Error generating audio: ${error}`;
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
  resolveChatwootConversation,
  createPayment,
  checkPaymentStatus,
  scheduleFollowUp,
  escalateToHuman,
  sendSatisfactionSurvey,
  textToSpeech
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
