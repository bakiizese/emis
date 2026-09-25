import type { Metadata } from 'next';

import { ProgramDetailScreen } from '@/features/academics/program-detail-screen';

export const metadata: Metadata = { title: 'Program · Academics' };

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <ProgramDetailScreen programId={id} />;
}
