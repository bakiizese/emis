import type { Metadata } from 'next';

import { StudentImportScreen } from '@/features/students/import-screen';

export const metadata: Metadata = { title: 'Import students' };

export default function Page() {
  return <StudentImportScreen />;
}
