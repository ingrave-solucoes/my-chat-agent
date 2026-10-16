/* Types shared by the agent (Durable Object) and the chat UI. */

export const AGENT_NAME = "IngraveAgent";

/** The assistant's persona: a named virtual assistant (always presented as AI, never as a person). */
export const ASSISTANT = { name: "Íris", role: "Assistente virtual da Ingrave", avatar: "/iris.webp" };

/** Who is answering the visitor right now. */
export type ChatMode =
  | "ai" // the assistant answers
  | "waiting" // handed off, waiting for someone from the team
  | "human"; // a person from the team is in the conversation

/** State synced to every open tab of the same conversation (no internal ids here). */
export type AgentState = {
  mode: ChatMode;
  /** Name and photo of the person answering, when mode is "human". */
  agent?: { name: string; avatarUrl?: string };
  /** Set on handoff: whether the team is outside business hours. */
  outsideHours?: boolean;
  /** The visitor already shared name and e-mail with the team. */
  leadShared?: boolean;
};

export const initialAgentState: AgentState = { mode: "ai" };

/** Extra data the chat UI sends with every message (forwarded from the website by widget.js). */
export type ChatContext = {
  page?: string;
  title?: string;
  /** First and last campaign touch saved by the website (UTMs, ad click ids, referrer). */
  attribution?: { first?: Record<string, string> | null; last?: Record<string, string> | null };
};

/** Metadata attached to messages that did not come from the model. */
export type MessageMeta = {
  from?: "human" | "system";
  author?: string;
  avatarUrl?: string;
  createdAt?: string;
  /** AI Gateway log ids of the model calls behind an assistant reply (for 👍/👎). */
  gatewayLogs?: string[];
};

/** Events broadcast from the agent to the UI outside of the chat stream. */
export type AgentEvent = { type: "typing"; on: boolean; name?: string };

/** Messages exchanged between widget.js (the website) and the chat iframe. */
export type WidgetMessage =
  | { type: "ingrave-agent:ready" }
  | { type: "ingrave-agent:context"; context: ChatContext; theme?: "light" | "dark" }
  | { type: "ingrave-agent:visibility"; open: boolean }
  | { type: "ingrave-agent:close" }
  | { type: "ingrave-agent:unread"; count: number }
  | { type: "ingrave-agent:track"; event: string; props?: Record<string, unknown> };
