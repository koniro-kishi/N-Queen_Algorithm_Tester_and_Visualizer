// segment (see segments.ts) instead of per full line; without walls the segments are exactly the lines,
// so the classic behaviour is unchanged.
import { buildSegments, queenUpperBound, type Segments } from "./segments";

// Incremental execution board (design 5.1). O(1) put/remove/check.
export class OperationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OperationError";
  }
}

export class Board {
  readonly n: number;
  readonly wallCount: number;
  private cells: Uint8Array;
  private locked: Uint8Array;
  private wall: Uint8Array;
  private seg: Segments;
  private cnt: [Int32Array, Int32Array, Int32Array, Int32Array]; // queens per segment, per direction
  pairs = 0; // number of attacking pairs
  queenCount = 0;

  constructor(n: number, walls: ReadonlyArray<readonly [number, number]> = []) {
    this.n = n;
    this.cells = new Uint8Array(n * n);
    this.locked = new Uint8Array(n * n);
    this.wall = new Uint8Array(n * n);
    for (const [x, y] of walls) {
      if (!this.inBounds(x, y))
        throw new OperationError(`wall(${x},${y}): out of bounds`);
      this.wall[x * n + y] = 1;
    }
    this.wallCount = this.wall.reduce((s, v) => s + v, 0);
    this.seg = buildSegments(n, this.wall);
    const c = this.seg.counts;
    this.cnt = [
      new Int32Array(c[0]),
      new Int32Array(c[1]),
      new Int32Array(c[2]),
      new Int32Array(c[3]),
    ];
  }

  private inBounds(x: number, y: number): boolean {
    return (
      Number.isInteger(x) &&
      Number.isInteger(y) &&
      x >= 0 &&
      y >= 0 &&
      x < this.n &&
      y < this.n
    );
  }

  isWall(x: number, y: number): boolean {
    return this.inBounds(x, y) && this.wall[x * this.n + y] === 1;
  }

  hasQueen(x: number, y: number): boolean {
    return this.inBounds(x, y) && this.cells[x * this.n + y] === 1;
  }

  get queenUpperBound(): number {
    return queenUpperBound(this.seg);
  }

  /** Returns true iff no attacking pair exists after placement. Throws OperationError on bad input. */
  put(x: number, y: number): boolean {
    if (!this.inBounds(x, y))
      throw new OperationError(`putQueen(${x},${y}): out of bounds`);
    const i = x * this.n + y;
    if (this.wall[i])
      throw new OperationError(`putQueen(${x},${y}): cell is a wall`);
    if (this.cells[i])
      throw new OperationError(`putQueen(${x},${y}): cell is occupied`);
    const [s0, s1, s2, s3] = this.seg.ids;
    const [c0, c1, c2, c3] = this.cnt;
    const a = s0[i]!,
      b = s1[i]!,
      c = s2[i]!,
      d = s3[i]!;
    this.pairs += c0[a]! + c1[b]! + c2[c]! + c3[d]!;
    c0[a]!++;
    c1[b]!++;
    c2[c]!++;
    c3[d]!++;
    this.cells[i] = 1;
    this.queenCount++;
    return this.pairs === 0;
  }

  remove(x: number, y: number): void {
    if (!this.inBounds(x, y))
      throw new OperationError(`removeQueen(${x},${y}): out of bounds`);
    const i = x * this.n + y;
    if (this.wall[i])
      throw new OperationError(`removeQueen(${x},${y}): cell is a wall`);
    if (!this.cells[i])
      throw new OperationError(`removeQueen(${x},${y}): cell is empty`);
    if (this.locked[i])
      throw new OperationError(
        `removeQueen(${x},${y}): cell is a locked preplaced queen`,
      );
    const [s0, s1, s2, s3] = this.seg.ids;
    const [c0, c1, c2, c3] = this.cnt;
    const a = s0[i]!,
      b = s1[i]!,
      c = s2[i]!,
      d = s3[i]!;
    c0[a]!--;
    c1[b]!--;
    c2[c]!--;
    c3[d]!--;
    this.pairs -= c0[a]! + c1[b]! + c2[c]! + c3[d]!;
    this.cells[i] = 0;
    this.queenCount--;
  }

  attackCount(x: number, y: number): number {
    if (!this.inBounds(x, y)) return -1;
    const i = x * this.n + y;
    if (this.wall[i]) return -1;
    const [s0, s1, s2, s3] = this.seg.ids;
    const [c0, c1, c2, c3] = this.cnt;
    const self = this.cells[i] ? 4 : 0; // an occupied cell counts itself once in each of its 4 segments
    return c0[s0[i]!]! + c1[s1[i]!]! + c2[s2[i]!]! + c3[s3[i]!]! - self;
  }

  /**
   * ASSUMPTION (the design doc does not define checkQueen precisely): true iff no OTHER queen
   * shares a row, column or diagonal with (x,y), i.e. a queen there would be safe. Works for empty
   * and occupied cells. Out of bounds returns false.
   */
  check(x: number, y: number): boolean {
    return this.attackCount(x, y) === 0;
  }

  /** Marks an existing queen as preplaced/locked. */
  lock(x: number, y: number): void {
    if (!this.inBounds(x, y) || !this.cells[x * this.n + y])
      throw new OperationError(`lock(${x},${y}): no queen`);
    this.locked[x * this.n + y] = 1;
  }

  isLocked(x: number, y: number): boolean {
    return this.inBounds(x, y) && this.locked[x * this.n + y] === 1;
  }

  /** New N strings of N chars: 'Q' or 'x'. */
  view(): string[] {
    const out: string[] = [];
    for (let r = 0; r < this.n; r++) {
      let s = "";
      for (let c = 0; c < this.n; c++) {
        const i = r * this.n + c;
        s += this.cells[i] ? "Q" : this.wall[i] ? "W" : "x";
      }
      out.push(s);
    }
    return out;
  }
}
