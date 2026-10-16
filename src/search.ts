/* Site search for the buscar_conhecimento tool. Cloudflare AI Search (hybrid vector + keyword
   retrieval with reranking over the crawled ingrave.com.br) answers first; the local BM25 index
   built from the site repository answers when AI Search is not configured, fails, is slow or
   finds nothing relevant. */
import { searchKnowledge } from "./knowledge";
import site from "./knowledge/site.json";

export type SiteResult = { titulo: string; url: string; trecho: string };
export type SiteSearch = { fonte: "ai-search" | "local"; resultados: SiteResult[] };

type SearchEnv = Pick<Env, "AI_SEARCH" | "AI_SEARCH_INSTANCE"> & Partial<Pick<Env, "AI_GATEWAY_ID">>;

const TIMEOUT_MS = 5000;
const MIN_SCORE = 0.3;
const MAX_TEXT = 900;

const titles = new Map((site.docs as { url: string; title: string }[]).map((doc) => [doc.url.replace(/\/$/, ""), doc.title]));

/** Website sources index items by URL; keep only pages of the site and normalise them. */
export function pageUrl(key: string): string | null {
  const raw = /^https?:\/\//.test(key) ? key : `https://${key.replace(/^\/+/, "")}`;
  try {
    const url = new URL(raw);
    if (!/(^|\.)ingrave\.com\.br$/.test(url.hostname)) return null;
    url.hash = "";
    url.search = "";
    return url.toString().replace(/\/$/, "").replace(/\.html?$/, "");
  } catch {
    return null;
  }
}

function titleOf(url: string, metadata?: Record<string, unknown>) {
  const meta = typeof metadata?.title === "string" ? metadata.title : "";
  return titles.get(url) ?? (meta || new URL(url).pathname.replace(/[-/]+/g, " ").trim() || "Ingrave");
}

/** Turns AI Search chunks into results: relevant ones only, at most two per page. */
export function fromChunks(chunks: AiSearchSearchResponse["chunks"], limit: number): SiteResult[] {
  const perPage = new Map<string, number>();
  const results: SiteResult[] = [];
  for (const chunk of [...chunks].sort((a, b) => b.score - a.score)) {
    if (chunk.score < MIN_SCORE || !chunk.text?.trim()) continue;
    const url = pageUrl(chunk.item.key);
    if (!url) continue;
    const count = perPage.get(url) ?? 0;
    if (count >= 2) continue;
    perPage.set(url, count + 1);
    const text = chunk.text.replace(/\s+/g, " ").trim();
    results.push({ titulo: titleOf(url, chunk.item.metadata), url, trecho: text.length > MAX_TEXT ? `${text.slice(0, MAX_TEXT)}…` : text });
    if (results.length >= limit) break;
  }
  return results;
}

const local = (query: string, limit: number): SiteSearch => ({
  fonte: "local",
  resultados: searchKnowledge(query, limit).map(({ title, url, text }) => ({ titulo: title, url, trecho: text })),
});

export async function searchSite(env: SearchEnv, query: string, limit = 4): Promise<SiteSearch> {
  if (!env.AI_SEARCH || !env.AI_SEARCH_INSTANCE) return local(query, limit);
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const search = env.AI_SEARCH.get(env.AI_SEARCH_INSTANCE).search({
      query,
      ai_search_options: {
        retrieval: { max_num_results: limit * 3, match_threshold: MIN_SCORE, keyword_match_mode: "or" },
        reranking: { enabled: true, match_threshold: MIN_SCORE },
      },
    });
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error(`AI Search timed out after ${TIMEOUT_MS} ms`)), TIMEOUT_MS);
    });
    const response = await Promise.race([search, timeout]);
    const resultados = fromChunks(response.chunks ?? [], limit);
    if (resultados.length) return { fonte: "ai-search", resultados };
  } catch (error) {
    console.warn("AI Search unavailable, using the local index", error);
  } finally {
    clearTimeout(timer);
  }
  return local(query, limit);
}
