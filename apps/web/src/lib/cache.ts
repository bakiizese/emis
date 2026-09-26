interface Entry<T> {
  value: T;
  /** When the value was last fetched successfully; a value is only served stale for so long. */
  fetchedAt: number;
  expiresAt: number;
}

/**
 * A small in-memory cache for the site's server-side API reads. The website is many visitors to
 * one server, so without this every page view would be an API call from the same address and the
 * API's rate limit would be spent by the site itself. Concurrent misses share one request, and
 * when the API is down the last good answer keeps being served for up to `staleFor`.
 */
export class TtlCache {
  private readonly entries = new Map<string, Entry<unknown>>();
  private readonly inflight = new Map<string, Promise<unknown>>();

  constructor(
    private readonly now: () => number = Date.now,
    private readonly staleFor = 10 * 60_000,
  ) {}

  get<T>(key: string, ttlMs: number, load: () => Promise<T>): Promise<T> {
    const entry = this.entries.get(key) as Entry<T> | undefined;
    if (entry && entry.expiresAt > this.now()) return Promise.resolve(entry.value);

    const running = this.inflight.get(key) as Promise<T> | undefined;
    if (running) return running;

    const request = load()
      .then((value) => {
        const now = this.now();
        this.entries.set(key, { value, fetchedAt: now, expiresAt: now + ttlMs });
        return value;
      })
      .catch((error: unknown) => {
        if (entry && this.now() - entry.fetchedAt < this.staleFor) {
          // A stale page beats an error page; look again shortly.
          this.entries.set(key, { ...entry, expiresAt: this.now() + 5_000 });
          return entry.value;
        }
        throw error;
      })
      .finally(() => this.inflight.delete(key));
    this.inflight.set(key, request);
    return request;
  }
}
