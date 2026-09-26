import type { DuplicateCandidate, DuplicateReason } from '@emis/contracts';
import { Alert } from '@emis/ui/components/alert';
import { Badge } from '@emis/ui/components/badge';
import Link from 'next/link';
import type { ReactNode } from 'react';

const REASONS: Record<DuplicateReason, string> = {
  same_phone: 'Same phone',
  same_email: 'Same email',
  similar_name: 'Similar name',
};

/** "These people already exist": lets staff check before registering someone twice. */
export function DuplicatesPanel({
  candidates,
  action,
}: {
  candidates: DuplicateCandidate[];
  /** Rendered per candidate, e.g. a "This is them" button. */
  action?: (candidate: DuplicateCandidate) => ReactNode;
}) {
  if (candidates.length === 0) return null;
  return (
    <Alert tone="info" className="space-y-3">
      <p className="font-medium">
        {candidates.length === 1
          ? 'This person may already be registered:'
          : 'These people may already be registered:'}
      </p>
      <ul className="divide-border divide-y">
        {candidates.map((c) => (
          <li key={c.student.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
            <div>
              <Link
                href={`/students/${c.student.id}`}
                className="font-medium hover:underline"
                target="_blank"
                rel="noopener noreferrer"
              >
                {c.student.givenName} {c.student.fatherName} {c.student.grandfatherName ?? ''}
              </Link>
              <div className="text-muted-foreground text-xs">
                {c.student.studentNumber} · {c.student.phone}
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-1.5">
              {c.reasons.map((reason) => (
                <Badge key={reason} tone="warning">
                  {REASONS[reason]}
                </Badge>
              ))}
              {action?.(c)}
            </div>
          </li>
        ))}
      </ul>
    </Alert>
  );
}
