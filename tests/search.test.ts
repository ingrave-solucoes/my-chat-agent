import { describe, expect, it } from "vitest";
import { fromChunks, pageUrl, searchSite } from "../src/search";

const chunk = (key: string, text: string, score: number) => ({ id: `${key}#${score}`, type: "text", score, text, item: { key } });

describe("AI Search results", () => {
  it("normalises crawled keys to site URLs and drops other hosts", () => {
    expect(pageUrl("https://ingrave.com.br/precos/")).toBe("https://ingrave.com.br/precos");
    expect(pageUrl("ingrave.com.br/precos?utm_source=x#top")).toBe("https://ingrave.com.br/precos");
    expect(pageUrl("https://example.com/precos")).toBeNull();
  });

  it("keeps relevant chunks, at most two per page, with the site title", () => {
    const results = fromChunks(
      [
        chunk("https://ingrave.com.br/precos", "Business R$ 99", 0.9),
        chunk("https://ingrave.com.br/precos", "Startups grátis", 0.8),
        chunk("https://ingrave.com.br/precos", "Enterprise", 0.7),
        chunk("https://ingrave.com.br/contato", "Fale conosco", 0.2),
        chunk("https://ingrave.com.br/whatsapp", "API oficial", 0.6),
      ],
      4
    );
    expect(results.map((item) => item.url)).toEqual(["https://ingrave.com.br/precos", "https://ingrave.com.br/precos", "https://ingrave.com.br/whatsapp"]);
    expect(results[0].titulo).toBe("Planos e preços");
  });

  it("falls back to the local index when AI Search fails or finds nothing", async () => {
    const failing = { get: () => ({ search: async () => { throw new Error("down"); } }) } as unknown as AiSearchNamespace;
    const empty = { get: () => ({ search: async () => ({ search_query: "", chunks: [] }) }) } as unknown as AiSearchNamespace;
    for (const AI_SEARCH of [failing, empty]) {
      const result = await searchSite({ AI_SEARCH, AI_SEARCH_INSTANCE: "ingrave-site" }, "quanto custa o plano business");
      expect(result.fonte).toBe("local");
      expect(result.resultados.length).toBeGreaterThan(0);
    }
  });

  it("uses AI Search results when there are any", async () => {
    const ok = { get: () => ({ search: async () => ({ search_query: "q", chunks: [chunk("https://ingrave.com.br/precos", "Business R$ 99", 0.9)] }) }) } as unknown as AiSearchNamespace;
    const result = await searchSite({ AI_SEARCH: ok, AI_SEARCH_INSTANCE: "ingrave-site" }, "preço");
    expect(result).toEqual({ fonte: "ai-search", resultados: [{ titulo: "Planos e preços", url: "https://ingrave.com.br/precos", trecho: "Business R$ 99" }] });
  });
});

import { DEFAULT_HINTS, hintsFor } from "../src/pages";

describe("page hints", () => {
  it("matches the page the visitor is on", () => {
    expect(hintsFor("/precos").title).toMatch(/plano/);
    expect(hintsFor("/ferramentas/calculadora-whatsapp").title).toMatch(/custo/);
    expect(hintsFor("/canais/whatsapp").title).toMatch(/WhatsApp/);
    expect(hintsFor("/comparar/octadesk").suggestions).toContain("Quero migrar do Octadesk");
    expect(hintsFor("/")).toBe(DEFAULT_HINTS);
    expect(hintsFor(undefined)).toBe(DEFAULT_HINTS);
  });
});
