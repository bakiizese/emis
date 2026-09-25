import { type ApplicationStatus, canTransition, OPEN_STATUSES } from '@emis/contracts';

/** Finished applications: nothing more happens to them. */
export const CLOSED_STATUSES: ApplicationStatus[] = [
  'rejected',
  'withdrawn',
  'expired',
  'enrolled',
];

export const isClosed = (status: ApplicationStatus): boolean => CLOSED_STATUSES.includes(status);

/** Statuses from which a placement result may be recorded (or corrected, once placed). */
export const PLACEMENT_FROM: readonly ApplicationStatus[] = [
  'submitted',
  'contacted',
  'placement_scheduled',
  'placed',
];

/** A status change to `placed` from the current status, including re-recording a result. */
export const canPlace = (from: ApplicationStatus): boolean => PLACEMENT_FROM.includes(from);

export { canTransition, OPEN_STATUSES };
