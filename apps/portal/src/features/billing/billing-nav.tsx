'use client';

import { cn } from '@emis/ui/lib/cn';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

import { useSession } from '@/features/session/use-session';

export function BillingNav() {
  const pathname = usePathname();
  const { can } = useSession();
  const items = [
    {
      href: '/billing',
      label: 'Invoices',
      show: can('billing.read'),
      match: (p: string) =>
        p === '/billing' || p.startsWith('/billing/invoices') || p.startsWith('/billing/receipts'),
    },
    { href: '/billing/approvals', label: 'Approvals', show: can('billing.request') },
    { href: '/billing/fees', label: 'Fees and plans', show: can('fees.read') },
  ].filter((item) => item.show);

  return (
    <nav
      aria-label="Billing"
      className="flex gap-1 overflow-x-auto text-sm md:flex-col print:hidden"
    >
      {items.map((item) => {
        const current = item.match ? item.match(pathname) : pathname.startsWith(item.href);
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={current ? 'page' : undefined}
            className={cn(
              'text-muted-foreground hover:text-foreground rounded-md px-3 py-1.5 whitespace-nowrap',
              current && 'bg-muted text-foreground font-medium',
            )}
          >
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
