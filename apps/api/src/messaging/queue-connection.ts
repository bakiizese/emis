import type { ConnectionOptions } from 'bullmq';

import type { Env } from '../config/env.js';

/** BullMQ connection to Valkey. Workers need `maxRetriesPerRequest: null` to block on queues. */
export function queueConnection(env: Env): ConnectionOptions {
  if (!env.VALKEY_URL) throw new Error('VALKEY_URL is required to run the worker');
  return { url: env.VALKEY_URL, maxRetriesPerRequest: null };
}
