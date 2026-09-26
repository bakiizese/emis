import Link from 'next/link';

import { LinkButton } from './link-button';

export function SiteHeader({
  name,
  coursesLabel,
  canRegister,
}: {
  name: string;
  coursesLabel: string;
  canRegister: boolean;
}) {
  return (
    <header className="border-border bg-background/90 sticky top-0 z-10 border-b backdrop-blur">
      <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-3">
        <Link href="/" className="text-primary text-lg font-semibold tracking-tight">
          {name}
        </Link>
        <nav aria-label="Main" className="flex items-center gap-1 text-sm sm:gap-3">
          <Link href="/courses" className="hover:bg-secondary rounded-md px-3 py-2">
            {coursesLabel}
          </Link>
          <Link href="/contact" className="hover:bg-secondary rounded-md px-3 py-2">
            Contact
          </Link>
          {canRegister ? <LinkButton href="/pre-register">Pre-register</LinkButton> : null}
        </nav>
      </div>
    </header>
  );
}
