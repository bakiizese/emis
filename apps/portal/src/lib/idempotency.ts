import { useRef } from 'react';

/**
 * One Idempotency-Key per logical submission: retrying the same values (double-click, network
 * error) reuses the key so the API replays instead of repeating; changed values get a new key.
 */
export function useIdempotencyKey() {
  const last = useRef<{ fingerprint: string; key: string } | null>(null);
  return {
    keyFor(values: unknown): string {
      const fingerprint = JSON.stringify(values);
      if (last.current?.fingerprint !== fingerprint) {
        last.current = { fingerprint, key: crypto.randomUUID() };
      }
      return last.current.key;
    },
    reset(): void {
      last.current = null;
    },
  };
}
