import type { Metadata } from 'next';

import { ApplicationDetailScreen } from '@/features/admissions/application-detail-screen';

export const metadata: Metadata = { title: 'Application · EMIS' };

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <ApplicationDetailScreen applicationId={id} />;
}
