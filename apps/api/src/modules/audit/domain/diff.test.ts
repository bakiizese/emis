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

describe('diffChanges with hostile keys', () => {
  it('never touches the prototype', () => {
    const after = JSON.parse('{"__proto__": {"polluted": true}}') as Record<string, unknown>;
    const changes = diffChanges({}, after);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    expect(Object.getPrototypeOf(changes)).toBe(Object.prototype);
    expect(Object.hasOwn(changes, '__proto__')).toBe(true);
  });
});
