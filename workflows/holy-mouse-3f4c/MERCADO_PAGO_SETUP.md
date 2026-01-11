# Configuração do Mercado Pago

Este workflow está integrado com o Mercado Pago para processar pagamentos.

## 1. Obter Access Token do Mercado Pago

1. Acesse: https://www.mercadopago.com.br/developers/panel
2. Vá em "Suas integrações" > "Credenciais"
3. Copie o **Access Token** (use o de **Produção** para produção ou **Teste** para testes)

## 2. Configurar o Secret no Cloudflare

Execute o comando abaixo no terminal, substituindo `SEU_ACCESS_TOKEN` pelo token copiado:

```bash
cd /home/deckell/Documentos/my-chat-agent/workflows/holy-mouse-3f4c
npx wrangler secret put MERCADO_PAGO_ACCESS_TOKEN
```

Quando solicitado, cole o Access Token e pressione Enter.

## 3. Para desenvolvimento local

Crie um arquivo `.dev.vars` no diretório do workflow:

```bash
echo "MERCADO_PAGO_ACCESS_TOKEN=SEU_ACCESS_TOKEN_AQUI" > .dev.vars
```

**IMPORTANTE**: Nunca faça commit do arquivo `.dev.vars` (ele já está no .gitignore)

## 4. Configurar Webhook do Mercado Pago (Opcional)

Para receber notificações automáticas quando um pagamento for processado:

1. Acesse: https://www.mercadopago.com.br/developers/panel
2. Vá em "Suas integrações" > Selecione sua aplicação
3. Configure a URL de notificação (webhook):
   ```
   https://holy-mouse-3f4c.ingravebot.workers.dev/payment/webhook
   ```

## 5. Testar a Integração

Após configurar, você pode testar criando um pagamento através do chat agent:

**Exemplo de uso:**

- "Criar um pagamento de R$ 50,00 para Consultoria"
- "Verificar status do pagamento 123456789"

## Endpoints Disponíveis

- `POST /payment/create` - Criar nova preferência de pagamento
- `GET /payment/status?id={payment_id}` - Verificar status de um pagamento
- `POST /payment/webhook` - Receber notificações do Mercado Pago
- `GET /health` - Health check do serviço

## Documentação do Mercado Pago

- API Reference: https://www.mercadopago.com.br/developers/pt/reference
- Checkout Pro: https://www.mercadopago.com.br/developers/pt/docs/checkout-pro/landing
- Webhooks: https://www.mercadopago.com.br/developers/pt/docs/your-integrations/notifications/webhooks
