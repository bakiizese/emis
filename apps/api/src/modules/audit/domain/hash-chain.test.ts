import { describe, expect, it } from 'vitest';

import { type AuditContent, canonicalJson, chainHash } from './hash-chain.js';

const entry: AuditContent = {
  occurredAt: '2026-09-25T10:00:00.000Z',
  actorUserId: '0199a1b2-0000-7000-8000-000000000001',
  actorEmail: 'admin@lingua.test',
  action: 'user.disabled',
  entityType: 'user',
  entityId: '0199a1b2-0000-7000-8000-000000000002',
  changes: { status: { from: 'active', to: 'disabled' } },
  requestId: 'req-1',
  ipAddress: '10.0.0.1',
  userAgent: null,
};

describe('canonicalJson', () => {
  it('ignores key order at every level', () => {
    expect(canonicalJson({ b: 1, a: { d: [1, { z: 1, y: 2 }], c: null } })).toBe(
      canonicalJson({ a: { c: null, d: [1, { y: 2, z: 1 }] }, b: 1 }),
    );
  });
});

describe('chainHash', () => {
  it('is deterministic', () => {
    expect(chainHash(entry, null)).toBe(chainHash({ ...entry }, null));
  });

  it('changes when any field or the previous hash changes', () => {
    const base = chainHash(entry, 'abc');
    expect(chainHash({ ...entry, action: 'user.enabled' }, 'abc')).not.toBe(base);
    expect(
      chainHash({ ...entry, changes: { status: { from: 'active', to: 'active' } } }, 'abc'),
    ).not.toBe(base);
    expect(chainHash(entry, 'abd')).not.toBe(base);
  });
});
