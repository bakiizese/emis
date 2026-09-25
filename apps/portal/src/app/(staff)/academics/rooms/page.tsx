import type { Metadata } from 'next';

import { RoomsScreen } from '@/features/academics/rooms-screen';

export const metadata: Metadata = { title: 'Rooms · Academics' };

export default function Page() {
  return <RoomsScreen />;
}
