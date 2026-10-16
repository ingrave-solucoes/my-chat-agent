/* Writes wrangler.local.jsonc: the same Worker without remote bindings, so `vite dev` runs
   offline (no Cloudflare login). Workers AI is then unavailable locally; point DGX_BASE_URL in
   .dev.vars at any OpenAI-compatible server (Ollama, a mock) to chat.
   Usage: node scripts/local-config.mjs && WRANGLER_CONFIG=wrangler.local.jsonc npx vite dev */
import { readFileSync, writeFileSync } from "node:fs";

const source = readFileSync(new URL("../wrangler.jsonc", import.meta.url), "utf8")
  .replace(/^\s*\/\/.*$/gm, "")
  .replace(/,(\s*[}\]])/g, "$1");
const config = JSON.parse(source);
delete config.ai; // Workers AI only exists remotely.
writeFileSync(new URL("../wrangler.local.jsonc", import.meta.url), JSON.stringify(config, null, 2) + "\n");
console.log("wrangler.local.jsonc written");
