// Incremental execution board (design 5.1). O(1) put/remove/check.
export class OperationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'OperationError';
  }
}

export class Board {
  readonly n: number;
  private cells: Uint8Array;
  private locked: Uint8Array;
  private row: Int32Array;
  private col: Int32Array;
  private diagA: Int32Array; // x - y + n - 1
  private diagB: Int32Array; // x + y
  pairs = 0;          // number of attacking pairs
  queenCount = 0;

  constructor(n: number) {
    this.n = n;
    this.cells = new Uint8Array(n * n);
    this.locked = new Uint8Array(n * n);
    this.row = new Int32Array(n);
    this.col = new Int32Array(n);
    this.diagA = new Int32Array(2 * n - 1);
    this.diagB = new Int32Array(2 * n - 1);
  }

  private inBounds(x: number, y: number): boolean {
    return Number.isInteger(x) && Number.isInteger(y) && x >= 0 && y >= 0 && x < this.n && y < this.n;
  }

  /** Returns true iff no attacking pair exists after placement. Throws OperationError on bad input. */
  put(x: number, y: number): boolean {
    if (!this.inBounds(x, y)) throw new OperationError(`putQueen(${x},${y}): out of bounds`);
    const i = x * this.n + y;
    if (this.cells[i]) throw new OperationError(`putQueen(${x},${y}): cell is occupied`);
    const a = x - y + this.n - 1, b = x + y;
    this.pairs += this.row[x]! + this.col[y]! + this.diagA[a]! + this.diagB[b]!;
    this.row[x]!++; this.col[y]!++; this.diagA[a]!++; this.diagB[b]!++;
    this.cells[i] = 1;
    this.queenCount++;
    return this.pairs === 0;
  }

  remove(x: number, y: number): void {
    if (!this.inBounds(x, y)) throw new OperationError(`removeQueen(${x},${y}): out of bounds`);
    const i = x * this.n + y;
    if (!this.cells[i]) throw new OperationError(`removeQueen(${x},${y}): cell is empty`);
    if (this.locked[i]) throw new OperationError(`removeQueen(${x},${y}): cell is a locked preplaced queen`);
    const a = x - y + this.n - 1, b = x + y;
    this.row[x]!--; this.col[y]!--; this.diagA[a]!--; this.diagB[b]!--;
    this.pairs -= this.row[x]! + this.col[y]! + this.diagA[a]! + this.diagB[b]!;
    this.cells[i] = 0;
    this.queenCount--;
  }

  /**
   * ASSUMPTION (the design doc does not define checkQueen precisely): true iff no OTHER queen
   * shares a row, column or diagonal with (x,y), i.e. a queen there would be safe. Works for empty
   * and occupied cells. Out of bounds returns false.
   */
  check(x: number, y: number): boolean {
    if (!this.inBounds(x, y)) return false;
    const self = this.cells[x * this.n + y] ? 1 : 0;
    return (
      this.row[x]! - self === 0 &&
      this.col[y]! - self === 0 &&
      this.diagA[x - y + this.n - 1]! - self === 0 &&
      this.diagB[x + y]! - self === 0
    );
  }

  /** Marks an existing queen as preplaced/locked. */
  lock(x: number, y: number): void {
    if (!this.inBounds(x, y) || !this.cells[x * this.n + y]) throw new OperationError(`lock(${x},${y}): no queen`);
    this.locked[x * this.n + y] = 1;
  }

  isLocked(x: number, y: number): boolean {
    return this.inBounds(x, y) && this.locked[x * this.n + y] === 1;
  }

  /** New N strings of N chars: 'Q' or 'x'. */
  view(): string[] {
    const out: string[] = [];
    for (let r = 0; r < this.n; r++) {
      let s = '';
      for (let c = 0; c < this.n; c++) s += this.cells[r * this.n + c] ? 'Q' : 'x';
      out.push(s);
    }
    return out;
  }
}
