import type {
  ChatwootWebhookEvent,
  ChatwootSendMessageRequest,
  ChatwootSendMessageResponse
} from "./chatwoot-types";
import type { UIMessage } from "ai";

/**
 * Chatwoot API client
 */
export class ChatwootClient {
  private baseUrl: string;
  private apiKey: string;
  private accountId: string;

  constructor(baseUrl: string, apiKey: string, accountId: string) {
    this.baseUrl = baseUrl.replace(/\/$/, ""); // Remove trailing slash
    this.apiKey = apiKey;
    this.accountId = accountId;
  }

  /**
   * Send a message to a Chatwoot conversation
   */
  async sendMessage(
    conversationId: number,
    content: string,
    isPrivate = false
  ): Promise<ChatwootSendMessageResponse> {
    const url = `${this.baseUrl}/api/v1/accounts/${this.accountId}/conversations/${conversationId}/messages`;

    const body: ChatwootSendMessageRequest = {
      content,
      message_type: "outgoing",
      private: isPrivate
    };

    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        api_access_token: this.apiKey
      },
      body: JSON.stringify(body)
    });

    if (!response.ok) {
      throw new Error(
        `Failed to send message to Chatwoot: ${response.status} ${response.statusText}`
      );
    }

    return response.json();
  }

  /**
   * Toggle conversation status
   */
  async toggleConversationStatus(
    conversationId: number,
    status: "open" | "resolved"
  ): Promise<void> {
    const url = `${this.baseUrl}/api/v1/accounts/${this.accountId}/conversations/${conversationId}/toggle_status`;

    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        api_access_token: this.apiKey
      },
      body: JSON.stringify({ status })
    });

    if (!response.ok) {
      throw new Error(
        `Failed to toggle conversation status: ${response.status} ${response.statusText}`
      );
    }
  }
}

/**
 * Convert Chatwoot webhook event to Agent UIMessage format
 */
export function chatwootMessageToUIMessage(
  event: ChatwootWebhookEvent
): UIMessage | null {
  const message = event.message;
  const conversation = event.conversation;

  if (!message || !conversation) {
    return null;
  }

  // Only process incoming messages from contacts
  if (message.message_type !== "incoming") {
    return null;
  }

  // Only process text messages
  if (message.content_type !== "text") {
    return null;
  }

  const uiMessage: UIMessage = {
    id: `chatwoot-${conversation.id}-${message.id}`,
    role: "user",
    parts: [
      {
        type: "text",
        text: message.content
      }
    ],
    metadata: {
      createdAt: new Date(message.created_at * 1000),
      chatwootConversationId: conversation.id,
      chatwootMessageId: message.id,
      chatwootSender: message.sender
    }
  };

  return uiMessage;
}

/**
 * Validate Chatwoot webhook signature (if implemented)
 * Note: Basic implementation - enhance based on your security needs
 */
export function validateWebhookSignature(
  request: Request,
  webhookSecret?: string
): boolean {
  if (!webhookSecret) {
    // If no secret is configured, skip validation
    return true;
  }

  // Implement signature validation based on Chatwoot's webhook signature
  // This is a placeholder - adjust based on your Chatwoot configuration
  const signature = request.headers.get("x-chatwoot-signature");
  return !!signature;
}

/**
 * Extract conversation ID from agent state or message metadata
 */
export function getChatwootConversationId(
  messages: UIMessage[]
): number | null {
  // Look for the most recent message with Chatwoot metadata
  for (let i = messages.length - 1; i >= 0; i--) {
    const metadata = messages[i].metadata as
      | Record<string, unknown>
      | undefined;
    if (metadata?.chatwootConversationId) {
      return metadata.chatwootConversationId as number;
    }
  }
  return null;
}

/**
 * Create a unique agent ID for a Chatwoot conversation
 */
export function getChatwootAgentId(conversationId: number): string {
  return `chatwoot-conversation-${conversationId}`;
}
