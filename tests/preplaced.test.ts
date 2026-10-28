import { describe, expect, it } from 'vitest';
import { generatePreplaced } from '../Tester/Board/preplaced';
import { validateBoard } from '../Tester/Board/validator';

describe('generatePreplaced', () => {
  it('is deterministic per (N, P, seed)', () => {
    expect(generatePreplaced(12, 5, 7)).toEqual(generatePreplaced(12, 5, 7));
    expect(generatePreplaced(12, 5, 7)).not.toEqual(generatePreplaced(12, 5, 8));
  });

  it('preplaced queens never attack each other, for all (N, P) and several seeds', () => {
    for (let n = 4; n <= 20; n++) for (let p = 0; p <= n - 1; p++) for (let seed = 0; seed < 5; seed++) {
      const inst = generatePreplaced(n, p, seed);
      expect(inst.queens).toHaveLength(p);
      // Partial-board check: same pairwise rules, via validator on a completed padding is not possible,
      // so check pairwise directly.
      for (let i = 0; i < p; i++) for (let j = i + 1; j < p; j++) {
        const [a, b] = inst.queens[i]!, [c, d] = inst.queens[j]!;
        expect(a !== c && b !== d && Math.abs(a - c) !== Math.abs(b - d)).toBe(true);
      }
    }
  });

  it('P = N-1 leaves exactly one forced completion (hint leak, issue I7)', () => {
    const inst = generatePreplaced(8, 7, 3);
    const grid = Array.from({ length: 8 }, () => Array(8).fill('x'));
    inst.queens.forEach(([r, c]) => (grid[r]![c] = 'Q'));
    const free = [...Array(8).keys()].find((r) => !grid[r]!.includes('Q'))!;
    const ok = [...Array(8).keys()].filter((c) => {
      const g = grid.map((r) => [...r]); g[free]![c] = 'Q';
      return validateBoard(g.map((r) => r.join('')), 8).ok;
    });
    expect(ok).toHaveLength(1);
  });

  it('rejects out-of-range inputs', () => {
    expect(() => generatePreplaced(3, 0, 0)).toThrow(RangeError);
    expect(() => generatePreplaced(21, 0, 0)).toThrow(RangeError);
    expect(() => generatePreplaced(8, 8, 0)).toThrow(RangeError);
  });
});
