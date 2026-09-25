import { describe, expect, it } from 'vitest';

import { healthStatusSchema } from './health.js';

describe('healthStatusSchema', () => {
  it('accepts a valid health payload', () => {
    const parsed = healthStatusSchema.parse({
      status: 'ok',
      service: 'api',
      version: '0.0.0',
      uptimeSeconds: 12.5,
    });
    expect(parsed.status).toBe('ok');
  });

  it('rejects a negative uptime', () => {
    const result = healthStatusSchema.safeParse({
      status: 'ok',
      service: 'api',
      version: '0.0.0',
      uptimeSeconds: -1,
    });
    expect(result.success).toBe(false);
  });
});
