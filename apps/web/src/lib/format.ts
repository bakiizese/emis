/** Monday first; the API sends 0 = Sunday … 6 = Saturday. */
const WEEK = [
  { value: 1, short: 'Mon' },
  { value: 2, short: 'Tue' },
  { value: 3, short: 'Wed' },
  { value: 4, short: 'Thu' },
  { value: 5, short: 'Fri' },
  { value: 6, short: 'Sat' },
  { value: 0, short: 'Sun' },
];

/** [1,2,3,4,5] → "Mon–Fri"; [1,3,5] → "Mon, Wed, Fri". Runs of three or more days are shortened. */
export function formatDays(days: readonly number[]): string {
  const positions = WEEK.flatMap((d, i) => (days.includes(d.value) ? [i] : []));
  const parts: string[] = [];
  for (let i = 0; i < positions.length;) {
    let j = i;
    while (positions[j + 1] === (positions[j] ?? -2) + 1) j++;
    const first = WEEK[positions[i] ?? 0]?.short ?? '';
    const last = WEEK[positions[j] ?? 0]?.short ?? '';
    if (j - i >= 2) {
      parts.push(`${first}–${last}`);
      i = j + 1;
    } else {
      parts.push(first);
      i += 1;
    }
  }
  return parts.join(', ');
}

/** "17:00" → "5:00 PM". */
export function formatTime(time: string): string {
  const [h = '0', m = '00'] = time.split(':');
  const hour = Number(h);
  const suffix = hour >= 12 ? 'PM' : 'AM';
  return `${hour % 12 === 0 ? 12 : hour % 12}:${m} ${suffix}`;
}

/** "2027-01-04" → "Jan 4, 2027", the same in every time zone. */
export function formatDate(date: string): string {
  return new Intl.DateTimeFormat('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(`${date}T00:00:00Z`));
}

export function seatsLabel(seatsLeft: number): {
  text: string;
  tone: 'success' | 'warning' | 'danger';
} {
  if (seatsLeft <= 0) return { text: 'Full', tone: 'danger' };
  if (seatsLeft <= 5) {
    return {
      text: seatsLeft === 1 ? 'Last seat' : `Only ${seatsLeft} seats left`,
      tone: 'warning',
    };
  }
  return { text: `${seatsLeft} seats left`, tone: 'success' };
}

const PROGRAM_TYPES = {
  long_course: 'Long course',
  short_course: 'Short course',
  exam_prep: 'Exam preparation',
} as const;

export const programTypeLabel = (type: keyof typeof PROGRAM_TYPES): string => PROGRAM_TYPES[type];

/** "12 weeks · 96 hours", leaving out what isn't set. */
export function durationLabel(weeks: number | null, hours: number | null): string | null {
  const parts = [
    weeks ? `${weeks} week${weeks === 1 ? '' : 's'}` : null,
    hours ? `${hours} hour${hours === 1 ? '' : 's'}` : null,
  ].filter((p): p is string => p !== null);
  return parts.length > 0 ? parts.join(' · ') : null;
}
