import { mulberry32, randInt } from './rng';

export const MIN_N = 4;
export const MAX_N = 20;

/** Random complete N-Queens solution via min-conflicts with restarts. Returns queens[r] = column. */
export function randomSolution(n: number, rng: () => number): number[] {
  for (let attempt = 0; attempt < 1000; attempt++) {
    const q = Array.from({ length: n }, (_, r) => r);
    for (let i = n - 1; i > 0; i--) { const j = randInt(rng, i + 1); [q[i], q[j]] = [q[j]!, q[i]!]; }
    const colC = new Int32Array(n), d1 = new Int32Array(2 * n - 1), d2 = new Int32Array(2 * n - 1);
    const add = (r: number, c: number, s: number) => { colC[c]! += s; d1[r - c + n - 1]! += s; d2[r + c]! += s; };
    q.forEach((c, r) => add(r, c, 1));
    const conflicts = (r: number, c: number) => colC[c]! + d1[r - c + n - 1]! + d2[r + c]!; // excl. self handled by caller
    for (let step = 0; step < 50 * n; step++) {
      const bad: number[] = [];
      for (let r = 0; r < n; r++) if (conflicts(r, q[r]!) - 3 > 0) bad.push(r);
      if (bad.length === 0) return q;
      const r = bad[randInt(rng, bad.length)]!;
      add(r, q[r]!, -1);
      let best = Infinity; let cands: number[] = [];
      for (let c = 0; c < n; c++) {
        const k = conflicts(r, c);
        if (k < best) { best = k; cands = [c]; } else if (k === best) cands.push(c);
      }
      q[r] = cands[randInt(rng, cands.length)]!;
      add(r, q[r]!, 1);
    }
  }
  throw new Error(`randomSolution: failed for n=${n}`);
}

export interface PreplacedInstance { n: number; p: number; seed: number; queens: Array<[number, number]> }

/** Deterministic instance: P of the N queens of a seeded random solution (design section 7). */
export function generatePreplaced(n: number, p: number, seed: number): PreplacedInstance {
  if (!Number.isInteger(n) || n < MIN_N || n > MAX_N) throw new RangeError(`N must be an integer in [${MIN_N}, ${MAX_N}]`);
  if (!Number.isInteger(p) || p < 0 || p > n - 1) throw new RangeError(`P must be an integer in [0, ${n - 1}]`);
  const rng = mulberry32(seed);
  const sol = randomSolution(n, rng);
  const rows = Array.from({ length: n }, (_, i) => i);
  for (let i = n - 1; i > 0; i--) { const j = randInt(rng, i + 1); [rows[i], rows[j]] = [rows[j]!, rows[i]!]; }
  const chosen = rows.slice(0, p).sort((a, b) => a - b);
  return { n, p, seed, queens: chosen.map((r) => [r, sol[r]!] as [number, number]) };
}
