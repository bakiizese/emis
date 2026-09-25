'use client';

import { branchListResponseSchema, departmentListResponseSchema } from '@emis/contracts';
import type { Scope } from '@emis/permissions';
import { useQuery } from '@tanstack/react-query';

import { apiRequest } from '@/lib/api';

import { useInstitution } from './use-institution';

export function useBranches(enabled = true) {
  return useQuery({
    queryKey: ['branches'],
    queryFn: () => apiRequest('/branches', { schema: branchListResponseSchema }),
    enabled,
  });
}

export function useDepartments(enabled = true) {
  return useQuery({
    queryKey: ['departments'],
    queryFn: () => apiRequest('/departments', { schema: departmentListResponseSchema }),
    enabled,
  });
}

/** "Whole institution", "Bole campus (branch)"… for showing where a role applies. */
export function useScopeLabel(enabled = true) {
  const { term } = useInstitution();
  const branches = useBranches(enabled);
  const departments = useDepartments(enabled);

  return (scope: Scope): string => {
    if (scope.type === 'global') return 'Whole institution';
    const list = scope.type === 'branch' ? branches.data?.items : departments.data?.items;
    const name = list?.find((unit) => unit.id === scope.id)?.name ?? 'Unknown';
    return `${name} (${term(scope.type).toLowerCase()})`;
  };
}
