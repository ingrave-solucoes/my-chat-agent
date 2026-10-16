/* IngraveAgent: one Durable Object per website visitor conversation.

   - AI mode: the model (DGX Spark through AI Gateway, Workers AI as fallback) answers with the
     knowledge base and tools; each finished turn is mirrored to a pending conversation in the
     Chatwoot API inbox so the team can review it.
   - Handoff: the conversation is opened in Chatwoot (team notified, optional team assignment and
     Teams alert) and the visitor waits for a person.
   - Human mode: visitor messages go straight to Chatwoot; replies typed by the team arrive through
     the inbox webhook and are pushed to the chat. Resolving the conversation hands it back to the AI. */
import { AIChatAgent, type ChatResponseResult, type OnChatMessageOptions } from "@cloudflare/ai-chat";
import type { Connection } from "agents";
import {
  convertToModelMessages,
  createUIMessageStream,
  createUIMessageStreamResponse,
  generateId,
  pruneMessages,
  hasToolCall,
  stepCountIs,
  streamText,
  type StreamTextTransform,
  type ToolSet,
  type UIMessage,
} from "ai";
import { ChatwootClient, chatwootEnabled, isTeamReply, type WebhookEvent } from "./chatwoot";
import { afterBusinessMinutes, describeHours, isOpen } from "./hours";
import { chatModel } from "./model";
import { searchSite } from "./search";
import { systemPrompt } from "./prompt";
import { type AgentState, type ChatContext, initialAgentState, type MessageMeta } from "./shared";
import { notifyTeams } from "./teams";
import { type ContactInput, createTools, type HandoffInput } from "./tools";

/** Per conversation: generous for a real visitor, a ceiling for abuse. */
const MAX_VISITOR_MESSAGES = 60;
const MAX_MESSAGE_CHARS = 4000;

type ChatwootLink = { contactId: number; conversationId: number };
type FollowUp = { kind: "lead" | "handoff"; since: string };

const textOf = (message: UIMessage) =>
  message.parts
    .filter((part): part is { type: "text"; text: string } => part.type === "text")
    .map((part) => part.text)
    .join("\n")
    .trim();

/** Short description of where the visitor came from, for Chatwoot and Teams. */
function describeOrigin(context?: ChatContext) {
  const last = context?.attribution?.last ?? undefined;
  if (!last) return "direto";
  const utm = [last.utm_source, last.utm_medium, last.utm_campaign].filter(Boolean).join(" / ");
  if (utm) return utm;
  if (last.gclid || last.gbraid || last.wbraid) return "Google Ads";
  if (last.fbclid) return "Meta (Facebook/Instagram)";
  if (last.referrer) return `indicação: ${last.referrer}`;
  return "direto";
}

/** AI Gateway custom metadata (at most 5 entries, flat values) to filter logs by conversation. */
function gatewayMetadata(session: string, context: ChatContext) {
  const metadata: Record<string, string> = { app: "site-assistant", session };
  if (context.page) metadata.page = context.page.slice(0, 120);
  metadata.origin = describeOrigin(context).slice(0, 120);
  return JSON.stringify(metadata);
}

/** A one-off assistant reply that does not call the model (limits). Empty text closes the turn
    without a visible reply, which is what happens while a person from the team is answering. */
function cannedReply(text: string) {
  const stream = createUIMessageStream({
    execute: ({ writer }) => {
      if (!text) return;
      const id = generateId();
      writer.write({ type: "text-start", id });
      writer.write({ type: "text-delta", id, delta: text });
      writer.write({ type: "text-end", id });
    },
  });
  return createUIMessageStreamResponse({ stream });
}

/** Drops model text that follows a successful handoff (it tended to narrate the transfer to the team). */
function silenceAfterHandoff<TOOLS extends ToolSet>(): ReturnType<StreamTextTransform<TOOLS>> {
  let silenced = false;
  return new TransformStream({
    transform(chunk, controller) {
      if (chunk.type === "tool-result" && chunk.toolName === "transferir_para_humano") silenced = true;
      if (silenced && /^(text|reasoning)-/.test(chunk.type)) return;
      controller.enqueue(chunk);
    },
  });
}

/** Messages that carry something for the model (drops empty turns and notices). */
const forModel = (messages: UIMessage[]) =>
  messages.filter((message) => (message.metadata as MessageMeta | undefined)?.from !== "system" && message.parts.some((part) => part.type !== "step-start"));

export class IngraveAgent extends AIChatAgent<Env, AgentState> {
  initialState: AgentState = initialAgentState;
  maxPersistedMessages = 200;
  private starting?: Promise<ChatwootLink | undefined>;

  /** Only the server changes the state; the browser just reads it. */
  validateStateChange(_next: AgentState, source: Connection | "server") {
    if (source !== "server") throw new Error("read-only state");
  }

  private get chatwoot() {
    return chatwootEnabled(this.env) ? new ChatwootClient(this.env) : null;
  }

  private get hoursOpen() {
    return isOpen(this.env.BUSINESS_HOURS, this.env.TIMEZONE);
  }

  private async context() {
    return (await this.ctx.storage.get<ChatContext>("context")) ?? {};
  }

  /* ---------- chat turns ---------- */

  async onChatMessage(_onFinish: unknown, options?: OnChatMessageOptions) {
    const fresh = options?.body?.context as ChatContext | undefined;
    if (fresh && typeof fresh === "object") await this.ctx.storage.put("context", sanitizeContext(fresh));

    const last = this.messages[this.messages.length - 1];
    const visitorTurn = !options?.continuation && last?.role === "user";

    if (visitorTurn && textOf(last).length > MAX_MESSAGE_CHARS) {
      return cannedReply("Essa mensagem ficou muito longa para mim. Pode resumir em poucas linhas?");
    }
    if (visitorTurn && this.messages.filter((message) => message.role === "user").length > MAX_VISITOR_MESSAGES) {
      return cannedReply("Esta conversa chegou ao limite de mensagens. Para continuar, fale com a equipe em https://ingrave.com.br/contato ou comece uma nova conversa.");
    }

    // A person is handling the conversation: deliver the message to Chatwoot and stay quiet.
    if (visitorTurn && this.state.mode !== "ai") {
      await this.syncToChatwoot().catch((error) => console.error("chatwoot forward failed", error));
      return cannedReply("");
    }

    const context = await this.context();
    const { model, label } = chatModel(this.env, (error) => console.warn(`DGX Spark unavailable, using ${this.env.FALLBACK_MODEL}`, error));
    const tools = createTools({
      search: (query) => searchSite(this.env, query),
      bookingUrl: this.env.BOOKINGS_URL,
      shareContact: (input) => this.shareContact(input),
      handoff: (input) => this.handoff(input),
    });

    const gatewayLogs: string[] = [];
    const result = streamText({
      model,
      system: systemPrompt({
        now: new Date(),
        timeZone: this.env.TIMEZONE,
        hours: describeHours(this.env.BUSINESS_HOURS),
        open: this.hoursOpen,
        context,
        leadShared: this.state.leadShared,
      }),
      messages: pruneMessages({
        messages: await convertToModelMessages(forModel(this.messages)),
        toolCalls: "before-last-2-messages",
        reasoning: "before-last-message",
      }),
      tools,
      temperature: 0.3,
      maxOutputTokens: 900,
      // The handoff card already tells the visitor what happens next, so nothing the model writes after it is shown or mirrored.
      stopWhen: [stepCountIs(6), hasToolCall("transferir_para_humano")],
      experimental_transform: () => silenceAfterHandoff<typeof tools>(),
      abortSignal: options?.abortSignal,
      // AI Gateway: searchable log metadata (Logs and User Insights) and the log ids for 👍/👎.
      headers: { "cf-aig-metadata": gatewayMetadata(this.name, context) },
      onStepFinish: (step) => {
        const id = step.response?.headers?.["cf-aig-log-id"];
        if (id) gatewayLogs.push(id);
      },
    });

    return result.toUIMessageStreamResponse({
      messageMetadata: ({ part }) => {
        if (part.type === "start") return { createdAt: new Date().toISOString(), model: label };
        if (part.type === "finish" && gatewayLogs.length) return { gatewayLogs: gatewayLogs.slice(-6) };
        return undefined;
      },
    });
  }

  /** 👍/👎 on an assistant reply: recorded on its AI Gateway logs and, when negative, flagged in
      Chatwoot so the team can review the answer. */
  async feedback(messageId: string, value: 1 | -1) {
    const message = this.messages.find((item) => item.id === messageId && item.role === "assistant");
    if (!message) return { ok: false };
    const given = (await this.ctx.storage.get<Record<string, 1 | -1>>("feedback")) ?? {};
    if (given[messageId] === value) return { ok: true };
    given[messageId] = value;
    await this.ctx.storage.put("feedback", given);

    const logs = (message.metadata as MessageMeta | undefined)?.gatewayLogs ?? [];
    if (this.env.AI && logs.length) {
      const gateway = this.env.AI.gateway(this.env.AI_GATEWAY_ID);
      await Promise.all(
        logs.map((id) => gateway.patchLog(id, { feedback: value, metadata: { session: this.name } }).catch((error) => console.warn("gateway feedback failed", error)))
      );
    }

    const link = await this.ctx.storage.get<ChatwootLink>("chatwoot");
    const client = this.chatwoot;
    if (value === -1 && link && client) {
      const excerpt = textOf(message).slice(0, 600);
      await client.note(link.conversationId, `👎 O visitante não gostou desta resposta do assistente:\n\n${excerpt}`).catch(() => undefined);
      await client.addLabels(link.conversationId, ["ia-resposta-ruim"]).catch(() => undefined);
    }
    return { ok: true };
  }

  /** Mirrors finished AI turns to Chatwoot, so the team sees every conversation. */
  protected async onChatResponse(result: ChatResponseResult) {
    if (result.status !== "completed" || this.env.MIRROR_CONVERSATIONS !== "true") return;
    await this.syncToChatwoot().catch((error) => console.error("chatwoot mirror failed", error));
  }

  /* ---------- Chatwoot ---------- */

  /** Creates the Chatwoot contact and conversation once per visitor conversation. */
  private async ensureConversation(): Promise<ChatwootLink | undefined> {
    const client = this.chatwoot;
    if (!client) return undefined;
    const existing = await this.ctx.storage.get<ChatwootLink>("chatwoot");
    if (existing) return existing;
    this.starting ??= (async () => {
      const context = await this.context();
      const origin = describeOrigin(context);
      const attributes: Record<string, string> = { origem: "Site · assistente de IA", origem_campanha: origin };
      if (context.page) attributes.pagina_entrada = context.page;
      const note = [
        "🤖 Conversa com o assistente de IA do site",
        context.page ? `Página: https://ingrave.com.br${context.page}` : "",
        `Origem: ${origin}`,
        context.attribution?.last?.landing ? `Página de entrada: ${context.attribution.last.landing}` : "",
      ]
        .filter(Boolean)
        .join("\n");
      const link = await client.startConversation(this.name, { name: "Visitante do site", attributes }, note);
      await this.ctx.storage.put("chatwoot", link);
      return link;
    })().finally(() => {
      this.starting = undefined;
    });
    return this.starting;
  }

  /** Sends to Chatwoot the visitor and assistant text not delivered yet. Progress is kept per
      message as the number of characters sent, because a tool approval continues the same
      assistant message after it was first mirrored. */
  private async syncToChatwoot() {
    const client = this.chatwoot;
    if (!client || !this.messages.length) return;
    const link = await this.ensureConversation();
    if (!link) return;
    const synced = (await this.ctx.storage.get<Record<string, number>>("synced")) ?? {};
    const sent = (await this.ctx.storage.get<number[]>("sentIds")) ?? [];
    for (const message of this.messages) {
      const meta = message.metadata as MessageMeta | undefined;
      if (meta?.from) continue;
      const text = textOf(message);
      const done = synced[message.id] ?? 0;
      const fresh = text.slice(done).trim();
      if (!fresh) continue;
      const id = await client.message(link.conversationId, fresh, message.role === "user" ? "visitor" : "assistant");
      if (id) sent.push(id);
      synced[message.id] = text.length;
    }
    const ids = Object.keys(synced);
    for (const id of ids.slice(0, Math.max(0, ids.length - 400))) delete synced[id];
    await this.ctx.storage.put("synced", synced);
    await this.ctx.storage.put("sentIds", sent.slice(-400));
  }

  private async shareContact(input: ContactInput) {
    const client = this.chatwoot;
    if (!client) {
      return { ok: false, message: "Não consegui enviar seus dados agora. Você pode falar com a equipe em https://ingrave.com.br/contato." };
    }
    const link = await this.ensureConversation();
    if (!link) return { ok: false, message: "Não consegui enviar seus dados agora." };
    await this.syncToChatwoot();
    await client.updateContact(link.contactId, {
      name: input.nome,
      email: input.email.toLowerCase(),
      phone_number: normalizePhone(input.telefone),
      attributes: { empresa: input.empresa ?? "", interesse: input.interesse },
    }).catch(async (error) => {
      // E-mail or phone already used by another contact: keep the data in a note instead.
      console.warn("chatwoot contact update failed", error);
    });
    await client.note(link.conversationId, [
      "📇 Contato compartilhado pelo visitante",
      `Nome: ${input.nome}`,
      `E-mail: ${input.email}`,
      input.telefone ? `Telefone: ${input.telefone}` : "",
      input.empresa ? `Empresa: ${input.empresa}` : "",
      `Interesse: ${input.interesse}`,
    ].filter(Boolean).join("\n"));
    await client.addLabels(link.conversationId, ["lead-agente"]).catch(() => undefined);
    const context = await this.context();
    await notifyTeams(this.env.TEAMS_WEBHOOK_URL, {
      title: "Novo lead pelo assistente do site",
      facts: [["Nome", input.nome], ["E-mail", input.email], ["Telefone", input.telefone ?? ""], ["Empresa", input.empresa ?? ""], ["Origem", describeOrigin(context)]],
      text: input.interesse,
      url: client.conversationUrl(link.conversationId),
    }).catch((error) => console.warn("teams alert failed", error));
    this.setState({ ...this.state, leadShared: true });
    await this.scheduleFollowUp("lead");
    return { ok: true, message: "Dados enviados para a equipe comercial." };
  }

  private async handoff(input: HandoffInput) {
    const client = this.chatwoot;
    const outsideHours = !this.hoursOpen;
    if (!client) {
      return { ok: false, outsideHours, message: "A transferência não está disponível agora. A equipe atende em https://ingrave.com.br/contato e pelo e-mail contato@ingrave.com.br." };
    }
    const link = await this.ensureConversation();
    if (!link) return { ok: false, outsideHours, message: "Não consegui transferir agora." };
    await this.syncToChatwoot();
    await client.note(link.conversationId, `🤝 Transferência pedida pelo visitante (${input.motivo})\n\n${input.resumo}`);
    await client.addLabels(link.conversationId, ["transferido", input.motivo]).catch(() => undefined);
    await client.setStatus(link.conversationId, "open");
    await client.assignTeam(link.conversationId).catch((error) => console.warn("team assignment failed", error));
    const context = await this.context();
    await notifyTeams(this.env.TEAMS_WEBHOOK_URL, {
      title: `Visitante pediu atendimento humano (${input.motivo})`,
      facts: [["Origem", describeOrigin(context)], ["Página", context.page ?? ""], ["Horário", outsideHours ? "fora do expediente" : "em expediente"]],
      text: input.resumo,
      url: client.conversationUrl(link.conversationId),
    }).catch((error) => console.warn("teams alert failed", error));
    this.setState({ ...this.state, mode: "waiting", outsideHours });
    await this.scheduleFollowUp("handoff");
    return {
      ok: true,
      outsideHours,
      message: outsideHours
        ? `Conversa transferida. A equipe está fora do horário (${describeHours(this.env.BUSINESS_HOURS)}) e responde aqui assim que voltar${this.state.leadShared ? " ou pelo e-mail informado" : ""}.`
        : "Conversa transferida. Alguém da equipe vai responder aqui em instantes.",
    };
  }

  /* ---------- video (LiveAvatar) ---------- */

  /** At most 3 video sessions per conversation, one at a time. */
  async videoAllowed() {
    const count = (await this.ctx.storage.get<number>("videoCount")) ?? 0;
    return count < 3 && !(await this.ctx.storage.get<string>("videoSession"));
  }

  async videoStarted(sessionId: string) {
    await this.ctx.storage.put("videoCount", ((await this.ctx.storage.get<number>("videoCount")) ?? 0) + 1);
    await this.ctx.storage.put("videoSession", sessionId);
  }

  /** Forgets the running video session and returns its id so the Worker can stop it. */
  async videoEnded() {
    const id = await this.ctx.storage.get<string>("videoSession");
    await this.ctx.storage.delete("videoSession");
    return id;
  }

  /* ---------- follow-up ---------- */

  /** Checks back after FOLLOW_UP_MINUTES of business time whether the team answered the lead. */
  private async scheduleFollowUp(kind: FollowUp["kind"]) {
    const minutes = Number(this.env.FOLLOW_UP_MINUTES);
    if (!minutes || !this.chatwoot) return;
    const now = new Date();
    const due = afterBusinessMinutes(this.env.BUSINESS_HOURS, this.env.TIMEZONE, now, minutes);
    await this.schedule(due, "followUp", { kind, since: now.toISOString() } satisfies FollowUp).catch((error) => console.warn("follow-up not scheduled", error));
  }

  /** Scheduled: flags the Chatwoot conversation and alerts Teams if nobody from the team replied. */
  async followUp(payload: FollowUp) {
    const client = this.chatwoot;
    const link = await this.ctx.storage.get<ChatwootLink>("chatwoot");
    if (!client || !link) return;
    const replied = await this.ctx.storage.get<string>("teamRepliedAt");
    if (replied && replied >= payload.since) return;
    // One alert per unanswered stretch, even if both a lead and a handoff were scheduled.
    const alerted = await this.ctx.storage.get<string>("followUpAt");
    if (alerted && (!replied || alerted > replied)) return;
    const conversation = await client.getConversation(link.conversationId).catch(() => undefined);
    if (conversation?.status === "resolved") return;
    const what = payload.kind === "lead" ? "Lead do assistente" : "Pedido de atendimento humano";
    const waited = Math.round((Date.now() - Date.parse(payload.since)) / 3_600_000);
    await client.note(link.conversationId, `⏰ ${what} ainda sem resposta da equipe (${waited} h desde o pedido).`).catch(() => undefined);
    await this.ctx.storage.put("followUpAt", new Date().toISOString());
    await client.addLabels(link.conversationId, ["sem-resposta"]).catch(() => undefined);
    await client.setStatus(link.conversationId, "open").catch(() => undefined);
    const context = await this.context();
    await notifyTeams(this.env.TEAMS_WEBHOOK_URL, {
      title: `${what} sem resposta`,
      facts: [["Origem", describeOrigin(context)], ["Página", context.page ?? ""], ["Esperando", `${waited} h`]],
      text: "Ninguém da equipe respondeu esta conversa do site ainda.",
      url: client.conversationUrl(link.conversationId),
    }).catch((error) => console.warn("teams alert failed", error));
  }

  /** Called by the Worker for each inbox webhook that belongs to this conversation. */
  async onChatwootEvent(event: WebhookEvent) {
    if (isTeamReply(event)) {
      const sent = (await this.ctx.storage.get<number[]>("sentIds")) ?? [];
      if (event.id && sent.includes(event.id)) return;
      const id = `cw-${event.id ?? generateId()}`;
      if (this.messages.some((message) => message.id === id)) return;
      const files = (event.attachments ?? []).map((file) => file.data_url).filter(Boolean);
      const text = [event.content?.trim(), ...files].filter(Boolean).join("\n\n");
      const author = event.sender?.name?.trim() || "Equipe Ingrave";
      const avatarUrl = event.sender?.thumbnail || event.sender?.avatar_url || undefined;
      const meta: MessageMeta = { from: "human", author, avatarUrl, createdAt: new Date().toISOString() };
      await this.persistMessages([...this.messages, { id, role: "assistant", parts: [{ type: "text", text }], metadata: meta }]);
      await this.ctx.storage.put("teamRepliedAt", new Date().toISOString());
      this.setState({ ...this.state, mode: "human", agent: { name: author, avatarUrl } });
      this.broadcastEvent({ type: "typing", on: false });
      return;
    }

    if (event.event === "conversation_status_changed") {
      const status = event.status ?? event.conversation?.status;
      if ((status === "resolved" || status === "pending") && this.state.mode !== "ai") {
        const id = `system-${generateId()}`;
        const meta: MessageMeta = { from: "system", createdAt: new Date().toISOString() };
        const text = status === "resolved" ? "Atendimento encerrado pela equipe. Se precisar de algo mais, é só escrever." : "O assistente voltou a responder.";
        await this.persistMessages([...this.messages, { id, role: "assistant", parts: [{ type: "text", text }], metadata: meta }]);
        this.setState({ ...this.state, mode: "ai", agent: undefined });
      }
      return;
    }

    if (event.event === "conversation_typing_on" || event.event === "conversation_typing_off") {
      if ((event as { is_private?: boolean }).is_private) return;
      this.broadcastEvent({ type: "typing", on: event.event === "conversation_typing_on", name: event.user?.name });
    }
  }

  private broadcastEvent(event: { type: "typing"; on: boolean; name?: string }) {
    this.broadcast(JSON.stringify({ ...event, source: "ingrave-agent" }));
  }
}

/** Keeps only the fields we use, with bounded lengths (the context comes from the browser). */
function sanitizeContext(context: ChatContext): ChatContext {
  const short = (value: unknown, max = 200) => (typeof value === "string" ? value.slice(0, max) : undefined);
  const touch = (value: unknown) => {
    if (!value || typeof value !== "object") return null;
    const out: Record<string, string> = {};
    for (const [key, item] of Object.entries(value as Record<string, unknown>).slice(0, 20)) {
      if (/^[a-z_]{2,20}$/.test(key) && typeof item === "string") out[key] = item.slice(0, 150);
    }
    return out;
  };
  return {
    page: short(context.page, 300)?.startsWith("/") ? short(context.page, 300) : undefined,
    title: short(context.title),
    attribution: { first: touch(context.attribution?.first), last: touch(context.attribution?.last) },
  };
}

/** Chatwoot expects E.164; Brazilian numbers without country code get +55. */
function normalizePhone(raw?: string) {
  const digits = (raw ?? "").replace(/\D/g, "");
  if (digits.length < 10) return undefined;
  return `+${digits.length <= 11 ? `55${digits}` : digits}`;
}
