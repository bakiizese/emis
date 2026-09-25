'use client';

import { cn } from '@emis/ui/lib/cn';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

import { useInstitution } from '@/features/institution/use-institution';

export function SettingsNav() {
  const pathname = usePathname();
  const { term } = useInstitution();
  const items = [
    { href: '/settings', label: 'General' },
    { href: '/settings/branches', label: term('branch', true) },
    { href: '/settings/departments', label: term('department', true) },
    { href: '/settings/modules', label: 'Modules' },
    { href: '/settings/lists', label: 'Dropdown lists' },
    { href: '/settings/custom-fields', label: 'Custom fields' },
    { href: '/settings/terminology', label: 'Terminology' },
    { href: '/settings/numbering', label: 'Numbering' },
  ];

  return (
    <nav aria-label="Settings" className="flex gap-1 overflow-x-auto text-sm md:flex-col">
      {items.map((item) => {
        const current = pathname === item.href;
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

/** Title + one line of explanation at the top of each settings page. */
export function SettingsHeader({
  title,
  description,
  action,
}: {
  title: string;
  description: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div className="space-y-1">
        <h2 className="text-lg font-semibold tracking-tight">{title}</h2>
        <p className="text-muted-foreground max-w-prose text-sm">{description}</p>
      </div>
      {action}
    </div>
  );
}
