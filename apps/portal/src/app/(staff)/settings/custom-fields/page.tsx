import type { Metadata } from 'next';

import { CustomFieldsScreen } from '@/features/settings/custom-fields-screen';

export const metadata: Metadata = { title: 'Custom fields · Settings' };

export default function Page() {
  return <CustomFieldsScreen />;
}
