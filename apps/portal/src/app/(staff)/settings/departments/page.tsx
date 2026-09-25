import type { Metadata } from 'next';

import { DepartmentsScreen } from '@/features/settings/departments-screen';

export const metadata: Metadata = { title: 'Departments · Settings' };

export default function Page() {
  return <DepartmentsScreen />;
}
