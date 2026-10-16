/* Tools the assistant can call. Knowledge search, the WhatsApp cost estimate and the booking
   link run on their own; sharing contact data and handing off to a person need the visitor's
   confirmation in the chat (needsApproval). */
import { tool } from "ai";
import { z } from "zod";
import { plans, whatsappRates } from "./knowledge";
import type { SiteSearch } from "./search";

export type AgentActions = {
  search: (query: string) => Promise<SiteSearch>;
  bookingUrl: string;
  shareContact: (input: ContactInput) => Promise<{ ok: boolean; message: string }>;
  handoff: (input: HandoffInput) => Promise<{ ok: boolean; outsideHours: boolean; message: string }>;
};

const contactSchema = z.object({
  nome: z.string().min(2).max(120).describe("Nome da pessoa"),
  email: z.string().email().max(200).describe("E-mail para contato"),
  telefone: z.string().max(40).optional().describe("Telefone ou WhatsApp, se a pessoa informar"),
  empresa: z.string().max(160).optional().describe("Empresa, se a pessoa informar"),
  interesse: z.string().max(500).describe("Resumo do que a pessoa procura, em uma ou duas frases"),
});
export type ContactInput = z.infer<typeof contactSchema>;

const handoffSchema = z.object({
  motivo: z.enum(["vendas", "suporte", "financeiro", "outro"]).describe("Tipo de atendimento"),
  resumo: z.string().min(10).max(1200).describe("Resumo da conversa para a equipe: quem é, o que precisa e o que já foi respondido"),
});
export type HandoffInput = z.infer<typeof handoffSchema>;

const brl = (value: number, digits = 2) =>
  value.toLocaleString("pt-BR", { style: "currency", currency: "BRL", minimumFractionDigits: digits, maximumFractionDigits: digits });

/** Meta template cost (Brazil, BRL card) plus the optional Ingrave subscription. */
export function whatsappCost(input: { marketing: number; utilidade: number; autenticacao: number; agentes?: number; plano?: string }) {
  const rates = whatsappRates.brl;
  const lines = [
    { categoria: "Marketing", mensagens: input.marketing, porMensagem: rates.marketing },
    { categoria: "Utilidade", mensagens: input.utilidade, porMensagem: rates.utility },
    { categoria: "Autenticação", mensagens: input.autenticacao, porMensagem: rates.authentication },
  ].map((line) => ({ ...line, total: line.mensagens * line.porMensagem }));
  const meta = lines.reduce((sum, line) => sum + line.total, 0);
  const plan = input.plano ? plans.find((item) => item.id === input.plano && item.monthly > 0) : undefined;
  const subscription = plan && input.agentes ? plan.monthly * input.agentes : 0;
  return {
    detalhes: lines.map((line) => ({ ...line, porMensagem: brl(line.porMensagem, 4), total: brl(line.total) })),
    custoMetaMensal: brl(meta),
    custoMetaAnual: brl(meta * 12),
    ...(plan ? { assinaturaIngrave: `${plan.name}: ${input.agentes} agente(s) × ${brl(plan.monthly, 0)} = ${brl(subscription)}`, totalMensal: brl(meta + subscription) } : {}),
    observacao: `Tabela da Meta para o Brasil consultada em ${whatsappRates.checkedAt}, por mensagem de template entregue, sem impostos. Respostas dentro da janela de 24h são grátis. Fonte: ${whatsappRates.source}`,
  };
}

export function createTools(actions: AgentActions) {
  return {
    buscar_conhecimento: tool({
      description:
        "Busca no conteúdo oficial do site da Ingrave (recursos, canais, planos, integrações, comparativos com concorrentes, guias e ferramentas). Use antes de responder dúvidas sobre o produto.",
      inputSchema: z.object({ consulta: z.string().min(2).max(300).describe("O que procurar, em português") }),
      execute: async ({ consulta }) => {
        const { resultados } = await actions.search(consulta);
        if (!resultados.length) return { resultados: [], aviso: "Nada encontrado no site. Não invente; ofereça falar com a equipe." };
        return { resultados };
      },
    }),

    calcular_custo_whatsapp: tool({
      description:
        "Calcula o custo mensal estimado da Meta pelas mensagens de template do WhatsApp (marketing, utilidade, autenticação) e, se informado, soma a assinatura da Ingrave.",
      inputSchema: z.object({
        marketing: z.number().int().min(0).max(10_000_000).describe("Mensagens de marketing por mês"),
        utilidade: z.number().int().min(0).max(10_000_000).describe("Mensagens de utilidade por mês (pedidos, lembretes fora da janela de 24h)"),
        autenticacao: z.number().int().min(0).max(10_000_000).describe("Mensagens de autenticação por mês (códigos)"),
        agentes: z.number().int().min(1).max(5000).optional().describe("Número de agentes, para somar a assinatura"),
        plano: z.enum(["startups", "business", "enterprise"]).optional().describe("Plano da Ingrave para somar"),
      }),
      execute: async (input) => whatsappCost(input),
    }),

    agendar_demonstracao: tool({
      description: "Mostra o botão para a pessoa escolher um horário de demonstração (vídeo de 30 minutos com a equipe).",
      inputSchema: z.object({}),
      execute: async () => ({ url: actions.bookingUrl, duracao: "30 minutos, por vídeo (Microsoft Teams)" }),
    }),

    registrar_contato: tool({
      description:
        "Envia nome, e-mail e o interesse da pessoa para a equipe comercial da Ingrave entrar em contato. Só use quando a pessoa quiser ser contatada. Ela confirma na tela antes do envio.",
      inputSchema: contactSchema,
      needsApproval: true,
      execute: async (input) => actions.shareContact(input),
    }),

    transferir_para_humano: tool({
      description:
        "Transfere a conversa para uma pessoa da equipe Ingrave, com um resumo. Use quando a pessoa pedir, quando for suporte de conta existente, negociação ou algo que você não consegue resolver. Ela confirma na tela.",
      inputSchema: handoffSchema,
      needsApproval: true,
      execute: async (input) => actions.handoff(input),
    }),
  };
}
