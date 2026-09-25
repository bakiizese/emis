import type { Metadata } from 'next';

import { StudentDetailScreen } from '@/features/students/student-detail-screen';

export const metadata: Metadata = { title: 'Student · EMIS' };

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <StudentDetailScreen studentId={id} />;
}
