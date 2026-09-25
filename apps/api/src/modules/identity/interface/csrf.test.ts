import type { FastifyRequest } from 'fastify';
import { describe, expect, it } from 'vitest';

import { isCrossSiteRequest } from './csrf.js';

const trusted = ['https://portal.lingua.et'];

function request(method: string, headers: Record<string, string>): FastifyRequest {
  return { method, headers, protocol: 'https', host: 'api.lingua.et' } as unknown as FastifyRequest;
}

describe('isCrossSiteRequest', () => {
  it('never blocks safe methods', () => {
    expect(isCrossSiteRequest(request('GET', { origin: 'https://evil.example' }), trusted)).toBe(
      false,
    );
  });

  it('blocks state changes from untrusted origins', () => {
    expect(isCrossSiteRequest(request('POST', { origin: 'https://evil.example' }), trusted)).toBe(
      true,
    );
    expect(isCrossSiteRequest(request('POST', { 'sec-fetch-site': 'cross-site' }), trusted)).toBe(
      true,
    );
  });

  it('allows the trusted frontend and the API itself', () => {
    expect(
      isCrossSiteRequest(
        request('POST', { origin: 'https://portal.lingua.et', 'sec-fetch-site': 'same-site' }),
        trusted,
      ),
    ).toBe(false);
    expect(isCrossSiteRequest(request('POST', { origin: 'https://api.lingua.et' }), trusted)).toBe(
      false,
    );
    expect(isCrossSiteRequest(request('POST', { 'sec-fetch-site': 'same-origin' }), trusted)).toBe(
      false,
    );
  });

  it('allows non-browser clients (no Origin, no fetch metadata)', () => {
    expect(isCrossSiteRequest(request('POST', {}), trusted)).toBe(false);
  });
});
