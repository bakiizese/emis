import { verificationTokenSchema } from '@emis/contracts';
import { Badge } from '@emis/ui/components/badge';
import type { Metadata } from 'next';

import { LinkButton } from '../../../components/link-button';
import { getVerification, NotFoundError } from '../../../lib/api';
import { formatDate } from '../../../lib/format';

// A verification link is for whoever holds the document, not for search engines.
export const metadata: Metadata = {
  title: 'Verify a document',
  robots: { index: false, follow: false },
};

type Props = { params: Promise<{ token: string }> };

const STATUS = {
  valid: {
    tone: 'success',
    label: 'Genuine',
    note: 'This document was issued by us and is valid.',
  },
  revoked: {
    tone: 'danger',
    label: 'Revoked',
    note: 'This document is no longer valid. Do not accept it.',
  },
  expired: {
    tone: 'warning',
    label: 'Expired',
    note: 'This document was genuine but has passed its end date.',
  },
} as const;

export default async function VerifyPage({ params }: Props) {
  const { token } = await params;
  let result = null;
  if (verificationTokenSchema.safeParse(token).success) {
    try {
      result = await getVerification(token);
    } catch (error) {
      if (!(error instanceof NotFoundError)) throw error;
    }
  }

  if (!result) {
    return (
      <main className="mx-auto max-w-xl px-4 py-16 text-center">
        <Badge tone="danger">Not found</Badge>
        <h1 className="mt-4 text-2xl font-semibold">We couldn&apos;t find this document</h1>
        <p className="text-muted-foreground mt-2">
          The code is not one of ours. If you scanned it from a certificate or ID card, treat that
          document as unverified and contact us.
        </p>
        <LinkButton href="/contact" variant="outline" className="mt-6">
          Contact us
        </LinkButton>
      </main>
    );
  }

  const status = STATUS[result.status];
  return (
    <main className="mx-auto max-w-xl px-4 py-12">
      <div className="border-border rounded-xl border p-6">
        <Badge tone={status.tone}>{status.label}</Badge>
        <h1 className="mt-3 text-2xl font-semibold">{result.holderName}</h1>
        <p className="text-muted-foreground">{result.title}</p>
        <p className="mt-3 text-sm">{status.note}</p>

        <dl className="mt-6 space-y-2 text-sm">
          <Row label="Issued by" value={result.institutionName} />
          <Row label="Serial" value={result.serial} mono />
          <Row label="Issued on" value={formatDate(result.issuedOn)} />
          {result.validUntil ? (
            <Row label="Valid until" value={formatDate(result.validUntil)} />
          ) : null}
          {result.revokedOn ? (
            <Row label="Revoked on" value={formatDate(result.revokedOn)} />
          ) : null}
        </dl>
      </div>
    </main>
  );
}

function Row({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex justify-between gap-4">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className={mono ? 'font-mono' : 'font-medium'}>{value}</dd>
    </div>
  );
}
