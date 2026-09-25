'use client';

import {
  approvalListResponseSchema,
  feeStructureListResponseSchema,
  invoiceListResponseSchema,
  invoiceSchema,
  paymentListResponseSchema,
  paymentPlanListResponseSchema,
  paymentSchema,
} from '@emis/contracts';
import { useQuery } from '@tanstack/react-query';

import { apiRequest } from '@/lib/api';

export const useInvoice = (id: string) =>
  useQuery({
    queryKey: ['invoices', 'one', id],
    queryFn: () => apiRequest(`/invoices/${id}`, { schema: invoiceSchema }),
  });

export const useStudentInvoices = (studentId: string, enabled: boolean) =>
  useQuery({
    queryKey: ['invoices', 'student', studentId],
    queryFn: () =>
      apiRequest(`/invoices?studentId=${studentId}&limit=100`, {
        schema: invoiceListResponseSchema,
      }),
    enabled,
  });

export const useInvoicePayments = (invoiceId: string) =>
  useQuery({
    queryKey: ['payments', 'invoice', invoiceId],
    queryFn: () =>
      apiRequest(`/payments?invoiceId=${invoiceId}&limit=100`, {
        schema: paymentListResponseSchema,
      }),
  });

export const usePayment = (id: string) =>
  useQuery({
    queryKey: ['payments', 'one', id],
    queryFn: () => apiRequest(`/payments/${id}`, { schema: paymentSchema }),
  });

export const useApprovals = (status: 'pending' | 'history') =>
  useQuery({
    queryKey: ['approvals', status],
    queryFn: () =>
      apiRequest(`/approvals?limit=100${status === 'pending' ? '&status=pending' : ''}`, {
        schema: approvalListResponseSchema,
      }),
    select: (data) =>
      status === 'history'
        ? { ...data, items: data.items.filter((a) => a.status !== 'pending') }
        : data,
  });

export const useFeeStructures = () =>
  useQuery({
    queryKey: ['fee-structures'],
    queryFn: () => apiRequest('/fee-structures', { schema: feeStructureListResponseSchema }),
  });

export const usePaymentPlans = () =>
  useQuery({
    queryKey: ['payment-plans'],
    queryFn: () => apiRequest('/payment-plans', { schema: paymentPlanListResponseSchema }),
  });
