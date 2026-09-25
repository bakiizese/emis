import type { Metadata } from 'next';

import { StudentsScreen } from '@/features/students/students-screen';

export const metadata: Metadata = { title: 'Students · EMIS' };

export default function Page() {
  return <StudentsScreen />;
}
