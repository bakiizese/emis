import type { PaymentMethod } from '@emis/contracts';

/**
 * A way of taking money. Only the Manual provider (cash, bank transfer and cheque recorded by
 * staff) exists today. An online provider (Chapa, telebirr, Stripe…) is added later by writing
 * another implementation and listing it in PaymentProviders: payments, allocation and receipts
 * don't change, only where the confirmation comes from.
 */
export interface PaymentProvider {
  readonly key: string;
  readonly name: string;
  readonly capabilities: { online: boolean; refunds: boolean; webhooks: boolean };
  /** The methods staff can choose when recording a payment through this provider. */
  readonly methods: readonly PaymentMethod[];
}

/** Cash, bank transfers and cheques recorded by front-desk staff: confirmed the moment they're entered. */
export const manualProvider: PaymentProvider = {
  key: 'manual',
  name: 'Manual',
  capabilities: { online: false, refunds: false, webhooks: false },
  methods: ['cash', 'bank_transfer', 'cheque'],
};

export class PaymentProviders {
  private readonly providers = new Map<string, PaymentProvider>();

  constructor(providers: readonly PaymentProvider[]) {
    for (const provider of providers) this.providers.set(provider.key, provider);
  }

  find(key: string): PaymentProvider | undefined {
    return this.providers.get(key);
  }

  keys(): string[] {
    return [...this.providers.keys()];
  }
}

export const defaultProviders = () => new PaymentProviders([manualProvider]);
