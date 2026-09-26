import type { PublicClass } from '@emis/contracts';
import { Badge } from '@emis/ui/components/badge';
import Link from 'next/link';

import { formatDate, formatDays, formatTime, seatsLabel } from '../lib/format';

import { LinkButton } from './link-button';

/** The query string that opens the pre-registration form on a particular class. */
export const registerHref = (c: PublicClass): string =>
  `/pre-register?class=${c.id}&course=${c.courseId}`;

/**
 * Classes people can still join, with the shift's days and times and the live seat count.
 * `showCourse` adds the course name (for lists that mix courses, like the home page).
 */
export function ClassList({
  classes,
  showCourse = false,
  canRegister,
}: {
  classes: PublicClass[];
  showCourse?: boolean;
  canRegister: boolean;
}) {
  return (
    <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {classes.map((c) => {
        const seats = seatsLabel(c.seatsLeft);
        return (
          <li
            key={c.id}
            className="border-border bg-background flex flex-col gap-3 rounded-xl border p-4"
          >
            <div className="flex items-start justify-between gap-2">
              <div>
                {showCourse ? (
                  <Link href={`/courses/${c.courseId}`} className="font-semibold hover:underline">
                    {c.courseName}
                  </Link>
                ) : (
                  <p className="font-semibold">{c.name}</p>
                )}
                <p className="text-muted-foreground text-sm">
                  {c.shift.name} · {c.branch.name}
                </p>
              </div>
              <Badge tone={seats.tone}>{seats.text}</Badge>
            </div>
            <dl className="text-sm">
              <div className="flex justify-between gap-2">
                <dt className="text-muted-foreground">Days</dt>
                <dd>{formatDays(c.shift.daysOfWeek)}</dd>
              </div>
              <div className="flex justify-between gap-2">
                <dt className="text-muted-foreground">Time</dt>
                <dd>
                  {formatTime(c.shift.startTime)} – {formatTime(c.shift.endTime)}
                </dd>
              </div>
              <div className="flex justify-between gap-2">
                <dt className="text-muted-foreground">Starts</dt>
                <dd>{formatDate(c.startDate)}</dd>
              </div>
            </dl>
            {canRegister ? (
              <LinkButton
                href={registerHref(c)}
                variant={c.isFull ? 'outline' : 'primary'}
                className="mt-auto"
              >
                {c.isFull ? `Join the waiting list` : 'Pre-register for this class'}
              </LinkButton>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}
