import type { Metadata } from 'next';

import { CohortsScreen } from '@/features/cohorts/cohorts-screen';

export const metadata: Metadata = { title: 'Cohorts · EMIS' };

export default function Page() {
  return <CohortsScreen />;
}
