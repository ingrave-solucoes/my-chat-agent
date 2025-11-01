/**
 * Chatwoot webhook event types
 */
export interface ChatwootWebhookEvent {
  event: string;
  id: number;
  account?: ChatwootAccount;
  conversation?: ChatwootConversation;
  message?: ChatwootMessage;
  sender?: ChatwootContact;
}

export interface ChatwootAccount {
  id: number;
  name: string;
}

export interface ChatwootConversation {
  id: number;
  inbox_id: number;
  status: "open" | "resolved" | "pending";
  contact_last_seen_at: string;
  agent_last_seen_at: string;
  messages: ChatwootMessage[];
  meta: {
    sender?: ChatwootContact;
    assignee?: ChatwootUser;
  };
}

export interface ChatwootMessage {
  id: number;
  content: string;
  message_type: "incoming" | "outgoing";
  content_type: "text" | "input_select" | "cards" | "form";
  created_at: number;
  conversation_id: number;
  sender?: ChatwootContact | ChatwootUser;
  inbox_id: number;
}

export interface ChatwootContact {
  id: number;
  name: string;
  email?: string;
  phone_number?: string;
  identifier?: string;
  type: "contact";
}

export interface ChatwootUser {
  id: number;
  name: string;
  email: string;
  type: "user";
}

/**
 * Chatwoot API request/response types
 */
export interface ChatwootSendMessageRequest {
  content: string;
  message_type?: "outgoing";
  private?: boolean;
}

export interface ChatwootSendMessageResponse {
  id: number;
  content: string;
  message_type: string;
  created_at: number;
  conversation_id: number;
}
