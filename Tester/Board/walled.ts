// Walled N-Queen instance generator (constructive feasibility).
//
// An instance is (N, P, W, seed). Generation is witness-first:
//   1. pick W wall cells (seeded),
//   2. search for a witness: a set of Q > N queens, no two attacking (walls cut attacks),
//   3. Q := size of the witness found (the target; NOT proven maximum),
//   4. preplaced queens := P queens of the witness.
// An instance that was generated therefore has a known solution, so it is feasible by construction.
//
// Reproducibility: the search is bounded by step counts, never by wall-clock time, and draws only from a
// mulberry32 stream seeded with `seed`, so (N, W, seed) -> (walls, Q, witness) is identical on every machine.
// Any change to the search or to the budgets below must bump GENERATOR_VERSION: stored Q values depend on it.
import { Board } from './board';
import { MAX_N, MIN_N } from './preplaced';
import { mulberry32, randInt } from './rng';
import { validateBoard } from './validator';

export const GENERATOR_VERSION = 'walled-v1';

/** Search budgets. Part of the generator definition (see GENERATOR_VERSION). */
export const WITNESS_BUDGET = {
  /** Different wall sets tried (from the same seeded stream) before giving up. */
  wallAttempts: 8,
  /** Min-conflicts steps allowed for each target size k. */
  stepsPerTarget: 3000,
} as const;

export type Cell = [number, number];

export interface WalledInstance {
  generator: string;
  n: number;
  p: number;
  w: number;
  seed: number;
  /** Target number of queens (> n). Feasible: `witness` reaches it. Not claimed to be the maximum. */
  q: number;
  /** Wall cells, row-major order. */
  walls: Cell[];
  /** The P preplaced queens (a subset of `witness`), row-major order. */
  queens: Cell[];
  /** A full solution with q queens, row-major order. */
  witness: Cell[];
}

/** Valid (N, W) and range, but no witness with more than N queens was found within the search budget. */
export class WalledInfeasibleError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'WalledInfeasibleError';
  }
}

const rowMajor = (a: Cell, b: Cell): number => a[0] - b[0] || a[1] - b[1];

/** Largest W the board can hold while still leaving room for N + 1 queens. */
export const maxWallsForN = (n: number): number => n * n - (n + 1);

function pickWalls(n: number, w: number, rng: () => number): Cell[] {
  const idx = Array.from({ length: n * n }, (_, i) => i);
  for (let i = 0; i < w; i++) {
    const j = i + randInt(rng, idx.length - i);
    [idx[i], idx[j]] = [idx[j]!, idx[i]!];
  }
  return idx.slice(0, w).map((i): Cell => [Math.floor(i / n), i % n]).sort(rowMajor);
}

/** Min-conflicts on a fixed queen count. Returns a conflict-free placement or null when the budget runs out. */
function minConflicts(n: number, walls: Cell[], start: Cell[], free: Cell[], rng: () => number): Cell[] | null {
  const board = new Board(n, walls);
  const queens = start.map((q): Cell => [q[0], q[1]]);
  for (const [x, y] of queens) board.put(x, y);

  for (let step = 0; ; step++) {
    if (board.pairs === 0) return queens;
    if (step === WITNESS_BUDGET.stepsPerTarget) return null;

    // uniform pick among queens that are attacked (reservoir sampling)
    let seen = 0, pick = -1;
    for (let i = 0; i < queens.length; i++) {
      if (board.attackCount(queens[i]![0], queens[i]![1]) > 0 && randInt(rng, ++seen) === 0) pick = i;
    }
    const [px, py] = queens[pick]!;
    board.remove(px, py);

    // least-attacked free cell, random tie-break (the vacated cell is allowed)
    let best = Infinity, ties = 0, bx = px, by = py;
    for (const [x, y] of free) {
      if (board.hasQueen(x, y)) continue;
      const k = board.attackCount(x, y);
      if (k < best) { best = k; ties = 1; bx = x; by = y; }
      else if (k === best && randInt(rng, ++ties) === 0) { bx = x; by = y; }
    }
    board.put(bx, by);
    queens[pick] = [bx, by];
  }
}

/** Grows a conflict-free queen set one queen at a time starting from N + 1. Null if even N + 1 fails. */
function growWitness(n: number, walls: Cell[], rng: () => number): Cell[] | null {
  const probe = new Board(n, walls);
  const ub = probe.queenUpperBound;
  const free: Cell[] = [];
  for (let x = 0; x < n; x++) for (let y = 0; y < n; y++) if (!probe.isWall(x, y)) free.push([x, y]);
  if (ub <= n || free.length <= n) return null;

  const randomExtra = (taken: Cell[]): Cell => {
    const used = new Set(taken.map(([x, y]) => x * n + y));
    const rest = free.filter(([x, y]) => !used.has(x * n + y));
    return rest[randInt(rng, rest.length)]!;
  };

  let current: Cell[] = [];
  let start: Cell[] = [];
  for (let i = 0; i < n + 1; i++) start.push(randomExtra(start));

  for (;;) {
    const found = minConflicts(n, walls, start, free, rng);
    if (!found) break;
    current = found;
    if (current.length >= ub || current.length >= free.length) break;
    start = [...current, randomExtra(current)];
  }
  return current.length > n ? current : null;
}

/**
 * Deterministic Walled N-Queen instance. Throws RangeError for inputs outside the supported ranges and
 * WalledInfeasibleError when no instance with Q > N exists within the search budget (e.g. too few walls)
 * or when P > Q - 1.
 */
export function generateWalled(n: number, p: number, w: number, seed: number): WalledInstance {
  if (!Number.isInteger(n) || n < MIN_N || n > MAX_N) throw new RangeError(`N must be an integer in [${MIN_N}, ${MAX_N}]`);
  if (!Number.isInteger(w) || w < 0 || w > maxWallsForN(n)) throw new RangeError(`W must be an integer in [0, ${maxWallsForN(n)}]`);
  if (!Number.isInteger(p) || p < 0) throw new RangeError('P must be a non-negative integer');
  if (!Number.isInteger(seed) || seed < 0) throw new RangeError('seed must be a non-negative integer');

  const rng = mulberry32(seed);
  let walls: Cell[] = [];
  let witness: Cell[] | null = null;
  for (let attempt = 0; attempt < WITNESS_BUDGET.wallAttempts && !witness; attempt++) {
    walls = pickWalls(n, w, rng);
    witness = growWitness(n, walls, rng);
  }
  if (!witness) {
    throw new WalledInfeasibleError(`No placement of more than ${n} queens found for N=${n}, W=${w}, seed ${seed}`);
  }
  witness = [...witness].sort(rowMajor);
  const q = witness.length;
  if (p > q - 1) throw new WalledInfeasibleError(`P=${p} exceeds Q-1=${q - 1} for N=${n}, W=${w}, seed ${seed}`);

  const order = Array.from({ length: q }, (_, i) => i);
  for (let i = q - 1; i > 0; i--) { const j = randInt(rng, i + 1); [order[i], order[j]] = [order[j]!, order[i]!]; }
  const queens = order.slice(0, p).map((i) => witness![i]!).sort(rowMajor);

  // Self-check with the independent validator: a generated instance must really be solved by its witness.
  const grid = Array.from({ length: n }, () => Array<string>(n).fill('x'));
  walls.forEach(([x, y]) => (grid[x]![y] = 'W'));
  witness.forEach(([x, y]) => (grid[x]![y] = 'Q'));
  const check = validateBoard(grid.map((r) => r.join('')), n, queens, { walls, target: q });
  if (!check.ok) throw new Error(`walled generator produced an invalid witness: ${check.message}`);

  return { generator: GENERATOR_VERSION, n, p, w, seed, q, walls, queens, witness };
}
