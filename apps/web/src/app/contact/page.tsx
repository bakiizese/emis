import type { Metadata } from 'next';

import { getContact } from '../../lib/api';

export const metadata: Metadata = {
  title: 'Contact',
  description: 'How to reach us and where to find our branches.',
  alternates: { canonical: '/contact' },
};

const mapLink = (query: string) =>
  `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}`;

export default async function ContactPage() {
  const contact = await getContact();
  const hasMain = contact.phone || contact.email || contact.address;

  return (
    <main className="mx-auto max-w-4xl px-4 py-10">
      <h1 className="text-3xl font-semibold tracking-tight">Contact us</h1>

      {hasMain ? (
        <dl className="mt-6 space-y-3">
          {contact.phone ? (
            <div>
              <dt className="text-muted-foreground text-sm">Phone</dt>
              <dd>
                <a href={`tel:${contact.phone.replace(/\s/g, '')}`} className="hover:underline">
                  {contact.phone}
                </a>
              </dd>
            </div>
          ) : null}
          {contact.email ? (
            <div>
              <dt className="text-muted-foreground text-sm">Email</dt>
              <dd>
                <a href={`mailto:${contact.email}`} className="hover:underline">
                  {contact.email}
                </a>
              </dd>
            </div>
          ) : null}
          {contact.address ? (
            <div>
              <dt className="text-muted-foreground text-sm">Address</dt>
              <dd>
                {contact.address}
                {contact.city ? `, ${contact.city}` : ''}
              </dd>
            </div>
          ) : null}
        </dl>
      ) : null}

      {contact.branches.length > 0 ? (
        <>
          <h2 className="mt-10 text-xl font-semibold tracking-tight">Our branches</h2>
          <ul className="mt-4 grid gap-4 sm:grid-cols-2">
            {contact.branches.map((branch) => (
              <li key={branch.id} className="border-border rounded-xl border p-4">
                <p className="font-semibold">{branch.name}</p>
                {branch.address ? (
                  <p className="text-muted-foreground text-sm">{branch.address}</p>
                ) : null}
                {branch.phone ? (
                  <p className="text-sm">
                    <a href={`tel:${branch.phone.replace(/\s/g, '')}`} className="hover:underline">
                      {branch.phone}
                    </a>
                  </p>
                ) : null}
                {branch.address ? (
                  <a
                    href={mapLink(`${branch.name} ${branch.address}`)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-primary mt-2 inline-block text-sm hover:underline"
                  >
                    Open in maps
                  </a>
                ) : null}
              </li>
            ))}
          </ul>
        </>
      ) : null}
    </main>
  );
}
