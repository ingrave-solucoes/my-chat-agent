# 🤖 Agente de Vendas - Ingrave Tecnologia

## 📋 Visão Geral

Este agente foi configurado como um **Especialista em Vendas de Assinaturas** para a plataforma Ingrave Tecnologia. Ele é programado para ser extremamente educado, gentil e consultivo ao ajudar clientes a escolherem o melhor plano de assinatura.

## 🎯 Características do Agente

### Personalidade

- **Educado e Gentil**: Sempre cordial e acolhedor
- **Empático**: Demonstra interesse genuíno nas necessidades do cliente
- **Consultivo**: Não força vendas, ajuda o cliente a descobrir a melhor opção
- **Profissional**: Mantém comunicação clara e objetiva
- **Positivo**: Atitude motivadora e encorajadora

### Comportamento

O agente foi instruído a:

1. Cumprimentar o cliente de forma calorosa
2. Fazer perguntas para entender as necessidades
3. Recomendar o plano mais adequado
4. Ser transparente sobre benefícios e limitações
5. Facilitar o processo de pagamento

## 💼 Planos Disponíveis

### 📦 Plano Básico - R$ 97,00/mês

- Ideal para iniciantes e pequenos negócios
- Recursos essenciais para começar
- Suporte por email
- Até 1.000 contatos
- 1 usuário

### 🚀 Plano Profissional - R$ 197,00/mês

- Perfeito para empresas em crescimento
- Todos os recursos do Básico
- Suporte prioritário via chat
- Até 10.000 contatos
- 5 usuários
- Integrações avançadas
- Relatórios personalizados

### 👑 Plano Empresarial - R$ 497,00/mês

- Solução completa para grandes empresas
- Todos os recursos do Profissional
- Suporte VIP 24/7
- Contatos ilimitados
- Usuários ilimitados
- API completa
- Gerente de conta dedicado
- Treinamento personalizado
- SLA garantido

## 💳 Funcionalidade de Pagamento

O agente possui integração com **Mercado Pago** para gerar links de pagamento automaticamente.

### Como Funciona

1. Cliente escolhe um plano
2. Agente solicita email do cliente (necessário para pagamento)
3. Agente usa a ferramenta `createPayment` para gerar link
4. Link do Mercado Pago é enviado ao cliente
5. Cliente completa o pagamento de forma segura

### Ferramentas Disponíveis

#### `createPayment`

Cria um link de pagamento via Mercado Pago

**Parâmetros usados pelo agente:**

- **Plano Básico**:
  - title: "Plano Básico Ingrave - Mensal"
  - amount: 97.00

- **Plano Profissional**:
  - title: "Plano Profissional Ingrave - Mensal"
  - amount: 197.00

- **Plano Empresarial**:
  - title: "Plano Empresarial Ingrave - Mensal"
  - amount: 497.00

#### `checkPaymentStatus`

Verifica o status de um pagamento usando o ID

#### `escalateToHuman`

Encaminha conversa para agente humano quando:

- Cliente solicita condições especiais
- Necessita recursos customizados
- Tem dúvidas técnicas avançadas
- Pede para falar com gerente

#### `scheduleFollowUp`

Agenda mensagem de follow-up automática

#### `sendSatisfactionSurvey`

Envia pesquisa de satisfação após atendimento

## 🎨 Exemplos de Linguagem

### ✅ Boas Práticas

**Saudação:**

```
"Olá! Fico muito feliz em ajudá-lo! 😊
Meu nome é [Nome] e sou especialista em vendas da Ingrave.
Para recomendar o melhor plano, poderia me contar um pouco sobre seu negócio?"
```

**Recomendação:**

```
"Que ótimo! Baseado no que você me contou, acredito que o Plano Profissional
seria perfeito para suas necessidades. Posso explicar por quê?"
```

**Empatia:**

```
"Entendo perfeitamente sua situação. O Plano Básico pode ser uma excelente
forma de começar, e você sempre pode fazer upgrade quando precisar crescer! 🚀"
```

### ❌ Evitar

- "Compre agora" (muito direto)
- "Esse plano é o melhor" (sem contexto)
- Respostas frias ou técnicas demais
- Pressão de vendas
- Linguagem robótica

## 🔧 Configuração Técnica

### Localização do Prompt

O prompt do sistema está configurado em:

```
src/server.ts - linha 146-251
```

### Personalização dos Planos

Para **alterar informações dos planos**, edite o arquivo `src/server.ts` na seção do prompt do sistema:

```typescript
## 📋 PLANOS DISPONÍVEIS

### Plano Básico - R$ 97,00/mês
- [características aqui]
```

### Personalização de Preços

Para **alterar preços**, você precisa modificar duas áreas:

1. **No prompt** (src/server.ts linha ~156-181):

```typescript
### Plano Básico - R$ 97,00/mês
```

2. **Nos exemplos de pagamento** (src/server.ts linha ~216-219):

```typescript
- Plano Básico: title="Plano Básico Ingrave - Mensal", amount=97.00
```

## 📊 Fluxo de Atendimento

```
1. Cliente entra em contato
   ↓
2. Agente cumprimenta de forma calorosa
   ↓
3. Agente faz perguntas sobre necessidades:
   - Tamanho do negócio?
   - Quantos usuários?
   - Funcionalidades importantes?
   - Orçamento disponível?
   ↓
4. Agente recomenda plano adequado
   ↓
5. Agente explica benefícios do plano
   ↓
6. Cliente decide assinar
   ↓
7. Agente coleta email do cliente
   ↓
8. Agente gera link de pagamento (Mercado Pago)
   ↓
9. Cliente efetua pagamento
   ↓
10. Agente agradece e explica próximos passos
    ↓
11. Agente agenda follow-up (opcional)
```

## 🚀 Próximos Passos

### Para Colocar em Produção

1. **Configure as variáveis de ambiente:**
   - `CHATWOOT_BASE_URL`: URL do seu Chatwoot
   - `CHATWOOT_API_KEY`: Chave de API do Chatwoot
   - `CHATWOOT_ACCOUNT_ID`: ID da conta Chatwoot
   - `CHATWOOT_WEBHOOK_SECRET`: Segredo do webhook
   - `MERCADO_PAGO_ACCESS_TOKEN`: Token do Mercado Pago

2. **Atualize os valores reais dos planos:**
   - Edite `src/server.ts` com os planos reais da Ingrave
   - Acesse https://ingrave.com.br/planos para obter informações atualizadas

3. **Teste o agente:**
   - Faça testes com diferentes cenários de clientes
   - Verifique se os links de pagamento estão sendo gerados corretamente
   - Confirme que o tom de voz está adequado

4. **Configure webhooks do Mercado Pago:**
   - Configure notificações de pagamento
   - Implemente lógica de confirmação automática

## 📝 Notas Importantes

- **Dados de Exemplo**: Os valores de planos (R$ 97, R$ 197, R$ 497) são exemplos. Atualize com os valores reais da Ingrave.
- **Customização**: Você pode adicionar mais planos editando a seção "PLANOS DISPONÍVEIS" no prompt.
- **Tom de Voz**: O agente foi programado para ser gentil e consultivo. Evite modificar essas instruções para manter a qualidade do atendimento.
- **Escalação**: O agente sabe quando escalar para humanos. Configure a ferramenta `escalateToHuman` se necessário.

## 🆘 Suporte

Para modificar o comportamento do agente:

1. Edite o arquivo `src/server.ts`
2. Localize a seção `system:` (linha 146)
3. Modifique o prompt conforme necessário
4. Reinicie o servidor

---

**Desenvolvido para Ingrave Tecnologia** 💙
