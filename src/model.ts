/* The language model behind the assistant.

   Primary: the DGX Spark (Ollama, OpenAI-compatible API) registered in Cloudflare AI Gateway as a
   custom provider, so every call gets the gateway's logs, analytics, caching and rate limits:
     https://gateway.ai.cloudflare.com/v1/{account}/{gateway}/custom-{slug}/v1/chat/completions
   Fallback: a Workers AI model through the same gateway, used when the DGX is not configured,
   does not answer within DGX_TIMEOUT_MS or returns an error before streaming starts. */
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import type { LanguageModelV3, LanguageModelV3CallOptions } from "@ai-sdk/provider";
import { createWorkersAI } from "workers-ai-provider";

type ModelEnv = Pick<
  Env,
  "AI" | "AI_GATEWAY_ACCOUNT_ID" | "AI_GATEWAY_ID" | "DGX_PROVIDER_SLUG" | "DGX_MODEL" | "DGX_TIMEOUT_MS" | "FALLBACK_MODEL" | "AI_GATEWAY_TOKEN" | "DGX_API_KEY"
> & { DGX_BASE_URL?: string };

/** DGX_BASE_URL (".../v1") bypasses the gateway; meant for local development only. */
export const gatewayBaseUrl = (env: ModelEnv) =>
  env.DGX_BASE_URL || `https://gateway.ai.cloudflare.com/v1/${env.AI_GATEWAY_ACCOUNT_ID}/${env.AI_GATEWAY_ID}/custom-${env.DGX_PROVIDER_SLUG}/v1`;

export function dgxModel(env: ModelEnv): LanguageModelV3 | null {
  if (!env.DGX_MODEL) return null;
  if (!env.DGX_BASE_URL && (!env.AI_GATEWAY_ACCOUNT_ID || !env.AI_GATEWAY_ID || !env.DGX_PROVIDER_SLUG)) return null;
  const headers: Record<string, string> = {};
  // Authenticated gateway: https://developers.cloudflare.com/ai-gateway/configuration/authentication/
  if (env.AI_GATEWAY_TOKEN) headers["cf-aig-authorization"] = `Bearer ${env.AI_GATEWAY_TOKEN}`;
  const provider = createOpenAICompatible({
    name: "dgx-spark",
    baseURL: gatewayBaseUrl(env),
    // Only needed when the upstream checks a key and it is not stored in the gateway (BYOK).
    apiKey: env.DGX_API_KEY || undefined,
    headers,
    includeUsage: true,
  });
  return provider.chatModel(env.DGX_MODEL);
}

export function fallbackModel(env: ModelEnv): LanguageModelV3 {
  if (!env.AI) throw new Error("Workers AI binding missing (offline development?)");
  const workersai = createWorkersAI({ binding: env.AI, gateway: env.AI_GATEWAY_ID ? { id: env.AI_GATEWAY_ID } : undefined });
  return workersai(env.FALLBACK_MODEL as Parameters<typeof workersai>[0]) as unknown as LanguageModelV3;
}

/** Runs `primary` and switches to `fallback` if it fails or is too slow before the first byte. */
export function withFallback(
  primary: LanguageModelV3,
  fallback: LanguageModelV3,
  { timeoutMs = 30000, onFallback }: { timeoutMs?: number; onFallback?: (error: unknown) => void } = {}
): LanguageModelV3 {
  const guarded = async <T>(call: (options: LanguageModelV3CallOptions) => PromiseLike<T>, options: LanguageModelV3CallOptions) => {
    const controller = new AbortController();
    const onAbort = () => controller.abort(options.abortSignal?.reason);
    options.abortSignal?.addEventListener("abort", onAbort, { once: true });
    const timer = setTimeout(() => controller.abort(new Error(`primary model timed out after ${timeoutMs} ms`)), timeoutMs);
    try {
      // The timer only covers the wait for the response; once streaming starts it is cleared.
      return await call({ ...options, abortSignal: controller.signal });
    } finally {
      clearTimeout(timer);
    }
  };
  const run = async <T>(call: (model: LanguageModelV3, options: LanguageModelV3CallOptions) => PromiseLike<T>, options: LanguageModelV3CallOptions): Promise<T> => {
    try {
      return await guarded((o) => call(primary, o), options);
    } catch (error) {
      if (options.abortSignal?.aborted) throw error;
      onFallback?.(error);
      return await call(fallback, options);
    }
  };
  return {
    specificationVersion: "v3",
    provider: primary.provider,
    modelId: primary.modelId,
    supportedUrls: primary.supportedUrls,
    doGenerate: (options) => run((model, o) => model.doGenerate(o), options),
    doStream: (options) => run((model, o) => model.doStream(o), options),
  };
}

export function chatModel(env: ModelEnv, onFallback?: (error: unknown) => void): { model: LanguageModelV3; label: string } {
  const primary = dgxModel(env);
  if (!primary) return { model: fallbackModel(env), label: `workers-ai/${env.FALLBACK_MODEL}` };
  // Without the Workers AI binding (offline development) the DGX is used alone.
  const fallback = env.AI ? fallbackModel(env) : primary;
  return {
    model: withFallback(primary, fallback, { timeoutMs: Number(env.DGX_TIMEOUT_MS) || 30000, onFallback }),
    label: `dgx-spark/${env.DGX_MODEL}`,
  };
}
