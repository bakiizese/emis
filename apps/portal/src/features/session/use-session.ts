'use client';

import { meResponseSchema, myAccessResponseSchema } from '@emis/contracts';
import type { Permission } from '@emis/permissions';
import { useQuery } from '@tanstack/react-query';

import { apiRequest } from '@/lib/api';

/** The signed-in person and what they may do. Screens hide what the API would refuse anyway. */
export function useSession() {
  const me = useQuery({
    queryKey: ['me'],
    queryFn: () => apiRequest('/auth/me', { schema: meResponseSchema }),
  });
  const access = useQuery({
    queryKey: ['access'],
    queryFn: () => apiRequest('/access/me', { schema: myAccessResponseSchema }),
    enabled: me.data?.nextStep === 'none',
  });

  const permissions = new Set(access.data?.permissions ?? []);
  return {
    me: me.data,
    access: access.data,
    error: me.error ?? access.error,
    loading: me.isPending || (me.data?.nextStep === 'none' && access.isPending),
    can: (permission: Permission) => permissions.has(permission),
  };
}
