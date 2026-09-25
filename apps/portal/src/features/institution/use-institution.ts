'use client';

import {
  defaultTerminology,
  type ModuleKey,
  type PublicProfile,
  publicProfileSchema,
  type TermKey,
} from '@emis/contracts';
import { useQuery } from '@tanstack/react-query';

import { apiRequest } from '@/lib/api';

export const INSTITUTION_QUERY_KEY = ['institution', 'public'] as const;

/**
 * Name, branding, wording and module switches of this install. Public, so the sign-in pages
 * can use it too. Settings screens invalidate `['institution']` after a change.
 */
export function useInstitution() {
  const query = useQuery({
    queryKey: INSTITUTION_QUERY_KEY,
    queryFn: () => apiRequest('/institution/public', { schema: publicProfileSchema }),
    staleTime: 5 * 60_000,
  });
  const profile: PublicProfile | undefined = query.data;
  const terms = profile?.terminology ?? defaultTerminology();

  return {
    profile,
    loading: query.isPending,
    /** The institution's word for a thing, e.g. term('cohort', true) → "Batches". */
    term: (key: TermKey, plural = false) => (plural ? terms[key].plural : terms[key].singular),
    /** Unknown until loaded; treat modules as on until told otherwise. */
    moduleOn: (key: ModuleKey) => profile?.modules[key] ?? true,
  };
}
