/* Worker entry: serves the chat UI and widget.js (static assets), the agent WebSocket under
   /agents/ingrave-agent/{conversation-id}, and the Chatwoot inbox webhook. */
import { getAgentByName, routeAgentRequest } from "agents";
import { conversationIdOf, ChatwootClient, chatwootEnabled, safeEqual, sessionOf, type WebhookEvent } from "./chatwoot";
import { IngraveAgent } from "./agent";
import { dgxModel } from "./model";

export { IngraveAgent };

/** Conversation ids are random UUIDs created in the browser: unguessable, one per visitor chat. */
const AGENT_PATH = /^\/agents\/ingrave-agent\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})(\/.*)?$/;

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" } });

/** The chat runs inside an iframe served by this Worker, so its requests come from our own origin. */
function originAllowed(request: Request, env: Env) {
  const origin = request.headers.get("Origin");
  if (!origin) return true; // server-to-server calls (e.g. getInitialMessages during SSR) have none
  const self = new URL(request.url).origin;
  const allowed = new Set([self, ...env.SITE_ORIGINS.split(",").map((item) => item.trim()).filter(Boolean)]);
  return allowed.has(origin) || /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin);
}

async function handleWebhook(request: Request, env: Env) {
  const secret = new URL(request.url).searchParams.get("secret") ?? "";
  if (!env.CHATWOOT_WEBHOOK_SECRET || !safeEqual(secret, env.CHATWOOT_WEBHOOK_SECRET)) return json(401, { ok: false });
  let event: WebhookEvent;
  try {
    event = (await request.json()) as WebhookEvent;
  } catch {
    return json(400, { ok: false });
  }
  let session = sessionOf(event);
  const conversationId = conversationIdOf(event);
  // Some payloads do not carry custom attributes: look the conversation up.
  if (!session && conversationId && chatwootEnabled(env)) {
    const conversation = await new ChatwootClient(env).getConversation(conversationId).catch(() => undefined);
    session = sessionOf({ custom_attributes: conversation?.custom_attributes ?? null });
  }
  if (!session) return json(200, { ok: true, ignored: "not an assistant conversation" });
  const agent = await getAgentByName(env.IngraveAgent, session);
  await agent.onChatwootEvent(event);
  return json(200, { ok: true });
}

export default {
  async fetch(request: Request, env: Env) {
    const url = new URL(request.url);

    if (url.pathname === "/health") {
      const model = dgxModel(env) ? `dgx-spark/${env.DGX_MODEL} (reserva: ${env.FALLBACK_MODEL})` : `workers-ai/${env.FALLBACK_MODEL}`;
      return json(200, { ok: true, model, chatwoot: chatwootEnabled(env) });
    }

    if (url.pathname === "/chatwoot/webhook" && request.method === "POST") return handleWebhook(request, env);

    if (url.pathname.startsWith("/agents/")) {
      if (!AGENT_PATH.test(url.pathname)) return json(404, { ok: false });
      if (!originAllowed(request, env)) return json(403, { ok: false });
      const ip = request.headers.get("CF-Connecting-IP") ?? "local";
      const { success } = await env.RATE_LIMITER.limit({ key: ip });
      if (!success) return json(429, { ok: false, error: "too_many_requests" });
      return (await routeAgentRequest(request, env)) ?? json(404, { ok: false });
    }

    return json(404, { ok: false });
  },
} satisfies ExportedHandler<Env>;
