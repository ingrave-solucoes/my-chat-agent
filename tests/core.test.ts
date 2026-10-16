import { describe, expect, it } from "vitest";
import type { LanguageModelV3 } from "@ai-sdk/provider";
import { isTeamReply, safeEqual, sessionOf, conversationIdOf, AGENT_MARK } from "../src/chatwoot";
import { describeHours, isOpen } from "../src/hours";
import { plans, searchKnowledge } from "../src/knowledge";
import { gatewayBaseUrl, withFallback } from "../src/model";
import { whatsappCost } from "../src/tools";

const SESSION = "0b8c7a5e-5d1f-4c55-9b0a-3f7d2c1e9a10";

describe("business hours", () => {
  const spec = "1-5 09:00-18:00";
  it("is open on a weekday afternoon in São Paulo", () => {
    expect(isOpen(spec, "America/Sao_Paulo", new Date("2026-10-14T17:00:00Z"))).toBe(true); // Wed 14:00 BRT
  });
  it("is closed at night and on weekends", () => {
    expect(isOpen(spec, "America/Sao_Paulo", new Date("2026-10-14T23:30:00Z"))).toBe(false); // Wed 20:30
    expect(isOpen(spec, "America/Sao_Paulo", new Date("2026-10-17T15:00:00Z"))).toBe(false); // Sat
  });
  it("describes the schedule in Portuguese", () => {
    expect(describeHours(spec)).toBe("segunda a sexta, das 09:00 às 18:00");
  });
  it("treats an empty spec as always open", () => {
    expect(isOpen("", "America/Sao_Paulo")).toBe(true);
  });
});

describe("knowledge search", () => {
  it("finds the pricing page for price questions", () => {
    expect(searchKnowledge("quanto custa?")[0].url).toBe("https://ingrave.com.br/precos");
  });
  it("finds competitor comparisons", () => {
    expect(searchKnowledge("migrar do Octadesk")[0].title).toContain("Octadesk");
  });
  it("returns at most two passages per page", () => {
    const urls = searchKnowledge("chatbot com IA no WhatsApp", 6).map((item) => item.url);
    for (const url of urls) expect(urls.filter((other) => other === url).length).toBeLessThanOrEqual(2);
  });
  it("has the four plans from the site", () => {
    expect(plans.map((plan) => plan.id)).toEqual(["hacker", "startups", "business", "enterprise"]);
  });
});

describe("WhatsApp cost", () => {
  it("multiplies volumes by the Meta rate card and adds the subscription", () => {
    const result = whatsappCost({ marketing: 1000, utilidade: 0, autenticacao: 0, agentes: 2, plano: "business" });
    expect(result.custoMetaMensal).toMatch(/R\$\s?321,70/);
    expect(result.totalMensal).toMatch(/R\$\s?619,70/);
  });
});

describe("Chatwoot webhook", () => {
  const conversation = { id: 9, custom_attributes: { agent_session: SESSION } };
  const reply = { event: "message_created", id: 1, content: "Olá!", message_type: "outgoing", private: false, sender: { name: "Ana", type: "user" }, conversation };
  it("accepts public replies typed by the team", () => {
    expect(isTeamReply(reply)).toBe(true);
    expect(sessionOf(reply)).toBe(SESSION);
    expect(conversationIdOf(reply)).toBe(9);
  });
  it("ignores notes, visitor messages and the assistant's own echo", () => {
    expect(isTeamReply({ ...reply, private: true })).toBe(false);
    expect(isTeamReply({ ...reply, message_type: "incoming" })).toBe(false);
    expect(isTeamReply({ ...reply, content_attributes: { [AGENT_MARK]: true } })).toBe(false);
    expect(isTeamReply({ ...reply, sender: { type: "agent_bot" } })).toBe(false);
  });
  it("rejects malformed session ids", () => {
    expect(sessionOf({ conversation: { custom_attributes: { agent_session: "../../x" } } })).toBeUndefined();
  });
  it("compares secrets without short-circuiting", () => {
    expect(safeEqual("abc", "abc")).toBe(true);
    expect(safeEqual("abc", "abd")).toBe(false);
    expect(safeEqual("abc", "abcd")).toBe(false);
  });
});

describe("model routing", () => {
  const env = { AI_GATEWAY_ACCOUNT_ID: "acc", AI_GATEWAY_ID: "ingrave", DGX_PROVIDER_SLUG: "dgx-spark" } as Parameters<typeof gatewayBaseUrl>[0];
  it("builds the AI Gateway custom provider URL", () => {
    expect(gatewayBaseUrl(env)).toBe("https://gateway.ai.cloudflare.com/v1/acc/ingrave/custom-dgx-spark/v1");
  });

  const fake = (name: string, behaviour: "ok" | "fail" | "hang"): LanguageModelV3 => ({
    specificationVersion: "v3",
    provider: name,
    modelId: name,
    supportedUrls: {},
    doGenerate: async (options) => {
      if (behaviour === "fail") throw new Error(`${name} down`);
      if (behaviour === "hang") await new Promise((_, reject) => options.abortSignal?.addEventListener("abort", () => reject(new Error("aborted"))));
      return { content: [{ type: "text", text: name }], finishReason: { unified: "stop", raw: "stop" }, usage: {} as never, warnings: [] } as never;
    },
    doStream: async () => {
      throw new Error("not used");
    },
  });
  const call = (model: LanguageModelV3) => model.doGenerate({ prompt: [] } as never).then((result) => (result.content[0] as { text: string }).text);

  it("uses the DGX when it answers", async () => {
    expect(await call(withFallback(fake("dgx", "ok"), fake("workers-ai", "ok")))).toBe("dgx");
  });
  it("falls back to Workers AI when the DGX fails", async () => {
    const errors: unknown[] = [];
    expect(await call(withFallback(fake("dgx", "fail"), fake("workers-ai", "ok"), { onFallback: (error) => errors.push(error) }))).toBe("workers-ai");
    expect(errors).toHaveLength(1);
  });
  it("falls back when the DGX does not answer in time", async () => {
    expect(await call(withFallback(fake("dgx", "hang"), fake("workers-ai", "ok"), { timeoutMs: 50 }))).toBe("workers-ai");
  });
});
