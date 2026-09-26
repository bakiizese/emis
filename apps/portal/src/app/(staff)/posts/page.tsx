import type { Metadata } from 'next';

import { PostsScreen } from '@/features/posts/posts-screen';

export const metadata: Metadata = { title: 'News' };

export default function Page() {
  return <PostsScreen />;
}
