/* Knowledge base built from the Ingrave website (scripts/sync-knowledge.mjs) and a small
   keyword search over it. Documents are split into passages and ranked with BM25, after
   folding accents and dropping Portuguese stop words. */
import site from "./site.json";

export type Plan = { id: string; name: string; description: string; monthly: number; annual: number; highlights: string[] };
export type Passage = { id: string; title: string; url: string; text: string };

export const plans = site.plans as Plan[];
export const captainAddon = site.captainAddon as { price: number; credits: number };
export const whatsappRates = site.whatsappRates as {
  checkedAt: string;
  brl: { marketing: number; utility: number; authentication: number };
  source: string;
};
export const syncedAt = site.syncedAt as string;

const STOP = new Set(
  "a o as os um uma uns umas de do da dos das em no na nos nas por pelo pela para pra com sem e ou que se sua seu suas seus meu minha eu voce voces ele ela nos isso essa esse esta este ao aos como mais mas ja nao sim tem ter ha qual quais quanto quando onde sobre entre ate tambem muito bem ser sao foi era the and of to".split(" ")
);

export const normalize = (text: string) =>
  text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9$%]+/g, " ");

const tokens = (text: string) =>
  normalize(text)
    .split(" ")
    .filter((word) => word.length > 1 && !STOP.has(word))
    // Light stemming so "planos"/"plano" and "integracoes"/"integracao" meet.
    .map((word) => (word.length > 4 ? word.replace(/(oes|aes|ais|eis|s)$/, "") : word));

/** Splits documents into passages of about `size` characters, on line boundaries. */
function toPassages(size = 900): Passage[] {
  const out: Passage[] = [];
  for (const doc of site.docs as Passage[]) {
    let chunk = "";
    let part = 0;
    for (const line of doc.text.split("\n")) {
      if (chunk && chunk.length + line.length > size) {
        out.push({ id: `${doc.id}#${part++}`, title: doc.title, url: doc.url, text: chunk.trim() });
        chunk = "";
      }
      chunk += `${line}\n`;
    }
    if (chunk.trim()) out.push({ id: `${doc.id}#${part}`, title: doc.title, url: doc.url, text: chunk.trim() });
  }
  return out;
}

const passages = toPassages();
const index = passages.map((passage) => {
  const terms = tokens(`${passage.title} ${passage.text}`);
  const tf = new Map<string, number>();
  for (const term of terms) tf.set(term, (tf.get(term) ?? 0) + 1);
  return { passage, tf, length: terms.length, titleTerms: new Set(tokens(passage.title)) };
});

/** Everyday words mapped to the vocabulary used on the site. */
const SYNONYMS: [RegExp, string][] = [
  [/\b(custa|custo|valor|valores|quanto|mensalidade|preco|precos|caro|barato|investimento)\b/, "precos planos"],
  [/\b(gratis|gratuito|free|sem custo)\b/, "hacker gratis"],
  [/\b(integra|integracao|integracoes|integrar|conectar)\b/, "integracoes api webhooks"],
  [/\b(robo|bot|automatico)\b/, "chatbot automacao"],
  [/\b(ia|inteligencia artificial|gpt)\b/, "captain ia"],
  [/\b(atendentes|agentes|equipe|usuarios)\b/, "agentes"],
];

const expand = (query: string) => {
  const folded = normalize(query);
  return SYNONYMS.reduce((text, [pattern, extra]) => (pattern.test(folded) ? `${text} ${extra}` : text), folded);
};
const avgLength = index.reduce((sum, item) => sum + item.length, 0) / Math.max(1, index.length);
const df = new Map<string, number>();
for (const item of index) for (const term of item.tf.keys()) df.set(term, (df.get(term) ?? 0) + 1);

/** Returns the passages that best match the query (BM25, k1 = 1.4, b = 0.75). */
export function searchKnowledge(query: string, limit = 4): (Passage & { score: number })[] {
  const terms = [...new Set(tokens(expand(query)))];
  if (!terms.length) return [];
  const n = index.length;
  const scored = index.map(({ passage, tf, length, titleTerms }) => {
    let score = 0;
    for (const term of terms) {
      const idf = Math.log(1 + (n - (df.get(term) ?? 0) + 0.5) / ((df.get(term) ?? 0) + 0.5));
      const freq = tf.get(term);
      if (freq) score += (idf * freq * 2.4) / (freq + 1.4 * (1 - 0.75 + (0.75 * length) / avgLength));
      // A page whose title names the subject beats pages that only mention it.
      if (titleTerms.has(term)) score += idf * 1.5;
    }
    return { ...passage, score };
  });
  // At most two passages per page, so the answer can cite different sources.
  const perPage = new Map<string, number>();
  return scored
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score)
    .filter((item) => {
      const page = item.id.split("#")[0];
      const count = perPage.get(page) ?? 0;
      perPage.set(page, count + 1);
      return count < 2;
    })
    .slice(0, limit);
}

/** Compact facts that always go in the system prompt. */
export function planSummary() {
  return plans
    .map((plan) =>
      plan.monthly
        ? `- ${plan.name}: R$ ${plan.monthly}/agente/mês (R$ ${plan.annual} no plano anual). ${plan.description} ${plan.highlights.join("; ")}.`
        : `- ${plan.name}: grátis. ${plan.description} ${plan.highlights.join("; ")}.`
    )
    .join("\n");
}
