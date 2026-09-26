import { describe, expect, it } from 'vitest';

import { TtlCache } from './cache';

describe('TtlCache', () => {
  it('serves a fresh value without loading again', async () => {
    let now = 0;
    const cache = new TtlCache(() => now);
    let loads = 0;
    const load = () => Promise.resolve(++loads);

    expect(await cache.get('k', 1000, load)).toBe(1);
    now = 999;
    expect(await cache.get('k', 1000, load)).toBe(1);
    now = 1001;
    expect(await cache.get('k', 1000, load)).toBe(2);
  });

  it('shares one load between simultaneous callers', async () => {
    const cache = new TtlCache(() => 0);
    let loads = 0;
    const load = async () => {
      await Promise.resolve();
      return ++loads;
    };
    const results = await Promise.all(Array.from({ length: 5 }, () => cache.get('k', 1000, load)));
    expect(results).toEqual([1, 1, 1, 1, 1]);
    expect(loads).toBe(1);
  });

  it('keeps separate keys apart', async () => {
    const cache = new TtlCache(() => 0);
    expect(await cache.get('a', 1000, () => Promise.resolve('A'))).toBe('A');
    expect(await cache.get('b', 1000, () => Promise.resolve('B'))).toBe('B');
  });

  it('serves the last good value while the API is down, then gives up', async () => {
    let now = 0;
    const cache = new TtlCache(() => now, 60_000);
    await cache.get('k', 1000, () => Promise.resolve('good'));

    now = 2000;
    const down = () => Promise.reject(new Error('down'));
    expect(await cache.get('k', 1000, down)).toBe('good');

    now = 70_000;
    await expect(cache.get('k', 1000, down)).rejects.toThrow('down');
  });

  it('throws when there is nothing to fall back on, and retries next time', async () => {
    const cache = new TtlCache(() => 0);
    await expect(cache.get('k', 1000, () => Promise.reject(new Error('down')))).rejects.toThrow(
      'down',
    );
    expect(await cache.get('k', 1000, () => Promise.resolve('back'))).toBe('back');
  });
});
