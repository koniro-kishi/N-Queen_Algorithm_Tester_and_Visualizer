// driver/renderer.ts
// Renderer papan N-Queen berbasis Canvas 2D. Tidak bergantung pada tipe Board/highlight proyek.

export interface QueenCell {
  row: number;
  col: number;
  preplaced: boolean;
}

export interface HighlightCell {
  row: number;
  col: number;
  color: string; // CSS color, boleh pakai alpha, mis. "rgba(255,80,80,0.45)"
}

export interface RenderState {
  n: number;
  queens: ReadonlyArray<QueenCell>;
  highlights?: ReadonlyArray<HighlightCell>;
}

export interface Palette {
  light: string;
  dark: string;
  queen: string;
  queenOutline: string;
  preplacedQueen: string;
  preplacedOutline: string;
  lock: string;
  border: string;
}

export const DEFAULT_PALETTE: Palette = {
  light: "#f0d9b5",
  dark: "#b58863",
  queen: "#1f1f1f",
  queenOutline: "#ffffff",
  preplacedQueen: "#1b5fc4",
  preplacedOutline: "#ffffff",
  lock: "#ffd23f",
  border: "#5a4632",
};

export interface Layout {
  side: number; // sisi canvas dalam CSS px (bilangan bulat)
  cell: number; // sisi satu sel dalam CSS px (boleh pecahan)
}

/** Murni dan bisa dites di Node. */
export function computeLayout(
  availableWidth: number,
  availableHeight: number,
  n: number,
): Layout {
  const w = Math.max(0, availableWidth);
  const h = availableHeight > 0 ? availableHeight : w; // parent tanpa tinggi eksplisit -> ikut lebar
  const side = Math.floor(Math.min(w, h));
  const cell = n > 0 ? side / n : 0;
  return { side, cell };
}

// Path2D dalam koordinat satuan [0,1] x [0,1]; di-scale saat digambar.
const QUEEN_PATH = new Path2D(
  "M0.18 0.78 L0.10 0.32 L0.30 0.50 L0.50 0.18 L0.70 0.50 L0.90 0.32 L0.82 0.78 Z " +
    "M0.16 0.82 H0.84 V0.90 H0.16 Z",
);
const LOCK_BODY = new Path2D("M0.25 0.48 H0.75 V0.90 H0.25 Z");
const LOCK_SHACKLE = new Path2D(
  "M0.35 0.48 V0.33 A0.15 0.15 0 0 1 0.65 0.33 V0.48",
);

export class BoardRenderer {
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private readonly observer: ResizeObserver;
  private palette: Palette;
  private state: RenderState = { n: 0, queens: [] };
  private layout: Layout = { side: 0, cell: 0 };
  private dpr = 1;
  private rafId = 0;
  private disposed = false;

  constructor(canvas: HTMLCanvasElement, palette: Palette = DEFAULT_PALETTE) {
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Canvas 2D context tidak tersedia");
    this.canvas = canvas;
    this.ctx = ctx;
    this.palette = palette;

    const host = canvas.parentElement;
    if (!host)
      throw new Error("Canvas harus sudah berada di dalam elemen parent");
    this.observer = new ResizeObserver(() => this.resize());
    this.observer.observe(host);
    this.resize();
  }

  /** Aman dipanggil ribuan kali per detik: gambar digabung ke satu per frame. */
  setState(state: RenderState): void {
    this.state = state;
    this.scheduleDraw();
  }

  setPalette(palette: Palette): void {
    this.palette = palette;
    this.scheduleDraw();
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
      this.draw();
    });
  }

  private draw(): void {
    if (this.disposed) return;
    const { n, queens, highlights } = this.state;
    // Ukuran dihitung ulang jika N berubah (Resize di UI) tanpa perubahan ukuran host.
    const host = this.canvas.parentElement!;
    const fresh = computeLayout(host.clientWidth, host.clientHeight, n);
    if (fresh.side !== this.layout.side) {
      this.layout = fresh;
      this.resize();
      return;
    }
    this.layout = fresh;

    const { ctx, palette } = this;
    const { side, cell } = this.layout;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.clearRect(0, 0, side, side);
    if (n <= 0 || cell <= 0) return;

    // 1. Kotak papan
    for (let r = 0; r < n; r++) {
      for (let c = 0; c < n; c++) {
        ctx.fillStyle = (r + c) % 2 === 0 ? palette.light : palette.dark;
        ctx.fillRect(c * cell, r * cell, Math.ceil(cell), Math.ceil(cell));
      }
    }

    // 2. Highlight (di bawah ratu)
    if (highlights) {
      for (const h of highlights) {
        if (h.row < 0 || h.row >= n || h.col < 0 || h.col >= n) continue;
        ctx.fillStyle = h.color;
        ctx.fillRect(
          h.col * cell,
          h.row * cell,
          Math.ceil(cell),
          Math.ceil(cell),
        );
      }
    }

    // 3. Ratu
    for (const q of queens) {
      if (q.row < 0 || q.row >= n || q.col < 0 || q.col >= n) continue;
      this.drawQueen(q, cell);
    }

    // 4. Bingkai
    ctx.strokeStyle = palette.border;
    ctx.lineWidth = 1;
    ctx.strokeRect(0.5, 0.5, side - 1, side - 1);
  }

  private drawQueen(q: QueenCell, cell: number): void {
    const { ctx, palette } = this;
    const x = q.col * cell;
    const y = q.row * cell;

    ctx.save();
    ctx.translate(x, y);
    ctx.scale(cell, cell);
    ctx.fillStyle = q.preplaced ? palette.preplacedQueen : palette.queen;
    ctx.strokeStyle = q.preplaced
      ? palette.preplacedOutline
      : palette.queenOutline;
    ctx.lineWidth = 0.04; // dalam satuan sel
    ctx.lineJoin = "round";
    ctx.fill(QUEEN_PATH);
    ctx.stroke(QUEEN_PATH);

    if (q.preplaced) {
      // Tanda kunci di pojok kanan atas sel
      ctx.translate(0.58, 0.02);
      ctx.scale(0.4, 0.4);
      ctx.fillStyle = palette.lock;
      ctx.strokeStyle = palette.lock;
      ctx.lineWidth = 0.1;
      ctx.fill(LOCK_BODY);
      ctx.stroke(LOCK_SHACKLE);
    }
    ctx.restore();
  }
}
