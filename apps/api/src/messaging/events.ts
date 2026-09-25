/** What travels from the outbox to handlers. `payload` is decrypted before handlers see it. */
export interface DomainEvent<TPayload = Record<string, unknown>> {
  id: string;
  type: string;
  payload: TPayload;
  occurredAt: string;
  correlationId: string | null;
  actorUserId: string | null;
}

/**
 * Reacts to one event type in the worker. Handlers must tolerate redelivery: the dispatcher
 * guarantees each (handler, event) pair commits at most once, but external calls such as sending
 * an email are at-least-once if the process dies between the call and the commit.
 */
export interface EventHandler<TPayload = Record<string, unknown>> {
  /** Stable name, used as the inbox consumer key. Never rename a deployed handler. */
  readonly name: string;
  readonly eventType: string;
  handle(event: DomainEvent<TPayload>): Promise<void>;
}

export const EVENT_HANDLERS = Symbol('EVENT_HANDLERS');

export const QUEUES = {
  events: 'domain-events',
  maintenance: 'maintenance',
} as const;
