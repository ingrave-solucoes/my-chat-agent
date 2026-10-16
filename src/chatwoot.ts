/* Chatwoot (app.ingrave.com.br) Application API: the assistant's conversations live in a
   dedicated API inbox. While the AI answers they stay "pending" (out of the team's queue but
   visible for review); a handoff opens them so the team is notified, and replies typed by the
   team come back through the inbox webhook (see server.ts). */

type ChatwootEnv = Pick<
  Env,
  "CHATWOOT_BASE_URL" | "CHATWOOT_ACCOUNT_ID" | "CHATWOOT_INBOX_ID" | "CHATWOOT_HANDOFF_TEAM_ID" | "CHATWOOT_API_TOKEN"
>;

/** Marks messages written by the assistant so the webhook can ignore their echo. */
export const AGENT_MARK = "ingrave_agent";

export const chatwootEnabled = (env: ChatwootEnv) =>
  Boolean(env.CHATWOOT_BASE_URL && env.CHATWOOT_ACCOUNT_ID && env.CHATWOOT_INBOX_ID && env.CHATWOOT_API_TOKEN);

export class ChatwootClient {
  private readonly account: string;
  private readonly inboxId: number;

  constructor(private readonly env: ChatwootEnv) {
    this.account = `${env.CHATWOOT_BASE_URL.replace(/\/+$/, "")}/api/v1/accounts/${encodeURIComponent(env.CHATWOOT_ACCOUNT_ID)}`;
    this.inboxId = Number(env.CHATWOOT_INBOX_ID);
  }

  conversationUrl(conversationId: number) {
    return `${this.env.CHATWOOT_BASE_URL.replace(/\/+$/, "")}/app/accounts/${this.env.CHATWOOT_ACCOUNT_ID}/conversations/${conversationId}`;
  }

  private async call<T = Record<string, unknown>>(path: string, init: RequestInit = {}): Promise<T> {
    const headers = new Headers(init.headers);
    headers.set("Content-Type", "application/json");
    headers.set("api_access_token", this.env.CHATWOOT_API_TOKEN ?? "");
    const response = await fetch(`${this.account}${path}`, { ...init, headers });
    const text = await response.text();
    if (!response.ok) throw new Error(`chatwoot ${init.method ?? "GET"} ${path} → ${response.status} ${text.slice(0, 200)}`);
    return (text ? JSON.parse(text) : {}) as T;
  }

  /** Creates the contact and a pending conversation tagged with the agent session. */
  async startConversation(session: string, contact: { name: string; attributes: Record<string, string> }, note: string) {
    type Created = {
      id?: number;
      payload?: { contact?: { id: number; contact_inboxes?: { source_id: string }[] }; contact_inbox?: { source_id?: string } };
    };
    const created = await this.call<Created>("/contacts", {
      method: "POST",
      body: JSON.stringify({ inbox_id: this.inboxId, name: contact.name, custom_attributes: contact.attributes }),
    });
    const contactId = created.payload?.contact?.id ?? created.id;
    if (!contactId) throw new Error("chatwoot contact without id");
    let sourceId = created.payload?.contact_inbox?.source_id ?? created.payload?.contact?.contact_inboxes?.[0]?.source_id;
    if (!sourceId) {
      // Older versions do not return the contact inbox: create it explicitly.
      const link = await this.call<{ source_id?: string }>(`/contacts/${contactId}/contact_inboxes`, {
        method: "POST",
        body: JSON.stringify({ inbox_id: this.inboxId }),
      });
      sourceId = link.source_id;
    }
    if (!sourceId) throw new Error("chatwoot contact inbox without source_id");
    const conversation = await this.call<{ id: number }>("/conversations", {
      method: "POST",
      body: JSON.stringify({
        inbox_id: this.inboxId,
        contact_id: contactId,
        source_id: sourceId,
        status: "pending",
        custom_attributes: { agent_session: session },
      }),
    });
    if (!conversation.id) throw new Error("chatwoot conversation without id");
    await this.addLabels(conversation.id, ["agente-ia"]).catch(() => undefined);
    if (note) await this.note(conversation.id, note).catch(() => undefined);
    return { contactId, conversationId: conversation.id };
  }

  /** Visitor message (incoming) or assistant message (outgoing, marked). Returns the message id. */
  async message(conversationId: number, content: string, kind: "visitor" | "assistant") {
    const body =
      kind === "visitor"
        ? { content, message_type: "incoming" }
        : { content, message_type: "outgoing", content_attributes: { [AGENT_MARK]: true } };
    const message = await this.call<{ id?: number }>(`/conversations/${conversationId}/messages`, { method: "POST", body: JSON.stringify(body) });
    return message.id;
  }

  async note(conversationId: number, content: string) {
    await this.call(`/conversations/${conversationId}/messages`, {
      method: "POST",
      body: JSON.stringify({ content, message_type: "outgoing", private: true, content_attributes: { [AGENT_MARK]: true } }),
    });
  }

  async addLabels(conversationId: number, labels: string[]) {
    const current = await this.call<{ payload?: string[] }>(`/conversations/${conversationId}/labels`).catch(() => ({ payload: [] }));
    await this.call(`/conversations/${conversationId}/labels`, {
      method: "POST",
      body: JSON.stringify({ labels: [...new Set([...(current.payload ?? []), ...labels])] }),
    });
  }

  async updateContact(contactId: number, data: { name?: string; email?: string; phone_number?: string; attributes?: Record<string, string> }) {
    const body: Record<string, unknown> = {};
    if (data.name) body.name = data.name;
    if (data.email) body.email = data.email;
    if (data.phone_number) body.phone_number = data.phone_number;
    if (data.attributes) body.custom_attributes = data.attributes;
    await this.call(`/contacts/${contactId}`, { method: "PUT", body: JSON.stringify(body) });
  }

  async setStatus(conversationId: number, status: "open" | "pending" | "resolved") {
    await this.call(`/conversations/${conversationId}/toggle_status`, { method: "POST", body: JSON.stringify({ status }) });
  }

  async assignTeam(conversationId: number) {
    if (!this.env.CHATWOOT_HANDOFF_TEAM_ID) return;
    await this.call(`/conversations/${conversationId}/assignments`, {
      method: "POST",
      body: JSON.stringify({ team_id: Number(this.env.CHATWOOT_HANDOFF_TEAM_ID) }),
    });
  }

  async getConversation(conversationId: number) {
    return this.call<{ id: number; status?: string; custom_attributes?: Record<string, unknown> }>(`/conversations/${conversationId}`);
  }
}

/* ---------- inbox webhook ---------- */

export type WebhookEvent = {
  event?: string;
  id?: number;
  content?: string | null;
  message_type?: string | number;
  private?: boolean;
  content_attributes?: Record<string, unknown> | null;
  sender?: { id?: number; name?: string; type?: string; thumbnail?: string; avatar_url?: string } | null;
  conversation?: { id?: number; status?: string; custom_attributes?: Record<string, unknown> | null } | null;
  status?: string;
  custom_attributes?: Record<string, unknown> | null;
  user?: { name?: string } | null;
  attachments?: { data_url?: string; file_type?: string }[];
};

/** Conversation id from any inbox webhook payload. */
export function conversationIdOf(event: WebhookEvent) {
  if (event.event === "message_created" || event.event === "message_updated") return event.conversation?.id;
  return event.id ?? event.conversation?.id;
}

/** Agent session name stored on the conversation when it was created. */
export function sessionOf(event: WebhookEvent): string | undefined {
  const attributes = event.conversation?.custom_attributes ?? event.custom_attributes;
  const session = attributes?.agent_session;
  return typeof session === "string" && /^[a-z0-9-]{16,64}$/i.test(session) ? session : undefined;
}

/** A public reply typed by someone on the team (not a note, not the assistant's own echo). */
export function isTeamReply(event: WebhookEvent) {
  const outgoing = event.message_type === "outgoing" || event.message_type === 1;
  return (
    event.event === "message_created" &&
    outgoing &&
    !event.private &&
    !event.content_attributes?.[AGENT_MARK] &&
    event.sender?.type !== "agent_bot" &&
    Boolean(event.content?.trim() || event.attachments?.length)
  );
}

/** Constant-time comparison for the webhook secret. */
export function safeEqual(a: string, b: string) {
  const left = new TextEncoder().encode(a);
  const right = new TextEncoder().encode(b);
  let diff = left.length ^ right.length;
  for (let i = 0; i < Math.max(left.length, right.length); i++) diff |= (left[i] ?? 0) ^ (right[i] ?? 0);
  return diff === 0;
}
