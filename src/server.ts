/* Worker entry: serves the chat UI and widget.js (static assets), the agent WebSocket under
   /agents/ingrave-agent/{conversation-id}, and the Chatwoot inbox webhook. */
import { getAgentByName, routeAgentRequest } from "agents";
import { conversationIdOf, ChatwootClient, chatwootEnabled, safeEqual, sessionOf, type WebhookEvent } from "./chatwoot";
import { IngraveAgent } from "./agent";
import { dgxModel } from "./model";
import { MAX_AUDIO_BYTES, transcribe } from "./transcribe";
import { MAX_SPEECH_CHARS, speechText, synthesize, voiceEnabled } from "./voice";
import { startVideo, stopVideo, videoEnabled } from "./video";

export { IngraveAgent };

/** Conversation ids are random UUIDs created in the browser: unguessable, one per visitor chat. */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
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

/** POST /voice {text, session}: speaks an assistant reply (ElevenLabs). */
async function handleVoice(request: Request, env: Env, ctx: ExecutionContext) {
  if (!voiceEnabled(env)) return json(404, { ok: false, error: "voice_disabled" });
  if (!originAllowed(request, env)) return json(403, { ok: false });
  let body: { text?: unknown; session?: unknown; format?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return json(400, { ok: false });
  }
  if (typeof body.session !== "string" || !UUID.test(body.session)) return json(400, { ok: false });
  const text = typeof body.text === "string" ? speechText(body.text) : "";
  if (!text || text.length > MAX_SPEECH_CHARS) return json(422, { ok: false });
  const { success } = await env.RATE_LIMITER.limit({ key: `voice:${request.headers.get("CF-Connecting-IP") ?? body.session}` });
  if (!success) return json(429, { ok: false, error: "too_many_requests" });
  try {
    return await synthesize(env, text, ctx, body.format === "pcm" ? "pcm" : "mp3");
  } catch (error) {
    console.error("voice failed", error);
    return json(502, { ok: false, error: "voice_unavailable" });
  }
}

/** POST /transcribe (audio body, X-Session header): turns the visitor's recording into text. */
async function handleTranscribe(request: Request, env: Env) {
  if (!originAllowed(request, env)) return json(403, { ok: false });
  const session = request.headers.get("X-Session") ?? "";
  if (!UUID.test(session)) return json(400, { ok: false });
  if (!(request.headers.get("Content-Type") ?? "").startsWith("audio/")) return json(415, { ok: false });
  const declared = Number(request.headers.get("Content-Length") ?? 0);
  if (declared > MAX_AUDIO_BYTES) return json(413, { ok: false, error: "audio_too_long" });
  const { success } = await env.RATE_LIMITER.limit({ key: `stt:${request.headers.get("CF-Connecting-IP") ?? session}` });
  if (!success) return json(429, { ok: false, error: "too_many_requests" });
  const audio = await request.arrayBuffer();
  if (!audio.byteLength) return json(422, { ok: false });
  if (audio.byteLength > MAX_AUDIO_BYTES) return json(413, { ok: false, error: "audio_too_long" });
  try {
    return json(200, { ok: true, text: await transcribe(env, audio) });
  } catch (error) {
    console.error("transcription failed", error);
    return json(502, { ok: false, error: "transcription_unavailable" });
  }
}

/** POST /video/start {session} and /video/stop {session}: Íris on video (HeyGen LiveAvatar). */
async function handleVideo(request: Request, env: Env, action: "start" | "stop") {
  if (!videoEnabled(env)) return json(404, { ok: false, error: "video_disabled" });
  if (!originAllowed(request, env)) return json(403, { ok: false });
  let body: { session?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return json(400, { ok: false });
  }
  if (typeof body.session !== "string" || !UUID.test(body.session)) return json(400, { ok: false });
  const agent = await getAgentByName(env.IngraveAgent, body.session);
  if (action === "stop") {
    const id = await agent.videoEnded();
    if (id) await stopVideo(env, id);
    return json(200, { ok: true });
  }
  const { success } = await env.VIDEO_LIMITER.limit({ key: request.headers.get("CF-Connecting-IP") ?? body.session });
  if (!success) return json(429, { ok: false, error: "too_many_requests" });
  if (!(await agent.videoAllowed())) return json(429, { ok: false, error: "video_limit" });
  try {
    const video = await startVideo(env);
    await agent.videoStarted(video.sessionId);
    return json(200, { ok: true, ...video });
  } catch (error) {
    console.error("video start failed", error);
    // The upstream status and message (never the key) help to fix the setup: wrong avatar id, no credits...
    const detail = error instanceof Error ? error.message.slice(0, 200) : undefined;
    return json(502, { ok: false, error: "video_unavailable", detail });
  }
}

/** POST /feedback {session, message, value: 1 | -1}: 👍/👎 on an assistant reply. */
async function handleFeedback(request: Request, env: Env) {
  if (!originAllowed(request, env)) return json(403, { ok: false });
  let body: { session?: unknown; message?: unknown; value?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return json(400, { ok: false });
  }
  if (typeof body.session !== "string" || !UUID.test(body.session)) return json(400, { ok: false });
  if (typeof body.message !== "string" || !/^[\w-]{1,80}$/.test(body.message) || (body.value !== 1 && body.value !== -1)) return json(400, { ok: false });
  const { success } = await env.RATE_LIMITER.limit({ key: `feedback:${request.headers.get("CF-Connecting-IP") ?? body.session}` });
  if (!success) return json(429, { ok: false, error: "too_many_requests" });
  const agent = await getAgentByName(env.IngraveAgent, body.session);
  const result = await agent.feedback(body.message, body.value);
  return json(result.ok ? 200 : 404, result);
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
  async fetch(request: Request, env: Env, ctx: ExecutionContext) {
    const url = new URL(request.url);

    if (url.pathname === "/health") {
      const model = dgxModel(env) ? `dgx-spark/${env.DGX_MODEL} (reserva: ${env.FALLBACK_MODEL})` : `workers-ai/${env.FALLBACK_MODEL}`;
      const search = env.AI_SEARCH && env.AI_SEARCH_INSTANCE ? `ai-search/${env.AI_SEARCH_INSTANCE} (reserva: local)` : "local";
      return json(200, { ok: true, model, search, chatwoot: chatwootEnabled(env), voice: voiceEnabled(env), video: videoEnabled(env) && voiceEnabled(env) });
    }

    if (url.pathname === "/voice" && request.method === "POST") return handleVoice(request, env, ctx);
    if (url.pathname === "/transcribe" && request.method === "POST") return handleTranscribe(request, env);

    if (url.pathname === "/video/start" && request.method === "POST") return handleVideo(request, env, "start");
    if (url.pathname === "/video/stop" && request.method === "POST") return handleVideo(request, env, "stop");
    if (url.pathname === "/feedback" && request.method === "POST") return handleFeedback(request, env);

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
