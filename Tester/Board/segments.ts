// Segment decomposition for Walled N-Queen. A wall ('W') cannot hold a queen and cuts every line through it,
// so each row, column, diagonal (x - y) and anti-diagonal (x + y) splits into maximal wall-free runs
// ("segments"). Two queens attack each other iff they share a segment in some direction.
// Computed once per instance in O(N^2); Board then keeps one counter per segment.

/** Direction index: 0 = row, 1 = column, 2 = diagonal (x - y const), 3 = anti-diagonal (x + y const). */
export type Dir = 0 | 1 | 2 | 3;

export interface Segments {
  n: number;
  /** ids[d][x * n + y] = id of the segment holding that cell in direction d; -1 for a wall cell. */
  ids: [Int32Array, Int32Array, Int32Array, Int32Array];
  /** Number of segments per direction. */
  counts: [number, number, number, number];
}

// Predecessor of (x, y) along each direction. With cells visited row-major, every predecessor is visited first.
const PRED: ReadonlyArray<readonly [number, number]> = [
  [0, -1], // row
  [-1, 0], // column
  [-1, -1], // diagonal
  [-1, 1], // anti-diagonal
];

/** @param wall n*n flags, 1 = wall. */
export function buildSegments(n: number, wall: Uint8Array): Segments {
  const ids: Segments['ids'] = [0, 1, 2, 3].map(() => new Int32Array(n * n).fill(-1)) as Segments['ids'];
  const counts: Segments['counts'] = [0, 0, 0, 0];
  for (let x = 0; x < n; x++) {
    for (let y = 0; y < n; y++) {
      const i = x * n + y;
      if (wall[i]) continue;
      for (let d = 0; d < 4; d++) {
        const px = x + PRED[d]![0], py = y + PRED[d]![1];
        const inside = px >= 0 && py >= 0 && px < n && py < n;
        const pi = px * n + py;
        ids[d]![i] = inside && !wall[pi] ? ids[d]![pi]! : counts[d]!++;
      }
    }
  }
  return { n, ids, counts };
}

/** Each queen occupies one segment per direction, so no placement can exceed the smallest segment count. */
export const queenUpperBound = (s: Segments): number => Math.min(...s.counts);
