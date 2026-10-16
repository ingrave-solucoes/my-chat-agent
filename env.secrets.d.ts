/* Secrets are not in wrangler.jsonc, so `wrangler types` does not see them (merged into the generated Env). */
interface __BaseEnv_Env {
  AI_GATEWAY_TOKEN?: string;
  DGX_API_KEY?: string;
  CHATWOOT_API_TOKEN?: string;
  CHATWOOT_WEBHOOK_SECRET?: string;
  TEAMS_WEBHOOK_URL?: string;
  ELEVENLABS_API_KEY?: string;
  /** Local development only: direct OpenAI-compatible base URL instead of AI Gateway. */
  DGX_BASE_URL?: string;
}
