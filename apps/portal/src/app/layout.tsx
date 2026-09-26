import type { Metadata } from 'next';
import type { ReactNode } from 'react';

import { Providers } from './providers';
import './globals.css';

// Every page is rendered per request so the security policy's one-time nonce can be stamped on its scripts.
export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'EMIS Portal',
  description: 'Staff portal for admissions, records, finance and analytics',
  robots: { index: false, follow: false },
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-dvh font-sans antialiased">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
