import type { ApplicationStatus, StudentStatus } from '@emis/contracts';
import { Badge } from '@emis/ui/components/badge';

const studentTone = {
  active: 'success',
  on_hold: 'warning',
  graduated: 'info',
  withdrawn: 'danger',
  alumni: 'neutral',
} as const satisfies Record<StudentStatus, string>;

const applicationTone = {
  submitted: 'info',
  contacted: 'info',
  placement_scheduled: 'info',
  placed: 'info',
  offered: 'warning',
  confirmed: 'success',
  enrolled: 'success',
  rejected: 'danger',
  withdrawn: 'neutral',
  expired: 'neutral',
} as const satisfies Record<ApplicationStatus, string>;

const label = (status: string) => {
  const text = status.replaceAll('_', ' ');
  return text.charAt(0).toUpperCase() + text.slice(1);
};

export const studentStatusLabel = label;
export const applicationStatusLabel = label;

export function StudentStatusBadge({ status }: { status: StudentStatus }) {
  return <Badge tone={studentTone[status]}>{label(status)}</Badge>;
}

export function ApplicationStatusBadge({ status }: { status: ApplicationStatus }) {
  return <Badge tone={applicationTone[status]}>{label(status)}</Badge>;
}
