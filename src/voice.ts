/* ElevenLabs text-to-speech for the "Ouvir" button under each assistant reply.
   Calls the ElevenLabs API directly (the free tier rejects requests that come through proxies or
   gateways), caches each generated audio at the edge, and only speaks short plain text. */

type VoiceEnv = Pick<Env, "ELEVENLABS_VOICE_ID" | "ELEVENLABS_MODEL_ID" | "ELEVENLABS_API_KEY">;

export const MAX_SPEECH_CHARS = 1500;

export const voiceEnabled = (env: VoiceEnv) => Boolean(env.ELEVENLABS_API_KEY);

/** Turns a markdown reply into something pleasant to listen to: no symbols, URLs read as page names. */
export function speechText(markdown: string) {
  return markdown
    .replace(/\[([^\]]+)\]\((?:https?:\/\/|mailto:)[^)]+\)/g, "$1")
    .replace(/https?:\/\/(?:www\.)?([^\s/]+)[^\s]*/g, "$1")
    .replace(/[*_`#>]+/g, "")
    .replace(/^\s*[-•]\s+/gm, "")
    .replace(/R\$\s?/g, "R$ ")
    .replace(/\n{2,}/g, "\n")
    .trim()
    .slice(0, MAX_SPEECH_CHARS);
}

async function cacheKey(text: string, voice: string, model: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`${voice}|${model}|${text}`));
  const hex = [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  return new Request(`https://tts.ingrave.cache/${hex}.mp3`);
}

/** MP3 for the text, from the edge cache when the same reply was already spoken. */
export async function synthesize(env: VoiceEnv, text: string, ctx?: ExecutionContext): Promise<Response> {
  const voice = env.ELEVENLABS_VOICE_ID;
  const model = env.ELEVENLABS_MODEL_ID;
  const key = await cacheKey(text, voice, model);
  // Workers runtime cache (the DOM typings loaded for the UI do not know `caches.default`).
  const cache = (caches as unknown as { default: Cache }).default;
  const hit = await cache.match(key);
  if (hit) return hit;

  const upstream = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(voice)}?output_format=mp3_44100_128`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "xi-api-key": env.ELEVENLABS_API_KEY ?? "" },
    body: JSON.stringify({ text, model_id: model }),
  });
  if (!upstream.ok) throw new Error(`elevenlabs → ${upstream.status} ${(await upstream.text()).slice(0, 200)}`);

  const response = new Response(await upstream.arrayBuffer(), {
    headers: { "Content-Type": upstream.headers.get("Content-Type") ?? "audio/mpeg", "Cache-Control": "public, max-age=604800" },
  });
  const put = cache.put(key, response.clone());
  if (ctx) ctx.waitUntil(put);
  else await put;
  return response;
}
