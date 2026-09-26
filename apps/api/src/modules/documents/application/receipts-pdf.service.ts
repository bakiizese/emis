import type { Payment, ReceiptFormat } from '@emis/contracts';
import type { Grant } from '@emis/permissions';
import { Inject, Injectable } from '@nestjs/common';

import { PaymentsService } from '../../billing/index.js';
import { receiptA5, receiptThermal } from '../domain/templates.js';
import { PDF_RENDERER, type PdfRenderer } from '../infrastructure/pdf-renderer.js';
import { DocumentContext } from './document-context.js';

/** Prints a payment's receipt: A5 for handing over, 80 mm for a thermal printer. */
@Injectable()
export class ReceiptsPdfService {
  constructor(
    private readonly payments: PaymentsService,
    private readonly context: DocumentContext,
    @Inject(PDF_RENDERER) private readonly renderer: PdfRenderer,
  ) {}

  async render(paymentId: string, format: ReceiptFormat, grants: readonly Grant[]) {
    // `get` also checks the caller may see this branch's payments.
    const payment: Payment = await this.payments.get(paymentId, grants);
    const data = {
      letterhead: await this.context.letterhead(),
      receiptNumber: payment.receiptNumber,
      date: await this.context.dateTime(new Date(payment.receivedAt)),
      studentName: payment.studentName,
      invoiceNumber: payment.invoiceNumber,
      method: payment.method.replaceAll('_', ' '),
      reference: payment.reference,
      amountText: this.context.money(payment.amount, payment.currency),
      allocations: payment.allocations.map((a) => ({
        label: `Instalment ${a.sequence}`,
        amountText: this.context.money(a.amount, payment.currency),
      })),
      status: payment.status,
      voidedOn: payment.voidedAt ? await this.context.date(new Date(payment.voidedAt)) : null,
    };
    const html = format === 'thermal' ? receiptThermal(data) : receiptA5(data);
    return {
      pdf: await this.renderer.render(html),
      filename: `receipt-${payment.receiptNumber}-${format}.pdf`,
    };
  }
}
