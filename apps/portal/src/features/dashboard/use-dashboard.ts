'use client';

import { dashboardSchema } from '@emis/contracts';
import { useQuery } from '@tanstack/react-query';

import { apiRequest } from '@/lib/api';

/** The home page numbers, refreshed every minute while the page is open. */
export function useDashboard() {
  return useQuery({
    queryKey: ['dashboard'],
    queryFn: () => apiRequest('/dashboard', { schema: dashboardSchema }),
    refetchInterval: 60_000,
  });
}
