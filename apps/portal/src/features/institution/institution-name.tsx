'use client';

import { useInstitution } from './use-institution';

/** The institution's name for page chrome, falling back to the product name while loading. */
export function InstitutionName({ className }: { className?: string }) {
  const { profile } = useInstitution();
  return <p className={className}>{profile?.setupCompleted ? profile.name : 'EMIS'}</p>;
}
