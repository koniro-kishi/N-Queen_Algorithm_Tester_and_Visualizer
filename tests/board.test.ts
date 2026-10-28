import { describe, expect, it } from 'vitest';
import { Board, OperationError } from '../Tester/Board/board';
import { mulberry32, randInt } from '../Tester/Board/rng';

function bruteForcePairs(view: string[]): number {
  const q: Array<[number, number]> = [];
  view.forEach((row, r) => [...row].forEach((ch, c) => ch === 'Q' && q.push([r, c])));
  let p = 0;
  for (let i = 0; i < q.length; i++) for (let j = i + 1; j < q.length; j++) {
    const [a, b] = q[i]!, [c, d] = q[j]!;
    if (a === c || b === d || Math.abs(a - c) === Math.abs(b - d)) p++;
  }
  return p;
}

describe('Board', () => {
  it('put returns pairs===0 and tracks conflicts', () => {
    const b = new Board(4);
    expect(b.put(0, 0)).toBe(true);
    expect(b.put(1, 1)).toBe(false); // diagonal
    expect(b.pairs).toBe(1);
    b.remove(1, 1);
    expect(b.pairs).toBe(0);
  });

  it('matches brute force over random put/remove sequences', () => {
    const rng = mulberry32(42);
    for (const n of [4, 8, 20]) {
      const b = new Board(n);
      for (let i = 0; i < 3000; i++) {
        const x = randInt(rng, n), y = randInt(rng, n);
        const v = b.view();
        if (v[x]![y] === 'Q') b.remove(x, y); else b.put(x, y);
        if (i % 50 === 0) {
          const view = b.view();
          expect(b.pairs).toBe(bruteForcePairs(view));
          expect(b.queenCount).toBe(view.join('').split('Q').length - 1);
        }
      }
    }
  });

  it('throws OperationError on invalid operations', () => {
    const b = new Board(4);
    expect(() => b.put(4, 0)).toThrow(OperationError);
    expect(() => b.put(-1, 0)).toThrow(OperationError);
    b.put(0, 0);
    expect(() => b.put(0, 0)).toThrow(/occupied/);
    expect(() => b.remove(1, 1)).toThrow(/empty/);
    b.lock(0, 0);
    expect(() => b.remove(0, 0)).toThrow(/locked/);
  });

  it('check: out of bounds false; safe cell true; self excluded', () => {
    const b = new Board(4);
    b.put(0, 1);
    expect(b.check(-1, 0)).toBe(false);
    expect(b.check(1, 3)).toBe(true);
    expect(b.check(1, 1)).toBe(false);
    expect(b.check(0, 1)).toBe(true); // occupied, no other attacker
  });

  it('view returns a fresh copy', () => {
    const b = new Board(4);
    const v = b.view(); v[0] = 'QQQQ';
    expect(b.view()[0]).toBe('xxxx');
  });
});
