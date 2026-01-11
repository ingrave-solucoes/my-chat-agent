# Integração ElevenLabs Text-to-Speech

Este documento explica como integrar e usar a funcionalidade de conversão de texto em áudio (Text-to-Speech) usando o ElevenLabs através do Cloudflare AI Gateway.

## 🎯 Visão Geral

A integração permite que o agent converta mensagens de texto em áudio de alta qualidade e envie automaticamente para os clientes através do Chatwoot. Isso é útil para:

- Enviar mensagens de voz personalizadas
- Melhorar a acessibilidade
- Criar experiências de atendimento mais humanizadas
- Suportar múltiplos idiomas (Português, Inglês, Espanhol, etc.)

## 🔧 Configuração

### 1. Obter Credenciais

#### ElevenLabs API Key

1. Acesse [ElevenLabs](https://elevenlabs.io/)
2. Crie uma conta ou faça login
3. Vá para [Settings > API Keys](https://elevenlabs.io/app/settings/api-keys)
4. Copie sua API Key

#### Cloudflare Account ID e AI Gateway ID

1. Acesse o [Cloudflare Dashboard](https://dash.cloudflare.com/)
2. Selecione sua conta
3. O **Account ID** está visível na URL ou na barra lateral
4. Vá para **AI > AI Gateway**
5. Crie um novo gateway ou use um existente
6. Copie o **Gateway ID**

### 2. Configurar Variáveis de Ambiente

Adicione as seguintes variáveis no seu arquivo `.dev.vars` (para desenvolvimento local):

```bash
# ElevenLabs Configuration
ELEVENLABS_API_KEY=your_elevenlabs_api_key_here
CLOUDFLARE_ACCOUNT_ID=your_cloudflare_account_id
AI_GATEWAY_ID=your_ai_gateway_id
```

### 3. Deploy para Produção

Para fazer deploy das credenciais para produção, use o Wrangler:

```bash
# Fazer upload de todas as variáveis de uma vez
wrangler secret bulk .dev.vars

# Ou definir individualmente
wrangler secret put ELEVENLABS_API_KEY
wrangler secret put CLOUDFLARE_ACCOUNT_ID
wrangler secret put AI_GATEWAY_ID
```

## 📚 Como Usar

### Através do Chatwoot

Quando um cliente envia uma mensagem via Chatwoot, o agent pode automaticamente decidir enviar uma resposta em áudio. O agent usará a ferramenta `textToSpeech` quando apropriado.

### Uso Programático

A ferramenta `textToSpeech` está disponível para o agent com os seguintes parâmetros:

```typescript
{
  text: string,           // Texto para converter em áudio (obrigatório)
  voiceId?: string,       // ID da voz (opcional, padrão: Rachel)
  language?: string       // Idioma (opcional: "portuguese", "english", "spanish")
}
```

### Exemplo de Uso pelo Agent

O agent pode usar a ferramenta assim:

```
Usuário: "Preciso de ajuda urgente!"
Agent: [Decide enviar áudio] textToSpeech({
  text: "Olá! Estou aqui para ajudar você. Como posso resolver sua situação urgente?",
  language: "portuguese"
})
```

## 🎤 Vozes Disponíveis

O sistema vem pré-configurado com várias vozes do ElevenLabs:

- **Rachel** (padrão) - `JBFqnCBsd6RMkjVDRZzb` - Voz feminina profissional
- **Adam** - `pNInz6obpgDQGcFmaJgB` - Voz masculina
- **Bella** - `EXAVITQu4vr4xnSDxMaL` - Voz feminina jovem
- **Elli** - `MF3mGyEYCl7XYWbV9V6O` - Voz feminina energética
- **Josh** - `TxGEqnHWrfWFTfGW9XjX` - Voz masculina jovem
- **Arnold** - `VR6AewLTigWG4xSOukaG` - Voz masculina forte
- **Domi** - `AZnzlk1XvdvUeBnXmlld` - Voz feminina calorosa
- **Nicole** - `piTKgcLEGmPE4e6mEKli` - Voz feminina suave

Você pode encontrar mais vozes em: [ElevenLabs Voice Library](https://elevenlabs.io/voice-library)

## 🔄 Fluxo de Funcionamento

1. **Solicitação**: O agent decide enviar uma mensagem de voz ou recebe uma solicitação
2. **Conversão**: O texto é enviado para o ElevenLabs via Cloudflare AI Gateway
3. **Geração**: O ElevenLabs gera o áudio em MP3 (44.1kHz, 128kbps)
4. **Envio**: O áudio é enviado como anexo no Chatwoot
5. **Confirmação**: O cliente recebe a mensagem de voz no chat

## 🌐 Cloudflare AI Gateway

O uso do Cloudflare AI Gateway oferece vantagens:

- **Cache**: Respostas podem ser cacheadas automaticamente
- **Analytics**: Monitore uso e custos
- **Rate Limiting**: Controle de taxa de requisições
- **Custo**: Reduza custos com cache inteligente
- **Logs**: Registros detalhados de todas as chamadas

### Estrutura da URL do Gateway

```
https://gateway.ai.cloudflare.com/v1/{account_id}/{gateway_id}/elevenlabs/v1/text-to-speech/{voice_id}?output_format=mp3_44100_128
```

## 📊 Monitoramento

Você pode monitorar o uso no Cloudflare Dashboard:

1. Acesse **AI > AI Gateway**
2. Selecione seu gateway
3. Visualize métricas:
   - Número de requisições
   - Taxa de cache
   - Latência média
   - Custos estimados

## 🔒 Segurança

- **API Keys**: Nunca commite suas chaves no repositório
- **Secrets**: Use sempre `wrangler secret` para produção
- **Gateway**: O AI Gateway adiciona uma camada extra de segurança
- **Validação**: O código valida se todas as credenciais estão configuradas antes de usar

## 💰 Custos

- **ElevenLabs**: Verifique os planos em [elevenlabs.io/pricing](https://elevenlabs.io/pricing)
  - Free tier: 10,000 caracteres/mês
  - Starter: $5/mês - 30,000 caracteres/mês
  - Creator: $22/mês - 100,000 caracteres/mês
- **Cloudflare AI Gateway**: Gratuito (faz parte do Cloudflare Workers)

## 🛠️ Arquitetura

```
┌─────────────┐
│   Chatwoot  │
│   Webhook   │
└──────┬──────┘
       │
       v
┌─────────────────┐
│  Cloudflare     │
│  Worker         │
│  (Agent)        │
└────┬──────┬─────┘
     │      │
     │      v
     │  ┌──────────────────┐
     │  │  Cloudflare      │
     │  │  AI Gateway      │
     │  └────────┬─────────┘
     │           │
     │           v
     │  ┌──────────────────┐
     │  │   ElevenLabs     │
     │  │   Text-to-Speech │
     │  └────────┬─────────┘
     │           │
     │           v (Audio MP3)
     │  ┌──────────────────┐
     └─>│    Chatwoot      │
        │    Message API   │
        └──────────────────┘
```

## 🐛 Troubleshooting

### Erro: "ElevenLabs integration is not configured"

**Solução**: Verifique se todas as variáveis de ambiente estão configuradas:

```bash
wrangler secret list
```

### Erro: "Chatwoot is not configured"

**Solução**: Configure as variáveis do Chatwoot também (necessárias para enviar o áudio):

```bash
CHATWOOT_BASE_URL=...
CHATWOOT_API_KEY=...
CHATWOOT_ACCOUNT_ID=...
```

### Áudio não é reproduzido no Chatwoot

**Solução**: Verifique se o Chatwoot está configurado para aceitar anexos de áudio. Alguns servidores podem ter restrições de tipo MIME.

### Erro 401 do ElevenLabs

**Solução**: Verifique se sua API key está correta e ativa:

```bash
curl -X GET https://api.elevenlabs.io/v1/user \
  -H "xi-api-key: YOUR_API_KEY"
```

## 📖 Referências

- [ElevenLabs API Documentation](https://docs.elevenlabs.io/api-reference)
- [Cloudflare AI Gateway Documentation](https://developers.cloudflare.com/ai-gateway/)
- [Chatwoot API Documentation](https://www.chatwoot.com/docs/product/channels/api/client-apis)

## 🚀 Próximos Passos

Possíveis melhorias futuras:

1. **Seleção Automática de Voz**: Detectar idioma e escolher voz apropriada
2. **Personalização**: Permitir que clientes escolham suas vozes preferidas
3. **Streaming**: Implementar streaming de áudio para respostas mais rápidas
4. **Cache Inteligente**: Cachear mensagens comuns para reduzir custos
5. **Análise de Sentimento**: Ajustar tom da voz baseado no sentimento da mensagem
