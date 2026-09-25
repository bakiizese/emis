import { PAYMENT_METHODS } from '@emis/contracts';
import { describe, expect, it } from 'vitest';

import { defaultProviders, manualProvider, PaymentProviders } from './providers.js';

describe('payment providers', () => {
  it('ships only the manual provider, which takes every method staff can record', () => {
    const providers = defaultProviders();
    expect(providers.keys()).toEqual(['manual']);
    expect(providers.find('manual')).toBe(manualProvider);
    expect([...manualProvider.methods].sort()).toEqual([...PAYMENT_METHODS].sort());
    expect(manualProvider.capabilities).toEqual({ online: false, refunds: false, webhooks: false });
  });

  it('does not know providers that were never registered', () => {
    expect(defaultProviders().find('chapa')).toBeUndefined();
  });

  it('accepts another provider without touching the rest', () => {
    const online = {
      key: 'chapa',
      name: 'Chapa',
      capabilities: { online: true, refunds: true, webhooks: true },
      methods: [] as const,
    };
    expect(new PaymentProviders([manualProvider, online]).find('chapa')).toBe(online);
  });
});
