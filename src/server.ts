import { routeAgentRequest, type Schedule } from "agents";

import { getSchedulePrompt } from "agents/schedule";

import { AIChatAgent } from "agents/ai-chat-agent";
import {
  generateId,
  streamText,
  type StreamTextOnFinishCallback,
  stepCountIs,
  createUIMessageStream,
  convertToModelMessages,
  createUIMessageStreamResponse,
  type ToolSet
} from "ai";
import { openai } from "@ai-sdk/openai";
import { processToolCalls, cleanupMessages } from "./utils";
import { tools, executions } from "./tools";
import type { ChatwootWebhookEvent } from "./chatwoot-types";
import {
  ChatwootClient,
  chatwootMessageToUIMessage,
  validateWebhookSignature,
  getChatwootAgentId
} from "./chatwoot";
import {
  R2StorageManager,
  generateFileKey,
  getContentType
} from "./r2";
import {
  QueueManager,
  QueueMessageType,
  MessageRouter,
  type QueueMessage
} from "./queue";
// import { env } from "cloudflare:workers";

const model = openai("gpt-4o-2024-11-20");
// Cloudflare AI Gateway
// const openai = createOpenAI({
//   apiKey: env.OPENAI_API_KEY,
//   baseURL: env.GATEWAY_BASE_URL,
// });

/**
 * Chat Agent implementation that handles real-time AI chat interactions
 */
export class Chat extends AIChatAgent<Env> {
  /**
   * Handles incoming chat messages and manages the response stream
   */
  async onChatMessage(
    onFinish: StreamTextOnFinishCallback<ToolSet>,
    _options?: { abortSignal?: AbortSignal }
  ) {
    // const mcpConnection = await this.mcp.connect(
    //   "https://path-to-mcp-server/sse"
    // );

    // Collect all tools, including MCP tools
    const allTools = {
      ...tools,
      ...this.mcp.getAITools()
    };

    const stream = createUIMessageStream({
      execute: async ({ writer }) => {
        // Clean up incomplete tool calls to prevent API errors
        const cleanedMessages = cleanupMessages(this.messages);

        // Process any pending tool calls from previous messages
        // This handles human-in-the-loop confirmations for tools
        const processedMessages = await processToolCalls({
          messages: cleanedMessages,
          dataStream: writer,
          tools: allTools,
          executions
        });

        const result = streamText({
          system: `# Assistente Virtual Ingrave Tecnologia

Você é um assistente virtual avançado especializado em ajudar usuários da Ingrave Tecnologia.

## Contexto e Capacidades

Você tem acesso a ferramentas especializadas para:
- Agendamento de tarefas e lembretes
- Integração com sistemas MCP (Model Context Protocol)
- Processamento de solicitações em tempo real

${getSchedulePrompt({ date: new Date() })}

## Diretrizes de Comportamento

### Tom e Linguagem
- Seja profissional, claro e conciso
- Use uma linguagem amigável mas profissional
- Adapte-se ao estilo de comunicação do usuário

### Processamento de Solicitações
1. **Análise**: Compreenda completamente a solicitação do usuário
2. **Ação**: Utilize as ferramentas apropriadas quando necessário
3. **Confirmação**: Sempre confirme ações importantes antes de executá-las
4. **Feedback**: Forneça feedback claro sobre o que foi realizado

### Agendamentos
- Quando o usuário solicitar agendar algo, use a ferramenta de agendamento
- Confirme data, hora e descrição antes de criar o agendamento
- Forneça confirmação clara após criar o agendamento

## Tratamento de Erros
- Se uma ferramenta falhar, explique o problema de forma clara
- Ofereça alternativas quando possível
- Nunca invente informações ou confirmações falsas

## Privacidade e Segurança
- Respeite a privacidade dos dados do usuário
- Não compartilhe informações sensíveis
- Siga as políticas de uso da Ingrave Tecnologia
`,

          messages: convertToModelMessages(processedMessages),
          model,
          tools: allTools,
          // Type boundary: streamText expects specific tool types, but base class uses ToolSet
          // This is safe because our tools satisfy ToolSet interface (verified by 'satisfies' in tools.ts)
          onFinish: onFinish as unknown as StreamTextOnFinishCallback<
            typeof allTools
          >,
          stopWhen: stepCountIs(10)
        });

        writer.merge(result.toUIMessageStream());
      }
    });

    return createUIMessageStreamResponse({ stream });
  }
  async executeTask(description: string, _task: Schedule<string>) {
    await this.saveMessages([
      ...this.messages,
      {
        id: generateId(),
        role: "user",
        parts: [
          {
            type: "text",
            text: `Running scheduled task: ${description}`
          }
        ],
        metadata: {
          createdAt: new Date()
        }
      }
    ]);
  }

  /**
   * Process incoming message from Chatwoot and generate AI response
   */
  async processChatwootMessage(event: ChatwootWebhookEvent) {
    const uiMessage = chatwootMessageToUIMessage(event);
    if (!uiMessage) {
      return;
    }

    // Add the user message to conversation history
    await this.saveMessages([...this.messages, uiMessage]);

    // Collect all tools
    const allTools = {
      ...tools,
      ...this.mcp.getAITools()
    };

    // Clean up incomplete tool calls
    const cleanedMessages = cleanupMessages(this.messages);

    // Process pending tool calls
    const processedMessages = await processToolCalls({
      messages: cleanedMessages,
      dataStream: null,
      tools: allTools,
      executions
    });

    // Generate AI response
    const result = await streamText({
      system: `# Especialista em Vendas - Ingrave Tecnologia

Você é um assistente de vendas avançado especializado em consultoria de assinaturas para a Ingrave Tecnologia.

${getSchedulePrompt({ date: new Date() })}

## Contexto e Identidade

**Empresa**: Ingrave Tecnologia
**Website**: https://ingrave.com.br/planos
**Seu Papel**: Consultora de vendas dedicada e experiente
**Objetivo**: Ajudar clientes a escolherem o plano ideal para suas necessidades

### Características do Atendimento
- **Cordialidade**: Linguagem calorosa e acolhedora
- **Empatia**: Genuíno interesse nas necessidades do cliente
- **Abordagem Consultiva**: Focar em ajudar, não em forçar vendas
- **Comunicação Clara**: Explicações simples e diretas, evitando jargões técnicos
- **Atitude Positiva**: Sempre motivadora e encorajadora

## Catálogo de Produtos

### 1. Plano Básico - R$ 97,00/mês
**Público-alvo**: Iniciantes e pequenos negócios
**Recursos**:
- Funcionalidades essenciais para começar
- Suporte por email
- Até 1.000 contatos
- 1 usuário

### 2. Plano Profissional - R$ 197,00/mês (MAIS POPULAR)
**Público-alvo**: Empresas em crescimento
**Recursos**: Todos do Básico, mais:
- Suporte prioritário via chat
- Até 10.000 contatos
- 5 usuários
- Integrações avançadas
- Relatórios personalizados

### 3. Plano Empresarial - R$ 497,00/mês
**Público-alvo**: Grandes empresas
**Recursos**: Todos do Profissional, mais:
- Suporte VIP 24/7
- Contatos ilimitados
- Usuários ilimitados
- API completa
- Gerente de conta dedicado
- Treinamento personalizado
- SLA garantido

## Processo de Atendimento

### Etapa 1: Saudação e Descoberta
1. Cumprimente o cliente de forma amigável
2. Faça perguntas qualificadoras:
   - Tamanho do negócio e setor de atuação
   - Número de usuários que precisam acesso
   - Funcionalidades prioritárias
   - Volume de contatos/operações
   - Orçamento disponível

### Etapa 2: Análise e Recomendação
1. Analise as respostas do cliente
2. Identifique o plano mais adequado
3. Apresente sua recomendação com justificativa clara
4. Destaque benefícios específicos para o caso do cliente
5. Compare com outras opções se relevante

### Etapa 3: Esclarecimento de Dúvidas
1. Responda perguntas com transparência
2. Forneça exemplos práticos quando apropriado
3. Seja honesta sobre limitações
4. Ofereça alternativas quando necessário

### Etapa 4: Fechamento (quando o cliente decidir)
1. Confirme o plano escolhido
2. Colete o email do cliente (obrigatório para pagamento)
3. Use a ferramenta \`createPayment\` com os parâmetros corretos:
   - Básico: \`title="Plano Básico Ingrave - Mensal"\`, \`amount=97.00\`
   - Profissional: \`title="Plano Profissional Ingrave - Mensal"\`, \`amount=197.00\`
   - Empresarial: \`title="Plano Empresarial Ingrave - Mensal"\`, \`amount=497.00\`
4. Envie o link de pagamento de forma clara
5. Ofereça-se para esclarecer dúvidas

### Etapa 5: Pós-Venda
1. Agradeça pela confiança
2. Explique próximos passos:
   - Receberá email de confirmação
   - Acesso será liberado automaticamente
   - Instruções de configuração inicial
3. Ofereça suporte para dúvidas iniciais
4. Considere usar \`scheduleFollowUp\` para acompanhamento

## Diretrizes de Comunicação

### ✅ FAÇA:
- "Fico muito feliz em ajudá-lo! Para recomendar o melhor plano, poderia me contar sobre seu negócio?"
- "Baseado no que você compartilhou, acredito que o Plano Profissional seria ideal porque..."
- "Entendo sua situação. O Plano Básico é uma ótima forma de começar, com possibilidade de upgrade futuro!"

### ❌ EVITE:
- Pressão de vendas: "Compre agora", "Oferta por tempo limitado"
- Generalizações: "Esse é o melhor plano" (sem contexto)
- Linguagem técnica excessiva ou fria
- Fazer promessas sobre recursos não disponíveis

## Escalação para Humanos

Use a ferramenta \`escalateToHuman\` quando o cliente:
- Solicitar condições especiais de pagamento
- Precisar de recursos customizados não listados
- Tiver dúvidas técnicas complexas sobre infraestrutura
- Explicitamente pedir para falar com gerente/supervisor

## Ferramentas Disponíveis

- \`createPayment\`: Gera link de pagamento Mercado Pago
- \`escalateToHuman\`: Transfere para equipe humana
- \`scheduleFollowUp\`: Agenda acompanhamento futuro
- Ferramentas de agendamento: Para marcar demos ou reuniões

## Princípios Fundamentais

1. **Consultoria sobre Vendas**: Priorize o melhor interesse do cliente
2. **Transparência Total**: Seja honesta sobre capacidades e limitações
3. **Relacionamento de Longo Prazo**: Cada venda é o início de uma parceria
4. **Empatia Sempre**: Coloque-se no lugar do cliente
5. **Profissionalismo**: Mantenha sempre alta qualidade no atendimento

---

Lembre-se: Seu sucesso é medido pela satisfação do cliente e pela adequação do plano às necessidades dele, não apenas pelo valor da venda.`,
      messages: convertToModelMessages(processedMessages),
      model,
      tools: allTools,
      stopWhen: stepCountIs(10)
    });

    // Collect the full response text
    let fullResponse = "";
    for await (const chunk of result.textStream) {
      fullResponse += chunk;
    }

    // Save assistant's response to conversation history
    const assistantMessage = {
      id: generateId(),
      role: "assistant" as const,
      parts: [
        {
          type: "text" as const,
          text: fullResponse
        }
      ],
      metadata: {
        createdAt: new Date()
      }
    };

    await this.saveMessages([...this.messages, assistantMessage]);

    return fullResponse;
  }
}

/**
 * Worker entry point that routes incoming requests to the appropriate handler
 */
export default {
  async fetch(request: Request, env: Env, _ctx: ExecutionContext) {
    const url = new URL(request.url);

    // Health check for OpenAI key
    if (url.pathname === "/check-open-ai-key") {
      const hasOpenAIKey = !!process.env.OPENAI_API_KEY;
      return Response.json({
        success: hasOpenAIKey
      });
    }

    // R2 Storage endpoints
    if (url.pathname.startsWith("/r2/")) {
      const r2Manager = new R2StorageManager(env.R2_BUCKET);
      const key = url.pathname.slice(4); // Remove "/r2/" prefix

      switch (request.method) {
        case "PUT": {
          // Upload file
          try {
            const contentType =
              request.headers.get("content-type") || getContentType(key);
            const metadata: Record<string, string> = {};

            // Extract custom metadata from headers
            request.headers.forEach((headerValue, headerName) => {
              if (headerName.startsWith("x-metadata-")) {
                const metadataKey = headerName.substring(11);
                metadata[metadataKey] = headerValue;
              }
            });

            const fileInfo = await r2Manager.upload({
              key,
              data: request.body!,
              contentType,
              metadata: Object.keys(metadata).length > 0 ? metadata : undefined
            });

            return Response.json({
              success: true,
              message: `File ${key} uploaded successfully`,
              file: fileInfo
            });
          } catch (error) {
            return Response.json(
              {
                success: false,
                error: error instanceof Error ? error.message : "Upload failed"
              },
              { status: 500 }
            );
          }
        }

        case "GET": {
          // Download file
          try {
            const object = await r2Manager.download(key);
            if (!object) {
              return Response.json(
                { success: false, error: "File not found" },
                { status: 404 }
              );
            }

            return new Response(object.body, {
              headers: {
                "content-type":
                  object.httpMetadata?.contentType || "application/octet-stream",
                "content-length": object.size.toString(),
                "last-modified": object.uploaded.toUTCString(),
                etag: object.httpEtag
              }
            });
          } catch (error) {
            return Response.json(
              {
                success: false,
                error: error instanceof Error ? error.message : "Download failed"
              },
              { status: 500 }
            );
          }
        }

        case "DELETE": {
          // Delete file
          try {
            await r2Manager.delete(key);
            return Response.json({
              success: true,
              message: `File ${key} deleted successfully`
            });
          } catch (error) {
            return Response.json(
              {
                success: false,
                error: error instanceof Error ? error.message : "Delete failed"
              },
              { status: 500 }
            );
          }
        }

        case "HEAD": {
          // Get file info
          try {
            const fileInfo = await r2Manager.getFileInfo(key);
            if (!fileInfo) {
              return new Response(null, { status: 404 });
            }

            return new Response(null, {
              headers: {
                "content-type":
                  fileInfo.httpMetadata?.contentType || "application/octet-stream",
                "content-length": fileInfo.size.toString(),
                "last-modified": fileInfo.uploaded.toUTCString()
              }
            });
          } catch (error) {
            return new Response(null, { status: 500 });
          }
        }

        default:
          return Response.json(
            { success: false, error: `Method ${request.method} not allowed` },
            { status: 405, headers: { Allow: "GET, PUT, DELETE, HEAD" } }
          );
      }
    }

    // R2 List endpoint
    if (url.pathname === "/r2" && request.method === "GET") {
      try {
        const r2Manager = new R2StorageManager(env.R2_BUCKET);
        const prefix = url.searchParams.get("prefix") || undefined;
        const limit = url.searchParams.get("limit")
          ? parseInt(url.searchParams.get("limit")!)
          : undefined;
        const cursor = url.searchParams.get("cursor") || undefined;

        const result = await r2Manager.list({ prefix, limit, cursor });

        return Response.json({
          success: true,
          files: result.files,
          truncated: result.truncated,
          cursor: result.cursor
        });
      } catch (error) {
        return Response.json(
          {
            success: false,
            error: error instanceof Error ? error.message : "List failed"
          },
          { status: 500 }
        );
      }
    }

    // Queue endpoints
    if (url.pathname.startsWith("/queue/")) {
      const queueManager = new QueueManager(env.MY_QUEUE);
      const action = url.pathname.slice(7); // Remove "/queue/" prefix

      if (request.method !== "POST") {
        return Response.json(
          { success: false, error: "Method not allowed" },
          { status: 405, headers: { Allow: "POST" } }
        );
      }

      try {
        const body = (await request.json()) as any;

        switch (action) {
          case "send": {
            // Send a custom message
            const { type, data, metadata } = body;
            await queueManager.send({
              type: type || QueueMessageType.CUSTOM,
              timestamp: new Date().toISOString(),
              data,
              metadata
            });

            return Response.json({
              success: true,
              message: "Message queued successfully"
            });
          }

          case "webhook": {
            // Send a webhook message
            const { url: webhookUrl, method, headers, body: webhookBody, metadata } = body;

            if (!webhookUrl || !method) {
              return Response.json(
                { success: false, error: "url and method are required" },
                { status: 400 }
              );
            }

            await queueManager.sendWebhook(
              webhookUrl,
              method,
              headers || {},
              webhookBody,
              metadata
            );

            return Response.json({
              success: true,
              message: "Webhook message queued successfully"
            });
          }

          case "email": {
            // Send an email message
            const { to, from, subject, body: emailBody, html, metadata } = body;

            if (!to || !from || !subject || !emailBody) {
              return Response.json(
                { success: false, error: "to, from, subject, and body are required" },
                { status: 400 }
              );
            }

            await queueManager.sendEmail(to, from, subject, emailBody, html, metadata);

            return Response.json({
              success: true,
              message: "Email message queued successfully"
            });
          }

          case "notification": {
            // Send a notification message
            const { userId, title, message, priority, metadata } = body;

            if (!userId || !title || !message) {
              return Response.json(
                { success: false, error: "userId, title, and message are required" },
                { status: 400 }
              );
            }

            await queueManager.sendNotification(
              userId,
              title,
              message,
              priority || "medium",
              metadata
            );

            return Response.json({
              success: true,
              message: "Notification message queued successfully"
            });
          }

          case "task": {
            // Send a task message
            const { taskId, action: taskAction, payload, metadata } = body;

            if (!taskId || !taskAction || !payload) {
              return Response.json(
                { success: false, error: "taskId, action, and payload are required" },
                { status: 400 }
              );
            }

            await queueManager.sendTask(taskId, taskAction, payload, metadata);

            return Response.json({
              success: true,
              message: "Task message queued successfully"
            });
          }

          case "analytics": {
            // Send an analytics message
            const { event, properties, userId, metadata } = body;

            if (!event || !properties) {
              return Response.json(
                { success: false, error: "event and properties are required" },
                { status: 400 }
              );
            }

            await queueManager.sendAnalytics(event, properties, userId, metadata);

            return Response.json({
              success: true,
              message: "Analytics message queued successfully"
            });
          }

          case "batch": {
            // Send multiple messages in batch
            const { messages } = body;

            if (!Array.isArray(messages) || messages.length === 0) {
              return Response.json(
                { success: false, error: "messages array is required" },
                { status: 400 }
              );
            }

            await queueManager.sendBatch(messages);

            return Response.json({
              success: true,
              message: `${messages.length} messages queued successfully`
            });
          }

          default:
            return Response.json(
              { success: false, error: `Unknown action: ${action}` },
              { status: 404 }
            );
        }
      } catch (error) {
        return Response.json(
          {
            success: false,
            error: error instanceof Error ? error.message : "Queue operation failed"
          },
          { status: 500 }
        );
      }
    }

    // Chatwoot webhook endpoint
    if (url.pathname === "/chatwoot/webhook" && request.method === "POST") {
      try {
        // Validate webhook signature if configured
        const webhookSecret = process.env.CHATWOOT_WEBHOOK_SECRET;
        console.log("[Chatwoot] Webhook secret configured:", !!webhookSecret);
        console.log(
          "[Chatwoot] Webhook secret value:",
          webhookSecret ? "***" : "undefined"
        );

        const isValid = validateWebhookSignature(request, webhookSecret);
        console.log("[Chatwoot] Signature validation result:", isValid);

        if (!isValid) {
          console.log("[Chatwoot] Validation failed - returning 401");
          return new Response("Unauthorized", { status: 401 });
        }

        const event: ChatwootWebhookEvent = await request.json();

        console.log("[Chatwoot] Full webhook event:", JSON.stringify(event, null, 2));

        // Only process message_created events
        if (event.event !== "message_created") {
          console.log("[Chatwoot] Ignoring non-message_created event:", event.event);
          return Response.json({
            status: "ignored",
            reason: "not a message_created event"
          });
        }

        // Ignore outgoing messages (bot's own messages)
        if (event.message_type === "outgoing") {
          console.log("[Chatwoot] Ignoring outgoing message");
          return Response.json({
            status: "ignored",
            reason: "outgoing message"
          });
        }

        // Get or create agent for this conversation
        const conversationId = event.conversation?.id;
        if (!conversationId) {
          console.error("[Chatwoot] No conversation_id in event");
          return Response.json(
            { status: "error", reason: "no conversation_id" },
            { status: 400 }
          );
        }

        console.log("[Chatwoot] Processing message for conversation:", conversationId);
        console.log("[Chatwoot] Message content:", event.content);

        // Get Durable Object for this conversation
        const agentId = getChatwootAgentId(conversationId);
        const durableObjectId = env.Chat.idFromName(agentId);
        const agentStub = env.Chat.get(durableObjectId);

        console.log("[Chatwoot] Calling processChatwootMessage on Durable Object");
        // Process the message and generate response
        const response = await agentStub.processChatwootMessage(event);
        console.log("[Chatwoot] Response generated:", response ? "YES" : "NO");

        // Send response back to Chatwoot
        if (response) {
          console.log("[Chatwoot] Attempting to send response back to Chatwoot");
          // Only send if Chatwoot is fully configured
          if (
            process.env.CHATWOOT_BASE_URL &&
            process.env.CHATWOOT_API_KEY &&
            process.env.CHATWOOT_ACCOUNT_ID
          ) {
            console.log("[Chatwoot] Chatwoot credentials configured");
            const chatwootClient = new ChatwootClient(
              process.env.CHATWOOT_BASE_URL,
              process.env.CHATWOOT_API_KEY,
              process.env.CHATWOOT_ACCOUNT_ID
            );

            console.log("[Chatwoot] Sending message to conversation:", conversationId);
            await chatwootClient.sendMessage(conversationId, response);
            console.log("[Chatwoot] Message sent successfully!");
          } else {
            console.log(
              "[Chatwoot] Skipping response send - Chatwoot not configured"
            );
            console.log("[Chatwoot] Config check:", {
              hasBaseUrl: !!process.env.CHATWOOT_BASE_URL,
              hasApiKey: !!process.env.CHATWOOT_API_KEY,
              hasAccountId: !!process.env.CHATWOOT_ACCOUNT_ID
            });
          }
        } else {
          console.log("[Chatwoot] No response generated by AI");
        }

        return Response.json({ status: "success", response });
      } catch (error) {
        console.error("Error processing Chatwoot webhook:", error);
        return Response.json(
          {
            status: "error",
            message: error instanceof Error ? error.message : "Unknown error"
          },
          { status: 500 }
        );
      }
    }

    if (!process.env.OPENAI_API_KEY) {
      console.error(
        "OPENAI_API_KEY is not set, don't forget to set it locally in .dev.vars, and use `wrangler secret bulk .dev.vars` to upload it to production"
      );
    }
    return (
      // Route the request to our agent or return 404 if not found
      (await routeAgentRequest(request, env)) ||
      new Response("Not found", { status: 404 })
    );
  },

  /**
   * Queue consumer handler - processes messages from the queue
   */
  async queue(batch: MessageBatch, env: Env, _ctx: ExecutionContext) {
    const messageRouter = new MessageRouter();

    console.log(`[Queue] Processing batch of ${batch.messages.length} messages`);

    for (const message of batch.messages) {
      try {
        const queueMessage = message.body as QueueMessage;

        console.log(
          `[Queue] Processing message type: ${queueMessage.type} at ${queueMessage.timestamp}`
        );

        await messageRouter.processMessage(queueMessage);

        // Acknowledge the message
        message.ack();

        console.log(`[Queue] Message processed successfully`);
      } catch (error) {
        console.error(`[Queue] Error processing message:`, error);

        // Retry the message (it will be retried based on max_retries config)
        message.retry();
      }
    }

    console.log(`[Queue] Batch processing complete`);
  }
} satisfies ExportedHandler<Env>;

// Export workflow
export { CustomerSupportWorkflow } from "./workflows/customer-support";
