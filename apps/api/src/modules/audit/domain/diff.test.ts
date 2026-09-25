import { describe, expect, it } from 'vitest';

import { diffChanges } from './diff.js';

describe('diffChanges', () => {
  it('keeps only fields that changed', () => {
    expect(
      diffChanges(
        { name: 'Old', city: 'Adama', options: ['a'] },
        { name: 'New', city: 'Adama', options: ['a'], phone: undefined },
      ),
    ).toEqual({ name: { from: 'Old', to: 'New' } });
  });

  it('records a field that was empty before', () => {
    expect(diffChanges({}, { tagline: 'Learn' })).toEqual({ tagline: { from: null, to: 'Learn' } });
  });
});
