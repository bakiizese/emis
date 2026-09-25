import { describe, expect, it } from 'vitest';

import { escapeLike, phonePattern, searchTokens } from './like.js';

describe('escapeLike', () => {
  it('makes wildcards literal', () => {
    expect(escapeLike('50%_off\\')).toBe('50\\%\\_off\\\\');
    expect(escapeLike('plain')).toBe('plain');
  });
});

describe('searchTokens', () => {
  it('splits, lower-cases and caps the words', () => {
    expect(searchTokens('  Hana   BEK ')).toEqual(['hana', 'bek']);
    expect(searchTokens('')).toEqual([]);
    expect(searchTokens('a b c d e f g')).toHaveLength(5);
  });
});

describe('phonePattern', () => {
  it('matches the digits after the local zero, however they were typed', () => {
    expect(phonePattern('0944')).toBe('%944%');
    expect(phonePattern('+251944')).toBe('%251944%');
    expect(phonePattern('944-555')).toBe('%944555%');
  });

  it('ignores words that are not phone-like', () => {
    expect(phonePattern('hana')).toBeNull();
    expect(phonePattern('09')).toBeNull();
    expect(phonePattern('12')).toBeNull();
  });
});
