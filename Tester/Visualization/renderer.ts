// Renderer papan N-Queen (Canvas 2D). Menggambar RenderState; tidak punya state permainan sendiri.
import { COLORS, NO_HIGHLIGHT, type Highlight } from "./highlight";

export interface QueenCell {
  row: number;
  col: number;
  preplaced: boolean;
}

export interface RenderState {
  n: number;
  queens: ReadonlyArray<QueenCell>;
  highlight: Highlight; // x = baris, y = kolom (konvensi proyek)
}

export interface Palette {
  light: string;
  dark: string;
  valid: string;
  conflict: string;
  outline: string;
  queen: string;
  queenOutline: string;
  preplacedQueen: string;
  preplacedOutline: string;
  lock: string;
  border: string;
}

export const DEFAULT_PALETTE: Palette = {
  light: COLORS.light,
  dark: COLORS.dark,
  valid: COLORS.valid,
  conflict: COLORS.conflict,
  outline: "#1a1a1a",
  queen: "#1f1f1f",
  queenOutline: "#ffffff",
  preplacedQueen: "#1b5fc4",
  preplacedOutline: "#ffffff",
  lock: "#ffd23f",
  border: "#3f4f2f",
};

export interface Layout {
  side: number; // sisi canvas, CSS px (bilangan bulat)
  cell: number; // sisi satu sel, CSS px
}

/** Murni, bisa dites di Node. */
export function computeLayout(
  availableWidth: number,
  availableHeight: number,
  n: number,
): Layout {
  const w = Math.max(0, availableWidth);
  const h = availableHeight > 0 ? availableHeight : w; // parent tanpa tinggi eksplisit -> ikut lebar
  const side = Math.floor(Math.min(w, h));
  return { side, cell: n > 0 ? side / n : 0 };
}

// Path2D tidak ada di Node: dibuat saat pertama kali dipakai, bukan saat modul diimpor.
interface Paths {
  queen: Path2D;
  lockBody: Path2D;
  lockShackle: Path2D;
}
let paths: Paths | null = null;
const getPaths = (): Paths =>
  (paths ??= {
    queen: new Path2D(
      "M0.18 0.78 L0.10 0.32 L0.30 0.50 L0.50 0.18 L0.70 0.50 L0.90 0.32 L0.82 0.78 Z " +
        "M0.16 0.82 H0.84 V0.90 H0.16 Z",
    ),
    lockBody: new Path2D("M0.25 0.48 H0.75 V0.90 H0.25 Z"),
    lockShackle: new Path2D(
      "M0.35 0.48 V0.33 A0.15 0.15 0 0 1 0.65 0.33 V0.48",
    ),
  });

export interface DrawStats {
  draws: number;
  totalMs: number;
  maxMs: number;
}

export class BoardRenderer {
  readonly stats: DrawStats = { draws: 0, totalMs: 0, maxMs: 0 };
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private readonly observer: ResizeObserver;
  private palette: Palette;
  private state: RenderState = { n: 0, queens: [], highlight: NO_HIGHLIGHT };
  private layout: Layout = { side: 0, cell: 0 };
  private dpr = 1;
  private rafId = 0;
  private disposed = false;

  constructor(canvas: HTMLCanvasElement, palette: Palette = DEFAULT_PALETTE) {
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Canvas 2D context tidak tersedia");
    const host = canvas.parentElement;
    if (!host)
      throw new Error("Canvas harus sudah berada di dalam elemen parent");
    this.canvas = canvas;
    this.ctx = ctx;
    this.palette = palette;
    this.observer = new ResizeObserver(() => this.resize());
    this.observer.observe(host);
    this.resize();
  }

  /** Aman dipanggil sering: gambar digabung menjadi satu per frame. */
  setState(state: RenderState): void {
    this.state = state;
    this.scheduleDraw();
  }

  setPalette(palette: Palette): void {
    this.palette = palette;
    this.scheduleDraw();
  }

  resetStats(): void {
    this.stats.draws = 0;
    this.stats.totalMs = 0;
    this.stats.maxMs = 0;
  }

  dispose(): void {
    this.disposed = true;
    this.observer.disconnect();
    if (this.rafId) cancelAnimationFrame(this.rafId);
    this.rafId = 0;
  }

  private resize(): void {
    if (this.disposed) return;
    const host = this.canvas.parentElement!;
    this.dpr = window.devicePixelRatio || 1;
    this.layout = computeLayout(
      host.clientWidth,
      host.clientHeight,
      this.state.n,
    );
    const { side } = this.layout;
    this.canvas.style.width = `${side}px`;
    this.canvas.style.height = `${side}px`;
    this.canvas.width = Math.max(1, Math.round(side * this.dpr));
    this.canvas.height = Math.max(1, Math.round(side * this.dpr));
    this.scheduleDraw();
  }

  private scheduleDraw(): void {
    if (this.disposed || this.rafId) return;
    this.rafId = requestAnimationFrame(() => {
      this.rafId = 0;
      const t0 = performance.now();
      if (!this.paint()) return;
      const ms = performance.now() - t0;
      this.stats.draws++;
      this.stats.totalMs += ms;
      if (ms > this.stats.maxMs) this.stats.maxMs = ms;
    });
  }

  /** Mengembalikan false jika hanya memicu resize (belum menggambar). */
  private paint(): boolean {
    if (this.disposed) return false;
    const { n, queens, highlight } = this.state;
    const host = this.canvas.parentElement!;
    const fresh = computeLayout(host.clientWidth, host.clientHeight, n);
    if (fresh.side !== this.layout.side) {
      this.resize();
      return false;
    }
    this.layout = fresh;

    const { ctx, palette } = this;
    const { side, cell } = fresh;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.clearRect(0, 0, side, side);
    if (n <= 0 || cell <= 0) return true;
    const sz = Math.ceil(cell);

    for (let r = 0; r < n; r++) {
      for (let c = 0; c < n; c++) {
        ctx.fillStyle = (r + c) % 2 === 0 ? palette.light : palette.dark;
        ctx.fillRect(c * cell, r * cell, sz, sz);
      }
    }

    // Highlight: x = baris, y = kolom. Fill dulu, outline sesudahnya.
    const lw = Math.max(2, cell * 0.08);
    for (const h of highlight.cells) {
      if (h.x < 0 || h.x >= n || h.y < 0 || h.y >= n) continue;
      if (h.fill) {
        ctx.fillStyle = h.fill === "valid" ? palette.valid : palette.conflict;
        ctx.fillRect(h.y * cell, h.x * cell, sz, sz);
      }
    }
    for (const h of highlight.cells) {
      if (!h.outline || h.x < 0 || h.x >= n || h.y < 0 || h.y >= n) continue;
      ctx.strokeStyle = palette.outline;
      ctx.lineWidth = lw;
      ctx.strokeRect(
        h.y * cell + lw / 2,
        h.x * cell + lw / 2,
        cell - lw,
        cell - lw,
      );
    }

    for (const q of queens) {
      if (q.row < 0 || q.row >= n || q.col < 0 || q.col >= n) continue;
      this.drawQueen(q, cell);
    }

    ctx.strokeStyle = palette.border;
    ctx.lineWidth = 1;
    ctx.strokeRect(0.5, 0.5, side - 1, side - 1);
    return true;
  }

  private drawQueen(q: QueenCell, cell: number): void {
    const { ctx, palette } = this;
    const p = getPaths();
    ctx.save();
    ctx.translate(q.col * cell, q.row * cell);
    ctx.scale(cell, cell);
    ctx.fillStyle = q.preplaced ? palette.preplacedQueen : palette.queen;
    ctx.strokeStyle = q.preplaced
      ? palette.preplacedOutline
      : palette.queenOutline;
    ctx.lineWidth = 0.04;
    ctx.lineJoin = "round";
    ctx.fill(p.queen);
    ctx.stroke(p.queen);
    if (q.preplaced) {
      ctx.translate(0.58, 0.02);
      ctx.scale(0.4, 0.4);
      ctx.fillStyle = palette.lock;
      ctx.strokeStyle = palette.lock;
      ctx.lineWidth = 0.1;
      ctx.fill(p.lockBody);
      ctx.stroke(p.lockShackle);
    }
    ctx.restore();
  }
}
