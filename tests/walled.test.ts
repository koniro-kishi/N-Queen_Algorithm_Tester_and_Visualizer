import { describe, expect, it } from 'vitest';
import { Board, OperationError } from '../Tester/Board/board';
import { buildSegments } from '../Tester/Board/segments';
import { mulberry32, randInt } from '../Tester/Board/rng';
import { validateBoard } from '../Tester/Board/validator';
import {
  generateWalled, GENERATOR_VERSION, maxWallsForN, TARGET_FRACTION, WalledInfeasibleError,
} from '../Tester/Board/walled';

/** Naive reference: pairs on one line attack unless a 'W' lies strictly between them. */
function bruteForcePairs(view: string[]): number {
  const q: Array<[number, number]> = [];
  view.forEach((row, r) => [...row].forEach((ch, c) => ch === 'Q' && q.push([r, c])));
  let p = 0;
  for (let i = 0; i < q.length; i++) for (let j = i + 1; j < q.length; j++) {
    const [a, b] = q[i]!, [c, d] = q[j]!;
    if (!(a === c || b === d || Math.abs(a - c) === Math.abs(b - d))) continue;
    const dr = Math.sign(c - a), dc = Math.sign(d - b);
    let cut = false;
    for (let r = a + dr, col = b + dc; r !== c || col !== d; r += dr, col += dc) if (view[r]![col] === 'W') cut = true;
    if (!cut) p++;
  }
  return p;
}

describe('segments', () => {
  it('without walls the segments are the full lines', () => {
    const s = buildSegments(5, new Uint8Array(25));
    expect(s.counts).toEqual([5, 5, 9, 9]);
  });

  it('a wall splits the lines through it and has no segment itself', () => {
    const wall = new Uint8Array(25); wall[2 * 5 + 2] = 1; // centre of 5x5
    const s = buildSegments(5, wall);
    expect(s.counts).toEqual([6, 6, 10, 10]); // row, column, both long diagonals each gain one segment
    expect(s.ids.every((a) => a[12] === -1)).toBe(true);
    expect(s.ids[0]![2 * 5 + 1]).not.toBe(s.ids[0]![2 * 5 + 3]);
  });
});

describe('Board with walls', () => {
  it('a wall cuts attacks between queens on every line type', () => {
    const walls: Array<[number, number]> = [[0, 1], [1, 0], [1, 1]];
    const pair = (a: [number, number], b: [number, number], ws = walls) => {
      const b2 = new Board(4, ws);
      b2.put(a[0], a[1]);
      return b2.put(b[0], b[1]);
    };
    expect(new Board(4, walls).view()[0]).toBe('xWxx');
    expect(pair([0, 0], [0, 2])).toBe(true);        // row, wall at (0,1) between
    expect(pair([0, 0], [2, 0])).toBe(true);        // column, wall at (1,0) between
    expect(pair([0, 0], [2, 2])).toBe(true);        // diagonal, wall at (1,1) between
    expect(pair([0, 2], [1, 3], [[0, 3]])).toBe(false); // adjacent diagonal, the wall is elsewhere: still attacked
    expect(pair([0, 3], [3, 0], [[1, 2]])).toBe(true);  // anti-diagonal cut by a wall
    const b = new Board(4, walls);
    b.put(0, 2); b.put(2, 2);                        // column 2, nothing between
    expect(b.attackCount(2, 2)).toBe(1);
    expect(b.pairs).toBe(1);
  });

  it('rejects put/remove on a wall and out-of-bounds walls', () => {
    const b = new Board(4, [[2, 2]]);
    expect(() => b.put(2, 2)).toThrow(/wall/);
    expect(() => b.remove(2, 2)).toThrow(/wall/);
    expect(() => new Board(4, [[4, 0]])).toThrow(OperationError);
    expect(b.check(2, 2)).toBe(false);
    expect(b.wallCount).toBe(1);
  });

  it('matches the naive reference over random put/remove sequences on random walls', () => {
    const rng = mulberry32(7);
    for (const n of [5, 9, 14]) {
      const walls: Array<[number, number]> = [];
      for (let i = 0; i < n * 2; i++) walls.push([randInt(rng, n), randInt(rng, n)]);
      const b = new Board(n, walls);
      for (let i = 0; i < 1500; i++) {
        const x = randInt(rng, n), y = randInt(rng, n);
        if (b.isWall(x, y)) continue;
        if (b.hasQueen(x, y)) b.remove(x, y); else b.put(x, y);
        if (i % 150 === 0) {
          const view = b.view();
          expect(b.pairs).toBe(bruteForcePairs(view));
          // attackCount of every free or occupied cell agrees with a naive count
          for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) {
            if (view[r]![c] === 'W') { expect(b.attackCount(r, c)).toBe(-1); continue; }
            const g = view.map((s) => s.split(''));
            g[r]![c] = 'x';
            const base = bruteForcePairs(g.map((s) => s.join('')));
            g[r]![c] = 'Q';
            expect(bruteForcePairs(g.map((s) => s.join(''))) - base).toBe(b.attackCount(r, c));
          }
        }
      }
    }
  });

  it('queenUpperBound is a real bound: more queens than segments are always attacked', () => {
    const b = new Board(3, [[0, 1], [1, 0], [1, 1], [1, 2], [2, 1]]);
    expect(b.queenUpperBound).toBe(4); // the four corners of the classic 3x3 cross example
    [[0, 0], [0, 2], [2, 0], [2, 2]].forEach(([x, y]) => b.put(x!, y!));
    expect(b.pairs).toBe(0);
  });
});

describe('validateBoard with walls', () => {
  it('accepts queens that only share a line across a wall', () => {
    expect(validateBoard(['QWQ', 'xxx', 'xxx'], 3, [], { target: 2 })).toEqual({ ok: true });
  });
  it('rejects queens on one line with no wall between', () => {
    expect(validateBoard(['QxQ', 'WWW', 'xxx'], 3, [], { target: 2 })).toMatchObject({ rule: 'row' });
  });
  it('a wall off the line does not cut it', () => {
    expect(validateBoard(['QxQ', 'xWx', 'xxx'], 3, [], { target: 2 })).toMatchObject({ rule: 'row' });
  });
  it('diagonal cut by a wall', () => {
    expect(validateBoard(['Qxx', 'xWx', 'xxQ'], 3, [], { target: 2 })).toEqual({ ok: true });
    expect(validateBoard(['Qxx', 'xxx', 'xxQ'], 3, [], { target: 2 })).toMatchObject({ rule: 'diagonal' });
  });
  it('target is a minimum: extra queens are fine when valid', () => {
    expect(validateBoard(['QWQ', 'xxx', 'xxx'], 3, [], { target: 1 })).toEqual({ ok: true });
    expect(validateBoard(['QWQ', 'xxx', 'xxx'], 3, [], { target: 3 })).toMatchObject({ rule: 'queen-count' });
  });
  it('checks the instance walls are intact', () => {
    expect(validateBoard(['QWQ', 'xxx', 'xxx'], 3, [], { target: 2, walls: [[0, 1]] })).toEqual({ ok: true });
    expect(validateBoard(['QxQ', 'xxx', 'xxx'], 3, [], { target: 2, walls: [[0, 1]] })).toMatchObject({ rule: 'wall' });
    expect(validateBoard(['QWQ', 'xWx', 'xxx'], 3, [], { target: 2, walls: [[0, 1]] })).toMatchObject({ rule: 'wall' });
  });
  it('rejects unknown symbols', () => {
    expect(validateBoard(['QWQ', 'xxx', 'xxz'], 3)).toMatchObject({ rule: 'size' });
  });
});

describe('generateWalled', () => {
  it('is deterministic per (N, P, W, seed) and records the generator version', () => {
    const a = generateWalled(10, 2, 8, 3);
    expect(a).toEqual(generateWalled(10, 2, 8, 3));
    expect(a).not.toEqual(generateWalled(10, 2, 8, 4));
    expect(a.generator).toBe(GENERATOR_VERSION);
  });

  it('Q depends on (N, W, seed) only, not on P; preplaced queens are a subset of the witness', () => {
    const base = generateWalled(12, 0, 16, 5);
    for (const p of [1, 3, 6]) {
      const inst = generateWalled(12, p, 16, 5);
      expect(inst.q).toBe(base.q);
      expect(inst.walls).toEqual(base.walls);
      expect(inst.witness).toEqual(base.witness);
      expect(inst.queens).toHaveLength(p);
      const key = (c: [number, number]) => `${c[0]},${c[1]}`;
      const w = new Set(base.witness.map(key));
      expect(inst.queens.every((c) => w.has(key(c)))).toBe(true);
    }
  });

  it('every generated instance has Q > N, exact walls, and a witness the independent validator accepts', () => {
    for (const n of [4, 6, 8, 11, 14, 20]) {
      for (const w of [3, Math.floor(n * n * 0.1), Math.floor(n * n * 0.25)]) {
        for (let seed = 0; seed < 6; seed++) {
          let inst;
          try { inst = generateWalled(n, 0, w, seed); } catch (e) { expect(e).toBeInstanceOf(WalledInfeasibleError); continue; }
          expect(inst.q).toBeGreaterThan(n);
          expect(inst.walls).toHaveLength(w);
          expect(new Set(inst.walls.map(([x, y]) => x * n + y)).size).toBe(w);
          const grid = Array.from({ length: n }, () => Array<string>(n).fill('x'));
          inst.walls.forEach(([x, y]) => (grid[x]![y] = 'W'));
          inst.witness.forEach(([x, y]) => { expect(grid[x]![y]).toBe('x'); grid[x]![y] = 'Q'; });
          expect(validateBoard(grid.map((r) => r.join('')), n, inst.queens, { walls: inst.walls, target: inst.q })).toEqual({ ok: true });
          // and the incremental Board agrees: pairs === 0 for the witness
          const b = new Board(n, inst.walls);
          inst.witness.forEach(([x, y]) => b.put(x, y));
          expect(b.pairs).toBe(0);
        }
      }
    }
  });

  it('Q = N + ceil((Q_found - N) * f); the witness is cut down to exactly Q queens', () => {
    for (const f of [0.1, 0.25, 0.5, 0.75, 1]) {
      for (const [n, w, seed] of [[8, 8, 1], [12, 24, 2], [16, 40, 3]] as const) {
        const inst = generateWalled(n, 0, w, seed, f);
        expect(inst.fraction).toBe(f);
        expect(inst.q).toBe(n + Math.ceil((inst.qFound - n) * f - 1e-9));
        expect(inst.witness).toHaveLength(inst.q);
        expect(inst.q).toBeGreaterThan(n);
        expect(inst.q).toBeLessThanOrEqual(inst.qFound);
        const b = new Board(n, inst.walls);
        inst.witness.forEach(([x, y]) => b.put(x, y));
        expect(b.pairs).toBe(0);
      }
    }
  });

  it('f = 1 keeps the whole witness; smaller f lowers Q but not the walls or Q_found', () => {
    const full = generateWalled(12, 0, 24, 2, 1);
    const half = generateWalled(12, 0, 24, 2, 0.5);
    expect(full.q).toBe(full.qFound);
    expect(half.qFound).toBe(full.qFound);
    expect(half.walls).toEqual(full.walls);
    expect(half.q).toBeLessThan(full.q);
    expect(half.witness.every(([x, y]) => full.witness.some(([a, b]) => a === x && b === y))).toBe(true);
  });

  it('uses TARGET_FRACTION by default and keeps Q > N even for a tiny f', () => {
    expect(generateWalled(10, 0, 12, 0).fraction).toBe(TARGET_FRACTION);
    expect(generateWalled(10, 0, 12, 0, 0.001).q).toBeGreaterThan(10);
  });

  it('rejects f outside (0, 1]', () => {
    for (const f of [0, -0.5, 1.01, NaN, Infinity]) expect(() => generateWalled(8, 0, 8, 0, f)).toThrow(RangeError);
  });

  it('without walls Q > N is impossible, so generation is reported infeasible', () => {
    expect(() => generateWalled(8, 0, 0, 0)).toThrow(WalledInfeasibleError);
  });

  it('P above Q-1 is infeasible', () => {
    const q = generateWalled(8, 0, 8, 1).q;
    expect(() => generateWalled(8, q, 8, 1)).toThrow(WalledInfeasibleError);
    expect(generateWalled(8, q - 1, 8, 1).queens).toHaveLength(q - 1);
  });

  it('rejects out-of-range inputs', () => {
    expect(() => generateWalled(3, 0, 1, 0)).toThrow(RangeError);
    expect(() => generateWalled(21, 0, 1, 0)).toThrow(RangeError);
    expect(() => generateWalled(8, 0, -1, 0)).toThrow(RangeError);
    expect(() => generateWalled(8, 0, maxWallsForN(8) + 1, 0)).toThrow(RangeError);
    expect(() => generateWalled(8, -1, 4, 0)).toThrow(RangeError);
    expect(() => generateWalled(8, 0, 4, -1)).toThrow(RangeError);
  });
});
