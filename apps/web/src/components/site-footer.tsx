import type { PublicContact } from '@emis/contracts';
import Link from 'next/link';

export function SiteFooter({
  name,
  contact,
  hasNews,
}: {
  name: string;
  contact: PublicContact | null;
  hasNews: boolean;
}) {
  return (
    <footer className="border-border bg-muted mt-16 border-t">
      <div className="mx-auto grid max-w-6xl gap-6 px-4 py-10 text-sm sm:grid-cols-2">
        <div className="space-y-1">
          <p className="font-semibold">{name}</p>
          {contact?.address ? (
            <p className="text-muted-foreground">
              {contact.address}
              {contact.city ? `, ${contact.city}` : ''}
            </p>
          ) : null}
          {contact?.phone ? (
            <p>
              <a href={`tel:${contact.phone.replace(/\s/g, '')}`} className="hover:underline">
                {contact.phone}
              </a>
            </p>
          ) : null}
          {contact?.email ? (
            <p>
              <a href={`mailto:${contact.email}`} className="hover:underline">
                {contact.email}
              </a>
            </p>
          ) : null}
        </div>
        <nav aria-label="Footer" className="flex flex-col gap-1 sm:items-end">
          <Link href="/courses" className="hover:underline">
            Courses
          </Link>
          {hasNews ? (
            <Link href="/news" className="hover:underline">
              News
            </Link>
          ) : null}
          <Link href="/contact" className="hover:underline">
            Contact
          </Link>
        </nav>
      </div>
      <p className="text-muted-foreground border-border border-t py-4 text-center text-xs">
        © {new Date().getFullYear()} {name}
      </p>
    </footer>
  );
}
