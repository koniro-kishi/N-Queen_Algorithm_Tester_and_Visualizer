// Event log (design 6.2): chunks of 65,536 events, global indices, bounded retention.
// No snapshots: every event is its own inverse, so Back is O(1) on the display board.
export const DEFAULT_CHUNK_SIZE = 65_536;

export class HistoryStore {
  private chunks: Uint32Array[] = [];
  private baseIndex = 0; // global index of chunks[0][0]; always a multiple of chunkSize
  private total = 0;     // global number of events ever appended since the last clear()
  private lastFill = 0;

  constructor(
    private readonly maxRetained: number,
    private readonly chunkSize: number = DEFAULT_CHUNK_SIZE,
  ) {
    if (!Number.isInteger(maxRetained) || maxRetained < 1) throw new RangeError('maxRetained must be a positive integer');
    if (!Number.isInteger(chunkSize) || chunkSize < 1) throw new RangeError('chunkSize must be a positive integer');
  }

  /** Total events appended (global count, also the index the next event will get). */
  get length(): number { return this.total; }
  /** Global index of the oldest retained event. */
  get firstIndex(): number { return this.baseIndex; }
  /** True once the oldest chunk has been dropped ("history truncated" note). */
  get truncated(): boolean { return this.baseIndex > 0; }

  has(i: number): boolean { return i >= this.baseIndex && i < this.total; }

  get(i: number): number {
    if (!this.has(i)) throw new RangeError(`History index ${i} is outside [${this.baseIndex}, ${this.total})`);
    const off = i - this.baseIndex;
    return this.chunks[Math.floor(off / this.chunkSize)]![off % this.chunkSize]!;
  }

  /**
   * Appends a batch (copied). Afterwards drops whole oldest chunks while over the retention cap, but never
   * a chunk that still holds an event at or after `protectFrom` (the display cursor), so Back stays valid.
   */
  append(events: Uint32Array, protectFrom: number = Infinity): void {
    let i = 0;
    while (i < events.length) {
      if (this.chunks.length === 0 || this.lastFill === this.chunkSize) {
        this.chunks.push(new Uint32Array(this.chunkSize));
        this.lastFill = 0;
      }
      const n = Math.min(this.chunkSize - this.lastFill, events.length - i);
      this.chunks[this.chunks.length - 1]!.set(events.subarray(i, i + n), this.lastFill);
      this.lastFill += n;
      this.total += n;
      i += n;
    }
    while (
      this.total - this.baseIndex > this.maxRetained &&
      this.chunks.length > 1 &&
      this.baseIndex + this.chunkSize <= protectFrom
    ) {
      this.chunks.shift();
      this.baseIndex += this.chunkSize;
    }
  }

  clear(): void {
    this.chunks = [];
    this.baseIndex = 0;
    this.total = 0;
    this.lastFill = 0;
  }
}
