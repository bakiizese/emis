import { BILLING_ERROR_CODES as c } from '@emis/contracts';
import {
  ConflictException,
  ForbiddenException,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';

export const billingErrors = {
  feeStructureNotFound: () =>
    new NotFoundException({ code: c.feeStructureNotFound, message: 'Fee structure not found.' }),
  paymentPlanNotFound: () =>
    new NotFoundException({ code: c.paymentPlanNotFound, message: 'Payment plan not found.' }),
  feeStructureExists: () =>
    new ConflictException({
      code: c.feeStructureExists,
      message: 'There is already a fee structure for that course, category and start date.',
    }),
  codeTaken: (what: string) =>
    new ConflictException({
      code: c.codeTaken,
      message: `A ${what} with that name already exists.`,
    }),
  noFeeStructure: () =>
    new UnprocessableEntityException({
      code: c.noFeeStructure,
      message: 'No fee is set up for this course yet. Add a fee structure first.',
    }),
  noPaymentPlan: () =>
    new UnprocessableEntityException({
      code: c.noPaymentPlan,
      message: 'There is no payment plan to split the invoice by. Add one (and mark a default).',
    }),
  invoiceNotFound: () =>
    new NotFoundException({ code: c.invoiceNotFound, message: 'Invoice not found.' }),
  alreadyInvoiced: () =>
    new ConflictException({
      code: c.alreadyInvoiced,
      message: 'This enrollment already has an invoice.',
    }),
  enrollmentNotBillable: () =>
    new UnprocessableEntityException({
      code: c.enrollmentNotBillable,
      message: 'Only students who have a seat (or finished the class) can be invoiced.',
    }),
  paymentNotFound: () =>
    new NotFoundException({ code: c.paymentNotFound, message: 'Payment not found.' }),
  invoiceClosed: () =>
    new ConflictException({
      code: c.invoiceClosed,
      message: 'This invoice is already fully paid or void, so nothing more can be applied to it.',
    }),
  overpayment: (balance: number) =>
    new UnprocessableEntityException({
      code: c.overpayment,
      message: `That is more than the invoice still owes (${(balance / 100).toFixed(2)}).`,
    }),
  unknownProvider: (key: string) =>
    new UnprocessableEntityException({
      code: c.unknownProvider,
      message: `Payments can't be taken through "${key}" here.`,
    }),
  unsupportedMethod: (provider: string, method: string) =>
    new UnprocessableEntityException({
      code: c.unsupportedMethod,
      message: `${provider} doesn't take ${method.replaceAll('_', ' ')} payments.`,
    }),
  paymentNotPosted: () =>
    new ConflictException({
      code: c.paymentNotPosted,
      message: 'This payment has already been voided.',
    }),
  approvalNotFound: () =>
    new NotFoundException({ code: c.approvalNotFound, message: 'Request not found.' }),
  approvalDecided: () =>
    new ConflictException({
      code: c.approvalDecided,
      message: 'This request has already been decided.',
    }),
  selfApproval: () =>
    new ForbiddenException({
      code: c.selfApproval,
      message: "You can't approve or reject your own request. Someone else needs to decide it.",
    }),
  requestPending: () =>
    new ConflictException({
      code: c.requestPending,
      message: 'There is already a request waiting for a decision on this.',
    }),
  discountTooSmall: () =>
    new UnprocessableEntityException({
      code: 'DISCOUNT_TOO_SMALL',
      message: 'That discount comes to nothing. Enter a larger amount or percentage.',
    }),
  discountTooLarge: () =>
    new UnprocessableEntityException({
      code: c.discountTooLarge,
      message: 'That discount is more than what is still unpaid on the invoice.',
    }),
};
