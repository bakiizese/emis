import { APPLICATION_STATUSES } from '@emis/contracts';
import { describe, expect, it } from 'vitest';

import { canPlace, canTransition, isClosed, OPEN_STATUSES } from './pipeline.js';

describe('pipeline rules', () => {
  it('splits every status into open or closed, never both', () => {
    for (const status of APPLICATION_STATUSES) {
      expect(isClosed(status)).toBe(!(OPEN_STATUSES as readonly string[]).includes(status));
    }
  });

  it('lets a placement be recorded (or corrected) only before an offer', () => {
    expect(canPlace('submitted')).toBe(true);
    expect(canPlace('placed')).toBe(true);
    expect(canPlace('offered')).toBe(false);
    expect(canPlace('rejected')).toBe(false);
  });

  it('agrees with the transition table on moving to placed', () => {
    for (const from of APPLICATION_STATUSES) {
      if (from === 'placed') continue;
      expect(canPlace(from)).toBe(canTransition(from, 'placed'));
    }
  });

  it('has no way out of a closed application', () => {
    for (const from of APPLICATION_STATUSES.filter(isClosed)) {
      for (const to of APPLICATION_STATUSES) expect(canTransition(from, to)).toBe(false);
    }
  });
});
