/* Welcome text and suggested questions that match the page the visitor is reading on
   ingrave.com.br. The first rule whose pattern matches the path wins. */

export type PageHints = { title: string; text: string; suggestions: string[] };

const TEAM = "Falar com a equipe";

export const DEFAULT_HINTS: PageHints = {
  title: "Olá! Como posso ajudar?",
  text: "Tire dúvidas sobre a Ingrave, planos e WhatsApp, ou peça para falar com a equipe.",
  suggestions: ["Quanto custa a Ingrave?", "Como funciona o WhatsApp com vários atendentes?", "Quero migrar do Octadesk", TEAM],
};

const RULES: [RegExp, PageHints][] = [
  [/^\/precos/, {
    title: "Vamos achar o plano certo?",
    text: "Diga quantas pessoas atendem e por quais canais que eu recomendo o plano e calculo o valor.",
    suggestions: ["Qual plano é melhor para 5 atendentes?", "Quanto fica o Business no plano anual?", "O plano grátis tem WhatsApp?", TEAM],
  }],
  [/^\/ferramentas\/calculadora-whatsapp|^\/lexend-tab/, {
    title: "Dúvidas sobre o custo do WhatsApp?",
    text: "Posso calcular o custo das mensagens da Meta para o seu volume e somar a assinatura da Ingrave.",
    suggestions: ["Quanto custam 1.000 mensagens de marketing por mês?", "Quando a mensagem é grátis?", "Qual a diferença entre marketing e utilidade?", TEAM],
  }],
  [/whatsapp/, {
    title: "Vamos falar de WhatsApp?",
    text: "Explico como funciona a API oficial, vários atendentes no mesmo número e o custo das mensagens.",
    suggestions: ["Vários atendentes no mesmo número?", "Preciso de um número novo para a API?", "Quanto custam as mensagens da Meta?", TEAM],
  }],
  [/^\/comparar/, {
    title: "Comparando ferramentas?",
    text: "Mostro as diferenças em preço, cobrança e recursos, e explico como funciona a migração.",
    suggestions: ["Quero migrar do Octadesk", "Qual a diferença para o Blip?", "A migração tem custo?", TEAM],
  }],
  [/^\/produto\/captain|ia-automacao|chatbot/, {
    title: "Quer usar IA no atendimento?",
    text: "Explico como o Captain responde clientes, ajuda a equipe e quanto custam os créditos.",
    suggestions: ["Como o Captain aprende com a minha empresa?", "A IA pode transferir para um humano?", "Quanto custam os créditos do Captain?", TEAM],
  }],
  [/^\/integracoes|^\/recursos\/api|webhook/, {
    title: "Quer conectar seus sistemas?",
    text: "Conto quais integrações existem e como usar a API e os webhooks.",
    suggestions: ["Integra com o meu CRM?", "Como funcionam os webhooks?", "Tem integração com Shopify?", TEAM],
  }],
  [/^\/contato/, {
    title: "Prefere resolver por aqui?",
    text: "Respondo na hora ou passo a conversa para a equipe, se você preferir.",
    suggestions: ["Quero uma demonstração", "Tenho uma dúvida sobre a minha conta", "Quanto custa a Ingrave?", TEAM],
  }],
];

export function hintsFor(path?: string): PageHints {
  if (!path) return DEFAULT_HINTS;
  const page = path.toLowerCase();
  return RULES.find(([pattern]) => pattern.test(page))?.[1] ?? DEFAULT_HINTS;
}
