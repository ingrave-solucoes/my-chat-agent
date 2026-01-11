/**
 * Queue Manager for Cloudflare Queues
 * Handles message queuing and processing
 */

/**
 * Message types that can be sent to the queue
 */
export enum QueueMessageType {
  WEBHOOK = "webhook",
  EMAIL = "email",
  NOTIFICATION = "notification",
  TASK = "task",
  ANALYTICS = "analytics",
  CUSTOM = "custom"
}

/**
 * Base interface for queue messages
 */
export interface QueueMessage {
  type: QueueMessageType;
  timestamp: string;
  data: unknown;
  metadata?: Record<string, string>;
}

/**
 * Webhook message payload
 */
export interface WebhookMessage extends QueueMessage {
  type: QueueMessageType.WEBHOOK;
  data: {
    url: string;
    method: string;
    headers: Record<string, string>;
    body?: string;
  };
}

/**
 * Email message payload
 */
export interface EmailMessage extends QueueMessage {
  type: QueueMessageType.EMAIL;
  data: {
    to: string;
    from: string;
    subject: string;
    body: string;
    html?: string;
  };
}

/**
 * Notification message payload
 */
export interface NotificationMessage extends QueueMessage {
  type: QueueMessageType.NOTIFICATION;
  data: {
    userId: string;
    title: string;
    message: string;
    priority: "low" | "medium" | "high";
  };
}

/**
 * Task message payload
 */
export interface TaskMessage extends QueueMessage {
  type: QueueMessageType.TASK;
  data: {
    taskId: string;
    action: string;
    payload: Record<string, unknown>;
  };
}

/**
 * Analytics message payload
 */
export interface AnalyticsMessage extends QueueMessage {
  type: QueueMessageType.ANALYTICS;
  data: {
    event: string;
    properties: Record<string, unknown>;
    userId?: string;
  };
}

/**
 * Queue Manager class for sending and managing queue messages
 */
export class QueueManager {
  constructor(private queue: Queue) {}

  /**
   * Send a message to the queue
   */
  async send(message: QueueMessage, options?: QueueSendOptions): Promise<void> {
    await this.queue.send(message, options);
  }

  /**
   * Send multiple messages to the queue in batch
   */
  async sendBatch(
    messages: QueueMessage[],
    options?: QueueSendOptions
  ): Promise<void> {
    await this.queue.sendBatch(
      messages.map((msg) => ({
        body: msg,
        ...options
      }))
    );
  }

  /**
   * Send a webhook message
   */
  async sendWebhook(
    url: string,
    method: string,
    headers: Record<string, string>,
    body?: string,
    metadata?: Record<string, string>
  ): Promise<void> {
    const message: WebhookMessage = {
      type: QueueMessageType.WEBHOOK,
      timestamp: new Date().toISOString(),
      data: { url, method, headers, body },
      metadata
    };

    await this.send(message);
  }

  /**
   * Send an email message
   */
  async sendEmail(
    to: string,
    from: string,
    subject: string,
    body: string,
    html?: string,
    metadata?: Record<string, string>
  ): Promise<void> {
    const message: EmailMessage = {
      type: QueueMessageType.EMAIL,
      timestamp: new Date().toISOString(),
      data: { to, from, subject, body, html },
      metadata
    };

    await this.send(message);
  }

  /**
   * Send a notification message
   */
  async sendNotification(
    userId: string,
    title: string,
    messageText: string,
    priority: "low" | "medium" | "high" = "medium",
    metadata?: Record<string, string>
  ): Promise<void> {
    const message: NotificationMessage = {
      type: QueueMessageType.NOTIFICATION,
      timestamp: new Date().toISOString(),
      data: { userId, title, message: messageText, priority },
      metadata
    };

    await this.send(message);
  }

  /**
   * Send a task message
   */
  async sendTask(
    taskId: string,
    action: string,
    payload: Record<string, unknown>,
    metadata?: Record<string, string>
  ): Promise<void> {
    const message: TaskMessage = {
      type: QueueMessageType.TASK,
      timestamp: new Date().toISOString(),
      data: { taskId, action, payload },
      metadata
    };

    await this.send(message);
  }

  /**
   * Send an analytics event
   */
  async sendAnalytics(
    event: string,
    properties: Record<string, unknown>,
    userId?: string,
    metadata?: Record<string, string>
  ): Promise<void> {
    const message: AnalyticsMessage = {
      type: QueueMessageType.ANALYTICS,
      timestamp: new Date().toISOString(),
      data: { event, properties, userId },
      metadata
    };

    await this.send(message);
  }

  /**
   * Send a custom message
   */
  async sendCustom(
    data: unknown,
    metadata?: Record<string, string>
  ): Promise<void> {
    const message: QueueMessage = {
      type: QueueMessageType.CUSTOM,
      timestamp: new Date().toISOString(),
      data,
      metadata
    };

    await this.send(message);
  }
}

/**
 * Message processor interface for handling queue messages
 */
export interface MessageProcessor {
  process(message: QueueMessage): Promise<void>;
}

/**
 * Webhook message processor
 */
export class WebhookProcessor implements MessageProcessor {
  async process(message: QueueMessage): Promise<void> {
    if (message.type !== QueueMessageType.WEBHOOK) {
      throw new Error(`Invalid message type: ${message.type}`);
    }

    const webhookMsg = message as WebhookMessage;
    const { url, method, headers, body } = webhookMsg.data;

    console.log(`[Queue] Processing webhook: ${method} ${url}`);

    try {
      const response = await fetch(url, {
        method,
        headers,
        body: body ? body : undefined
      });

      if (!response.ok) {
        throw new Error(
          `Webhook failed with status ${response.status}: ${await response.text()}`
        );
      }

      console.log(`[Queue] Webhook processed successfully: ${url}`);
    } catch (error) {
      console.error(`[Queue] Webhook processing failed:`, error);
      throw error;
    }
  }
}

/**
 * Email message processor (placeholder - implement with your email service)
 */
export class EmailProcessor implements MessageProcessor {
  async process(message: QueueMessage): Promise<void> {
    if (message.type !== QueueMessageType.EMAIL) {
      throw new Error(`Invalid message type: ${message.type}`);
    }

    const emailMsg = message as EmailMessage;
    const { to, from, subject } = emailMsg.data;

    console.log(`[Queue] Processing email: ${subject} to ${to} from ${from}`);

    // TODO: Implement email sending logic with your email service
    // Example: SendGrid, Mailgun, AWS SES, etc.

    console.log(`[Queue] Email queued for processing`);
  }
}

/**
 * Notification message processor (placeholder)
 */
export class NotificationProcessor implements MessageProcessor {
  async process(message: QueueMessage): Promise<void> {
    if (message.type !== QueueMessageType.NOTIFICATION) {
      throw new Error(`Invalid message type: ${message.type}`);
    }

    const notificationMsg = message as NotificationMessage;
    const { userId, title, message: msg, priority } = notificationMsg.data;

    console.log(
      `[Queue] Processing notification: ${title} for user ${userId} (${priority} priority)`
    );

    // TODO: Implement notification logic
    // Example: Push notifications, in-app notifications, etc.

    console.log(`[Queue] Notification: ${msg}`);
  }
}

/**
 * Task message processor
 */
export class TaskProcessor implements MessageProcessor {
  async process(message: QueueMessage): Promise<void> {
    if (message.type !== QueueMessageType.TASK) {
      throw new Error(`Invalid message type: ${message.type}`);
    }

    const taskMsg = message as TaskMessage;
    const { taskId, action, payload } = taskMsg.data;

    console.log(`[Queue] Processing task ${taskId}: ${action}`);

    // TODO: Implement task processing logic based on action
    // Example: data processing, report generation, etc.

    console.log(`[Queue] Task payload:`, payload);
  }
}

/**
 * Analytics message processor
 */
export class AnalyticsProcessor implements MessageProcessor {
  async process(message: QueueMessage): Promise<void> {
    if (message.type !== QueueMessageType.ANALYTICS) {
      throw new Error(`Invalid message type: ${message.type}`);
    }

    const analyticsMsg = message as AnalyticsMessage;
    const { event, properties, userId } = analyticsMsg.data;

    console.log(
      `[Queue] Processing analytics event: ${event}${userId ? ` for user ${userId}` : ""}`
    );

    // TODO: Implement analytics tracking
    // Example: Google Analytics, Mixpanel, Segment, etc.

    console.log(`[Queue] Analytics properties:`, properties);
  }
}

/**
 * Main message processor that routes messages to appropriate handlers
 */
export class MessageRouter {
  private processors: Map<QueueMessageType, MessageProcessor>;

  constructor() {
    this.processors = new Map();

    // Register default processors
    this.registerProcessor(QueueMessageType.WEBHOOK, new WebhookProcessor());
    this.registerProcessor(QueueMessageType.EMAIL, new EmailProcessor());
    this.registerProcessor(
      QueueMessageType.NOTIFICATION,
      new NotificationProcessor()
    );
    this.registerProcessor(QueueMessageType.TASK, new TaskProcessor());
    this.registerProcessor(
      QueueMessageType.ANALYTICS,
      new AnalyticsProcessor()
    );
  }

  /**
   * Register a custom processor for a message type
   */
  registerProcessor(type: QueueMessageType, processor: MessageProcessor): void {
    this.processors.set(type, processor);
  }

  /**
   * Process a message by routing it to the appropriate processor
   */
  async processMessage(message: QueueMessage): Promise<void> {
    const processor = this.processors.get(message.type);

    if (!processor) {
      console.warn(
        `[Queue] No processor found for message type: ${message.type}`
      );
      return;
    }

    try {
      await processor.process(message);
    } catch (error) {
      console.error(
        `[Queue] Error processing message type ${message.type}:`,
        error
      );
      throw error;
    }
  }

  /**
   * Process a batch of messages
   */
  async processBatch(messages: QueueMessage[]): Promise<void> {
    const results = await Promise.allSettled(
      messages.map((msg) => this.processMessage(msg))
    );

    const failures = results.filter((r) => r.status === "rejected");
    if (failures.length > 0) {
      console.error(
        `[Queue] ${failures.length} out of ${messages.length} messages failed to process`
      );
    }
  }
}
