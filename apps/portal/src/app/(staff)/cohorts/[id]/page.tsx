import type { Metadata } from 'next';

import { CohortDetailScreen } from '@/features/cohorts/cohort-detail-screen';

export const metadata: Metadata = { title: 'Cohort · EMIS' };

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <CohortDetailScreen cohortId={id} />;
}
