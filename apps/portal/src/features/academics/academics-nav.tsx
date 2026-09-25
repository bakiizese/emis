'use client';

import { cn } from '@emis/ui/lib/cn';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

import { useInstitution } from '@/features/institution/use-institution';

export function AcademicsNav() {
  const pathname = usePathname();
  const { term } = useInstitution();
  const items = [
    {
      href: '/academics',
      label: term('program', true),
      match: (p: string) => p === '/academics' || p.startsWith('/academics/programs'),
    },
    { href: '/academics/years', label: 'Academic years' },
    { href: '/academics/intakes', label: term('intake', true) },
    { href: '/academics/holidays', label: 'Holidays' },
    { href: '/academics/shifts', label: term('shift', true) },
    { href: '/academics/rooms', label: 'Rooms' },
  ];

  return (
    <nav aria-label="Academics" className="flex gap-1 overflow-x-auto text-sm md:flex-col">
      {items.map((item) => {
        const current = item.match ? item.match(pathname) : pathname === item.href;
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
