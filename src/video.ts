/* Íris on video: HeyGen LiveAvatar in LITE (avatar only) mode. LiveAvatar renders the face and
   streams it to the browser over LiveKit; everything else stays ours: the agent answers, ElevenLabs
   speaks (PCM 16-bit 24 kHz) and the browser forwards that audio to the avatar's WebSocket, which
   lip-syncs it. The API key never leaves the Worker; the browser gets only this session's tokens.
   https://docs.liveavatar.com/docs/lite-mode/overview */

type VideoEnv = Pick<Env, "LIVEAVATAR_AVATAR_ID" | "LIVEAVATAR_SANDBOX" | "VIDEO_MAX_SECONDS"> & { LIVEAVATAR_API_KEY?: string };

const API = "https://api.liveavatar.com/v1";
/** The only avatar sandbox sessions accept (sessions last about a minute and cost no credits). */
const SANDBOX_AVATAR = "dd73ea75-1218-4ef3-92ce-606d5f7fbc0a";

export const videoEnabled = (env: VideoEnv) => Boolean(env.LIVEAVATAR_API_KEY && (env.LIVEAVATAR_AVATAR_ID || env.LIVEAVATAR_SANDBOX === "true"));

export type VideoSession = {
  sessionId: string;
  livekitUrl: string;
  livekitToken: string;
  wsUrl: string;
  maxSeconds: number;
};

type Envelope<T> = { code?: number; data?: T | null; message?: string };

async function call<T>(path: string, init: RequestInit): Promise<T> {
  const response = await fetch(`${API}${path}`, init);
  const body = (await response.json().catch(() => ({}))) as Envelope<T>;
  if (!response.ok || !body.data) throw new Error(`liveavatar ${path} → ${response.status} ${body.message ?? ""}`.trim());
  return body.data;
}

/** Creates and starts a LITE session; returns what the browser needs to watch and drive it. */
export async function startVideo(env: VideoEnv): Promise<VideoSession> {
  const sandbox = env.LIVEAVATAR_SANDBOX === "true";
  const maxSeconds = Math.min(Math.max(Number(env.VIDEO_MAX_SECONDS) || 300, 60), 1200);
  const token = await call<{ session_id: string; session_token: string }>("/sessions/token", {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-API-KEY": (env.LIVEAVATAR_API_KEY ?? "").trim() },
    body: JSON.stringify({
      mode: "LITE",
      avatar_id: sandbox ? SANDBOX_AVATAR : env.LIVEAVATAR_AVATAR_ID,
      is_sandbox: sandbox,
      max_session_duration: maxSeconds,
      video_settings: { quality: "high", encoding: "H264" },
    }),
  });
  const started = await call<{ session_id: string; livekit_url: string; livekit_client_token: string; ws_url?: string; max_session_duration?: number }>(
    "/sessions/start",
    { method: "POST", headers: { Authorization: `Bearer ${token.session_token}` } }
  );
  if (!started.ws_url) throw new Error("liveavatar did not return a ws_url (is the session in LITE mode?)");
  return {
    sessionId: started.session_id,
    livekitUrl: started.livekit_url,
    livekitToken: started.livekit_client_token,
    wsUrl: started.ws_url,
    maxSeconds: started.max_session_duration ?? maxSeconds,
  };
}

export async function stopVideo(env: VideoEnv, sessionId: string) {
  const response = await fetch(`${API}/sessions/stop`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-API-KEY": (env.LIVEAVATAR_API_KEY ?? "").trim() },
    body: JSON.stringify({ session_id: sessionId, reason: "USER_CLOSED" }),
  });
  // A session that already ended (time limit, tab closed) answers with an error: nothing left to stop.
  if (!response.ok) console.warn(`liveavatar stop → ${response.status}`);
}
