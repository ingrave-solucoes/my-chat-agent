/* Builds the agent's knowledge base from the Ingrave website content (ingrave-solucoes/ingrave-site).
   Usage: node scripts/sync-knowledge.mjs [path-to-ingrave-site]   (default: ../ingrave-site)
   Writes src/knowledge/site.json. Run it whenever plans, features or guides change on the site. */
import { build } from "esbuild";
import { mkdtempSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const site = resolve(process.argv[2] ?? "../ingrave-site");
const content = join(site, "client/src/content");
if (!existsSync(content)) {
  console.error(`Site content not found at ${content}`);
  process.exit(1);
}

const entry = ["pricing", "features", "pages", "compare", "guides", "tools"]
  .map((name) => `export * as ${name} from ${JSON.stringify(join(content, `${name}.ts`))};`)
  .join("\n");
const out = join(mkdtempSync(join(tmpdir(), "ingrave-kb-")), "content.mjs");
await build({ stdin: { contents: entry, resolveDir: content, loader: "ts" }, bundle: true, format: "esm", platform: "neutral", outfile: out, logLevel: "error" });
const { pricing, features, pages, compare, guides, tools } = await import(pathToFileURL(out).href);

const BASE = "https://ingrave.com.br";
const docs = [];
const add = (id, title, url, parts) => docs.push({ id, title, url: BASE + url, text: parts.flat(Infinity).filter(Boolean).join("\n") });
const faq = (items = []) => items.map(([q, a]) => `P: ${q}\nR: ${a}`);

add("precos", "Planos e preços", "/precos", [
  pricing.plans.map((p) => `${p.name}: ${p.monthly ? `R$ ${p.monthly}/agente/mês no mensal ou R$ ${p.annual}/agente/mês no anual` : "grátis"}. ${p.description} Inclui: ${p.highlights.join("; ")}.`),
  `Pacote extra do Captain: R$ ${pricing.captainAddon.price} por ${pricing.captainAddon.credits} créditos.`,
  pricing.comparison.map((g) => `${g.title}: ${g.rows.map(([label, ...cells]) => `${label} (Hacker ${fmt(cells[0])}, Startups ${fmt(cells[1])}, Business ${fmt(cells[2])}, Enterprise ${fmt(cells[3])})`).join("; ")}`),
  faq(pricing.pricingFaqs),
]);
function fmt(cell) { return cell === true ? "sim" : cell === false ? "não" : cell; }

for (const f of features.features) {
  add(`recurso-${f.slug}`, f.name, features.featureHref(f), [f.badge ? `(${f.badge})` : "", f.short, f.title, f.intro, f.benefits.map(([t, d]) => `${t}: ${d}`), f.steps.length ? `Como funciona: ${f.steps.join(" → ")}` : ""]);
}
for (const p of pages.products) {
  add(`produto-${p.slug}`, p.name, `/produto/${p.slug}`, [p.tagline, p.title, p.intro, p.highlights.map((h) => `${h.title}: ${h.text} ${h.bullets.join("; ")}`), faq(p.faqs)]);
}
for (const s of pages.solutions) {
  add(`solucao-${s.slug}`, `Solução: ${s.label}`, `/solucoes/${s.slug}`, [s.title, s.intro, s.challenges.map(([t, d]) => `Desafio: ${t}: ${d}`), s.workflow.map(([t, d]) => `${t}: ${d}`)]);
}
add("comparativos", "Ingrave em comparação", "/comparar", [Object.entries(compare.ingrave).map(([k, v]) => `${k}: ${v}`)]);
for (const c of compare.competitors) {
  add(`comparar-${c.slug}`, `Ingrave x ${c.name}`, `/comparar/${c.slug}`, [`${c.name} (${c.category}): ${c.tagline}`, c.summary, c.rows.map(([label, them, us]) => `${label}: ${c.name} = ${them}; Ingrave = ${us}`), c.differences.map(([t, d]) => `${t}: ${d}`), faq(compare.compareFaqs(c.name)), `Dados conferidos em ${compare.CHECKED_AT}.`]);
}
for (const g of guides.guides) {
  add(`guia-${g.slug}`, g.title, `/guias/${g.slug}`, [g.description, g.intro, g.sections.map((s) => [`## ${s.title}`, s.blocks.map((b) => typeof b === "string" ? b : "list" in b ? b.list.map((i) => `- ${i}`) : b.steps.map(([t, d], i) => `${i + 1}. ${t}: ${d}`))]), faq(g.faqs)]);
}
for (const t of tools.tools) {
  add(`ferramenta-${t.slug}`, t.name, `/ferramentas/${t.slug}`, [t.short, t.intro, t.how.map(([a, b]) => `${a}: ${b}`), faq(t.faqs)]);
}

const data = {
  syncedAt: new Date().toISOString().slice(0, 10),
  plans: pricing.plans.map(({ id, name, description, monthly, annual, highlights }) => ({ id, name, description, monthly, annual, highlights })),
  captainAddon: pricing.captainAddon,
  whatsappRates: tools.WHATSAPP_RATES,
  docs,
};
const target = new URL("../src/knowledge/site.json", import.meta.url);
writeFileSync(target, JSON.stringify(data, null, 1) + "\n");
console.log(`${docs.length} documents, ${Math.round(JSON.stringify(data).length / 1024)} KB → src/knowledge/site.json`);
