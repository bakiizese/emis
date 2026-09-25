import { describe, expect, it } from 'vitest';

import { wouldCreateCycle } from './prerequisites.js';

const graph = (edges: Record<string, string[]>) => new Map(Object.entries(edges));

describe('wouldCreateCycle', () => {
  // A2 needs A1, B1 needs A2.
  const existing = graph({ A2: ['A1'], B1: ['A2'] });

  it('allows a straight chain', () => {
    expect(wouldCreateCycle(existing, 'B2', ['B1'])).toBe(false);
    expect(wouldCreateCycle(existing, 'C1', ['A1', 'B1'])).toBe(false);
  });

  it('rejects a direct loop', () => {
    expect(wouldCreateCycle(graph({ A2: ['A1'] }), 'A1', ['A2'])).toBe(true);
  });

  it('rejects an indirect loop', () => {
    // A1 needing B1 would give A1 → B1 → A2 → A1.
    expect(wouldCreateCycle(existing, 'A1', ['B1'])).toBe(true);
  });

  it('ignores the course’s own old edges, which are being replaced', () => {
    // A2 currently needs A1; replacing that with nothing or with something else is fine.
    expect(wouldCreateCycle(existing, 'A2', [])).toBe(false);
    expect(wouldCreateCycle(graph({ A2: ['A1'], A1: ['A2'] }), 'A2', ['A0'])).toBe(false);
  });

  it('terminates on a graph that already has a loop elsewhere', () => {
    const cyclic = graph({ X: ['Y'], Y: ['X'] });
    expect(wouldCreateCycle(cyclic, 'Z', ['X'])).toBe(false);
  });
});
