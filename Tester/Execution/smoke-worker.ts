// Spike S1 worker: loads a compiled solver and runs it against the real incremental Board.
// Replaced later by solver-worker.ts + core/run-solver.ts (events, permits, watchdog).
import { Board } from '../Board/board';

interface Req { moduleUrl: string; n: number }

self.onmessage = async (e: MessageEvent<Req>) => {
  const { moduleUrl, n } = e.data;
  const board = new Board(n);
  let events = 0;
  (globalThis as any).__nqHost = {
    put: (x: number, y: number) => { events++; return board.put(x, y); },
    remove: (x: number, y: number) => { events++; board.remove(x, y); },
    check: (x: number, y: number) => board.check(x, y),
    view: () => new TextEncoder().encode(board.view().join('')),
  };
  try {
    const { default: createSolver } = await import(/* @vite-ignore */ moduleUrl);
    const mod = await createSolver({ locateFile: (f: string) => new URL(f, moduleUrl).href });
    const t0 = performance.now();
    const rc: number = mod._nq_run(n);
    const ms = performance.now() - t0;
    (self as any).postMessage({ ok: true, rc, ms, events, board: board.view().map((r) => r.replace(/x/g, '.')) });
  } catch (err) {
    (self as any).postMessage({ ok: false, error: String((err as Error)?.message ?? err) });
  }
};
