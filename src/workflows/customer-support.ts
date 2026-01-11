import {
  WorkflowEntrypoint,
  WorkflowEvent,
  WorkflowStep
} from "cloudflare:workers";

/**
 * Workflow parameters for customer support automation
 */
export interface CustomerSupportParams {
  conversationId: number;
  customerId: number;
  action: "follow_up" | "escalate" | "send_survey";
  delayMinutes?: number;
  message?: string;
}

/**
 * Customer Support Workflow
 * Automates follow-ups, escalations, and surveys
 */
export class CustomerSupportWorkflow extends WorkflowEntrypoint<
  Env,
  CustomerSupportParams
> {
  async run(event: WorkflowEvent<CustomerSupportParams>, step: WorkflowStep) {
    const { conversationId, customerId, action, delayMinutes, message } =
      event.params;

    // Step 1: Log workflow start
    await step.do("log-workflow-start", async () => {
      console.log(
        `[Workflow] Starting ${action} for conversation ${conversationId}`
      );
      return { status: "started", timestamp: new Date().toISOString() };
    });

    // Step 2: Apply delay if specified
    if (delayMinutes && delayMinutes > 0) {
      await step.sleep("wait-delay", `${delayMinutes} minutes`);
    }

    // Step 3: Execute action based on type
    const result = await step.do("execute-action", async () => {
      switch (action) {
        case "follow_up":
          // Send follow-up message after delay
          return {
            action: "follow_up",
            conversationId,
            message: message || "Olá! Como posso ajudar mais?",
            timestamp: new Date().toISOString()
          };

        case "escalate":
          // Escalate to human agent
          return {
            action: "escalate",
            conversationId,
            customerId,
            reason: message || "Escalated by automated workflow",
            timestamp: new Date().toISOString()
          };

        case "send_survey":
          // Send satisfaction survey
          return {
            action: "send_survey",
            conversationId,
            message:
              message ||
              "Por favor, avalie nosso atendimento de 1 a 5 estrelas.",
            timestamp: new Date().toISOString()
          };

        default:
          throw new Error(`Unknown action: ${action}`);
      }
    });

    // Step 4: Log completion
    await step.do("log-completion", async () => {
      console.log(
        `[Workflow] Completed ${action} for conversation ${conversationId}`
      );
      return { status: "completed", result };
    });

    return result;
  }
}
