import type { Metadata } from 'next';

import { ApplicationsScreen } from '@/features/admissions/applications-screen';

export const metadata: Metadata = { title: 'Admissions · EMIS' };

export default function Page() {
  return <ApplicationsScreen />;
}
