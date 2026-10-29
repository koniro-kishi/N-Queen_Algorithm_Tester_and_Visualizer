// Playback scheduler (design 6.2): requestAnimationFrame accumulator, not setTimeout (clamped at ~4 ms).
// It only decides HOW MANY recorded events to apply per frame; the controller owns all state.

export const MAX_DELAY_MS = 5000;

/** Slider value 0..5000 where the right end is fastest (design: 5000 on the left, 0 on the right). */
export const sliderToDelayMs = (v: number): number => Math.min(MAX_DELAY_MS, Math.max(0, MAX_DELAY_MS - v));
export const delayMsToSlider = (d: number): number => Math.min(MAX_DELAY_MS, Math.max(0, MAX_DELAY_MS - d));

export interface PlaybackTarget {
  getView(): { state: string };
  subscribe(fn: (v: { state: string }) => void): () => void;
  advance(max: number, budget?: { ms: number; now?: () => number }): number;
}

export interface PlaybackOptions {
  target: PlaybackTarget;
  delayMs: number;
  /** Time spent applying events per frame at delay 0 (and the cap at any delay). Default 8 ms. */
  frameBudgetMs?: number;
  /** A frame gap longer than this (background tab) counts as this much, so playback never bursts. Default 100 ms. */
  maxDtMs?: number;
  raf?: (cb: (ts: number) => void) => number;
  caf?: (handle: number) => void;
}

const isActive = (state: string): boolean => state === 'Running' || state === 'Draining';

export class PlaybackEngine {
  private delayMs: number;
  private readonly frameBudgetMs: number;
  private readonly maxDtMs: number;
  private readonly raf: (cb: (ts: number) => void) => number;
  private readonly caf: (handle: number) => void;
  private readonly unsubscribe: () => void;
  private handle: number | null = null;
  private last: number | null = null;
  private acc = 0;
  private inFrame = false;
  private disposed = false;

  constructor(private readonly o: PlaybackOptions) {
    this.delayMs = Math.max(0, o.delayMs);
    this.frameBudgetMs = o.frameBudgetMs ?? 8;
    this.maxDtMs = o.maxDtMs ?? 100;
    this.raf = o.raf ?? ((cb) => requestAnimationFrame(cb));
    this.caf = o.caf ?? ((h) => cancelAnimationFrame(h));
    this.unsubscribe = o.target.subscribe((v) => this.sync(v.state));
    this.sync(o.target.getView().state);
  }

  get delay(): number { return this.delayMs; }

  setDelay(ms: number): void {
    this.delayMs = Math.max(0, ms);
  }

  dispose(): void {
    this.disposed = true;
    this.unsubscribe();
    this.cancel();
  }

  private sync(state: string): void {
    if (this.disposed || this.inFrame) return; // inside a frame the loop decides itself
    if (isActive(state)) {
      if (this.handle === null) {
        this.last = null;
        this.acc = this.delayMs; // Play shows the next event on the first frame instead of waiting a full delay
        this.schedule();
      }
    } else {
      this.cancel();
    }
  }

  private schedule(): void {
    this.handle = this.raf((ts) => this.frame(ts));
  }

  private cancel(): void {
    if (this.handle !== null) this.caf(this.handle);
    this.handle = null;
  }

  private frame(ts: number): void {
    this.handle = null;
    if (this.disposed || !isActive(this.o.target.getView().state)) return;

    const dt = this.last === null ? 0 : Math.min(Math.max(0, ts - this.last), this.maxDtMs);
    this.last = ts;

    this.inFrame = true;
    try {
      const budget = { ms: this.frameBudgetMs };
      if (this.delayMs <= 0) {
        this.o.target.advance(Infinity, budget);
      } else {
        this.acc += dt;
        const n = Math.floor(this.acc / this.delayMs);
        if (n > 0) {
          const applied = this.o.target.advance(n, budget);
          this.acc -= n * this.delayMs;
          if (applied < n) this.acc = 0; // starved (solver still computing) or budget hit: no catch-up burst
        }
      }
    } finally {
      this.inFrame = false;
    }

    if (!this.disposed && isActive(this.o.target.getView().state)) this.schedule();
  }
}
