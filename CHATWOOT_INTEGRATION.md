# Integração com Chatwoot

Este guia explica como integrar o agent AI com o Chatwoot para responder automaticamente às mensagens dos clientes.

## Arquitetura

A integração funciona da seguinte forma:

1. **Webhook do Chatwoot** → Agent recebe notificação quando uma nova mensagem chega
2. **Processamento** → Agent processa a mensagem com OpenAI e gera resposta
3. **Resposta automática** → Agent envia a resposta de volta para o Chatwoot via API
4. **Persistência** → Cada conversa do Chatwoot tem seu próprio agent com histórico isolado

## Configuração

### 1. Obter credenciais do Chatwoot

Você precisará das seguintes informações:

- **CHATWOOT_BASE_URL**: URL da sua instância Chatwoot (ex: `https://app.chatwoot.com`)
- **CHATWOOT_API_KEY**: Token de acesso da API (obtenha em: Perfil → Access Token)
- **CHATWOOT_ACCOUNT_ID**: ID da sua conta (veja na URL: `/app/accounts/{ACCOUNT_ID}/...`)

### 2. Configurar variáveis de ambiente

#### Desenvolvimento local

Crie um arquivo `.dev.vars` na raiz do projeto:

```env
OPENAI_API_KEY=sk-proj-...

CHATWOOT_BASE_URL=https://your-chatwoot-instance.com
CHATWOOT_API_KEY=your_chatwoot_api_access_token
CHATWOOT_ACCOUNT_ID=1
```

#### Produção (Cloudflare Workers)

Use o Wrangler para fazer upload dos secrets:

```bash
# Opção 1: Upload em lote
wrangler secret bulk .dev.vars

# Opção 2: Definir individualmente
wrangler secret put CHATWOOT_BASE_URL
wrangler secret put CHATWOOT_API_KEY
wrangler secret put CHATWOOT_ACCOUNT_ID
```

### 3. Configurar webhook no Chatwoot

1. No painel do Chatwoot, vá para **Settings → Integrations → Webhooks**
2. Clique em **Add Webhook**
3. Configure:
   - **Endpoint URL**: `https://your-worker.workers.dev/chatwoot/webhook`
   - **Events**: Selecione apenas `message_created`
4. Salve o webhook

> **Nota**: O endpoint deve ser público e acessível pela internet. Durante desenvolvimento local, use um serviço como ngrok ou Cloudflare Tunnel.

## Funcionamento

### Fluxo de mensagens

1. Cliente envia mensagem no Chatwoot
2. Chatwoot dispara webhook para `/chatwoot/webhook`
3. Agent:
   - Valida o evento (apenas `message_created` de clientes)
   - Identifica/cria agent específico para aquela conversa
   - Processa mensagem com histórico da conversa
   - Gera resposta usando OpenAI
   - Envia resposta de volta para o Chatwoot

### Isolamento de conversas

Cada conversa do Chatwoot tem seu próprio agent isolado com:

- Histórico independente de mensagens
- Estado persistente via Durable Objects
- ID único baseado no `conversation_id` do Chatwoot

### Tools disponíveis

O agent tem acesso aos seguintes tools específicos do Chatwoot:

#### `sendChatwootNote`

Envia uma nota privada na conversa (visível apenas para agentes).

```typescript
// Exemplo de uso pelo AI
sendChatwootNote({
  note: "Cliente mencionou problema com pagamento - escalar para financeiro"
});
```

#### `resolveChatwootConversation`

Fecha/resolve a conversa atual.

```typescript
// Exemplo de uso pelo AI
resolveChatwootConversation({});
```

## Desenvolvimento local com webhook

Para testar webhooks localmente:

### Usando Cloudflare Tunnel (recomendado)

```bash
# Inicie o servidor local
npm start

# Em outro terminal, crie um tunnel
cloudflared tunnel --url http://localhost:8787
```

Use a URL gerada como endpoint do webhook no Chatwoot.

### Usando ngrok

```bash
# Inicie o servidor local
npm start

# Em outro terminal
ngrok http 8787
```

Use a URL do ngrok como endpoint do webhook.

## Personalização

### Modificar o comportamento do agent

Edite o método `processChatwootMessage` em `src/server.ts`:

```typescript
async processChatwootMessage(event: ChatwootWebhookEvent) {
  // Customize o system prompt
  const result = await streamText({
    system: `Você é um assistente especializado em...`,
    // ...
  });
}
```

### Adicionar validação de webhook

Por segurança, você pode validar a origem dos webhooks:

1. Configure um secret no Chatwoot
2. Adicione ao `.dev.vars`:
   ```env
   CHATWOOT_WEBHOOK_SECRET=seu_secret_aqui
   ```
3. A validação já está implementada em `validateWebhookSignature`

### Filtrar tipos de mensagem

Por padrão, apenas mensagens de texto (`content_type: "text"`) são processadas. Para processar outros tipos, edite `chatwootMessageToUIMessage` em `src/chatwoot.ts`.

## Teste

### Testar endpoint manualmente

```bash
curl -X POST https://your-worker.workers.dev/chatwoot/webhook \
  -H "Content-Type: application/json" \
  -d '{
    "event": "message_created",
    "conversation": {
      "id": 123,
      "inbox_id": 1
    },
    "message": {
      "id": 456,
      "content": "Olá, preciso de ajuda",
      "message_type": "incoming",
      "content_type": "text",
      "created_at": 1640000000
    }
  }'
```

### Verificar logs

```bash
# Logs locais
npm start

# Logs de produção
wrangler tail
```

## Monitoramento

### Métricas importantes

- Taxa de resposta (% de mensagens respondidas)
- Tempo de resposta (latência entre webhook e resposta)
- Erros de API (falhas ao chamar OpenAI ou Chatwoot)

### Logs estruturados

O código já inclui logs para:

- Webhook recebidos
- Erros de processamento
- Chamadas de API ao Chatwoot

## Troubleshooting

### Agent não responde

1. Verifique se o webhook está configurado corretamente
2. Verifique os logs: `wrangler tail`
3. Confirme que as credenciais estão corretas
4. Teste o endpoint manualmente com curl

### Respostas duplicadas

- Certifique-se de que o webhook está configurado apenas para `message_created`
- Verifique se há múltiplos webhooks cadastrados

### Erro 401 ao enviar mensagem

- Verifique se o `CHATWOOT_API_KEY` está correto
- Confirme que o token tem permissões para enviar mensagens

### Conversa não mantém histórico

- Verifique se o `conversation_id` está sendo extraído corretamente
- Confirme que o Durable Object está configurado corretamente no `wrangler.jsonc`

## Arquivos relevantes

- `src/server.ts` - Webhook endpoint e lógica principal
- `src/chatwoot.ts` - Cliente da API e conversão de mensagens
- `src/chatwoot-types.ts` - Tipos TypeScript do Chatwoot
- `src/tools.ts` - Tools específicos do Chatwoot
- `.dev.vars.example` - Exemplo de configuração

## Próximos passos

- [ ] Adicionar suporte para anexos/imagens
- [ ] Implementar handoff para agente humano
- [ ] Adicionar métricas e analytics
- [ ] Criar dashboard de monitoramento
- [ ] Implementar rate limiting
- [ ] Adicionar suporte para múltiplos idiomas
