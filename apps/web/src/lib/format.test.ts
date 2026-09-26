import { describe, expect, it } from 'vitest';

import { durationLabel, formatDate, formatDays, formatTime, seatsLabel } from './format';

describe('formatDays', () => {
  it('shortens a run of weekdays', () => expect(formatDays([1, 2, 3, 4, 5])).toBe('Mon–Fri'));
  it('lists days that are not next to each other', () =>
    expect(formatDays([1, 3, 5])).toBe('Mon, Wed, Fri'));
  it('puts Sunday last, as the week runs Monday first', () =>
    expect(formatDays([0, 6])).toBe('Sat, Sun'));
  it('handles one day and unsorted input', () => {
    expect(formatDays([4])).toBe('Thu');
    expect(formatDays([5, 1, 3])).toBe('Mon, Wed, Fri');
  });
  it('shortens a weekend-spanning run', () => expect(formatDays([5, 6, 0])).toBe('Fri–Sun'));
  it('keeps two adjacent days as a list', () => expect(formatDays([2, 3])).toBe('Tue, Wed'));
});

describe('formatTime', () => {
  it.each([
    ['17:00', '5:00 PM'],
    ['08:30', '8:30 AM'],
    ['00:15', '12:15 AM'],
    ['12:00', '12:00 PM'],
  ])('%s → %s', (input, expected) => expect(formatTime(input)).toBe(expected));
});

describe('formatDate', () => {
  it('is the same date whatever the machine time zone', () =>
    expect(formatDate('2027-01-04')).toBe('Jan 4, 2027'));
});

describe('seatsLabel', () => {
  it('says full at zero', () => expect(seatsLabel(0)).toEqual({ text: 'Full', tone: 'danger' }));
  it('warns when few are left', () => {
    expect(seatsLabel(1)).toEqual({ text: 'Last seat', tone: 'warning' });
    expect(seatsLabel(3)).toEqual({ text: 'Only 3 seats left', tone: 'warning' });
  });
  it('is calm otherwise', () =>
    expect(seatsLabel(12)).toEqual({ text: '12 seats left', tone: 'success' }));
});

describe('durationLabel', () => {
  it('joins what is set', () => expect(durationLabel(12, 96)).toBe('12 weeks · 96 hours'));
  it('leaves out the rest', () => {
    expect(durationLabel(1, null)).toBe('1 week');
    expect(durationLabel(null, null)).toBeNull();
  });
});
