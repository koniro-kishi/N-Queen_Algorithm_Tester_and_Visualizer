// Sparse W grid for the Walled N-Queen benchmark (Phase 4).
//
// The (N, P, W) space is far too large to benchmark exhaustively: W alone runs up to
// floor(N^2 * maxWallFraction), and every cell costs K seeds. So the benchmark samples a few W values
// per N, spread over the UI range [1, floor(N^2 * maxWallFraction)]. W = 0 is the classic N-Queen and
// lives in its own file (timelimit.csv), so it never appears here.
//
// Pure and exported so the grid can be unit-tested without running the harness. Part of the benchmark
// definition: changing WALL_FRACTIONS changes which (N, P, W) the app can run.
import { maxWallsByFraction } from "../../Tester/Board/walled";

/** Fractions of N^2 at which W is sampled. */
export const WALL_FRACTIONS = [0.05, 0.1, 0.15, 0.2, 0.25] as const;

/**
 * Sorted, de-duplicated W values (each >= 1) to benchmark for board size n, clamped to the UI limit
 * floor(n^2 * maxWallFraction). May be empty when that limit is 0.
 */
export function walledGridForN(n: number, maxWallFraction: number): number[] {
  const cap = maxWallsByFraction(n, maxWallFraction);
  const set = new Set<number>();
  for (const f of WALL_FRACTIONS) {
    const w = Math.min(cap, Math.max(1, Math.round(n * n * f)));
    if (w >= 1 && w <= cap) set.add(w);
  }
  return [...set].sort((a, b) => a - b);
}
