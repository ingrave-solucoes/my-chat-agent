/* Speech-to-text for the microphone button: Workers AI Whisper (large-v3-turbo) through the same
   AI Gateway, in Portuguese, with the product vocabulary as a hint. */

type TranscribeEnv = Pick<Env, "AI" | "AI_GATEWAY_ID">;

/** About one minute of compressed speech (webm/opus or mp4/aac from the browser recorder). */
export const MAX_AUDIO_BYTES = 2_000_000;

const VOCABULARY = "Ingrave, WhatsApp, Instagram, Chatwoot, Captain, multiatendimento, omnichannel, chatbot, API oficial, Meta.";

const toBase64 = (bytes: Uint8Array) => {
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
};

export async function transcribe(env: TranscribeEnv, audio: ArrayBuffer): Promise<string> {
  const result = (await env.AI.run(
    "@cf/openai/whisper-large-v3-turbo",
    { audio: toBase64(new Uint8Array(audio)), task: "transcribe", language: "pt", vad_filter: true, initial_prompt: VOCABULARY },
    env.AI_GATEWAY_ID ? { gateway: { id: env.AI_GATEWAY_ID } } : undefined
  )) as { text?: string };
  return (result.text ?? "").replace(/\s+/g, " ").trim().slice(0, 2000);
}
