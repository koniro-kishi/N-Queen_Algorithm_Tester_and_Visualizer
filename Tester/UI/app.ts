/// <reference types="vite/client" />
// Wires config panel, controller, playback, renderer, tracer, overlay and status line together.
import './styles.css';
import cfgRaw from '../Configuration/tester.config.json';
import timelimitCsv from '../timelimit.csv?raw';
import { generatePreplaced } from '../Board/preplaced';
import { validateConfig } from '../Configuration/config';
import { effectiveTimeout, formatTimeout, parseTimelimitCsv } from '../Configuration/timelimit';
import type { Board } from '../Board/board';
import { OP_PUT } from '../Execution/protocol';
import { SessionController, type ControllerView, type Problem } from '../Execution/session-controller';
import { browserWorkerFactory } from '../Execution/worker-factory';
import { PlaybackEngine } from '../Visualization/playback';
import { NO_HIGHLIGHT, type Highlight } from '../Visualization/highlight';
import { BoardRenderer, type QueenCell, type RenderState } from '../Visualization/renderer';
import { h } from './dom';
import { ResultOverlay, StatusLine } from './overlay';
import { ConfigPanel, noBenchmarkMessage, type SolverEntry } from './panels';
import { VirtualTracer } from './virtual-tracer';

/**
 * Adapter from the controller's display board to the existing renderer.
 * The highlight rule is design 6.3. If highlight.ts already exports a function for it, call that instead.
 */
function toRenderState(board: Board, v: ControllerView): RenderState {
  const n = board.n;
  const rows = board.view();
  const queens: QueenCell[] = [];
  for (let r = 0; r < n; r++)
    for (let c = 0; c < n; c++) if (rows[r]![c] === 'Q') queens.push({ row: r, col: c, preplaced: board.isLocked(r, c) });

  const cells: Highlight['cells'] = [];
  const e = v.currentEvent;
  if (e) {
    if (e.op === OP_PUT) {
      const attackers = queens.filter(
        (q) => !(q.row === e.x && q.col === e.y) && (q.row === e.x || q.col === e.y || Math.abs(q.row - e.x) === Math.abs(q.col - e.y)),
      );
      if (!e.valid && attackers.length > 0) {
        cells.push({ x: e.x, y: e.y, fill: 'conflict' });
        for (const q of attackers) cells.push({ x: q.row, y: q.col, fill: 'conflict' });
      } else {
        cells.push({ x: e.x, y: e.y, fill: 'valid' });
      }
    } else {
      cells.push({ x: e.x, y: e.y, outline: true }); // REMOVE: outline only
    }
  }
  return { n, queens, highlight: { ...NO_HIGHLIGHT, cells } };
}

const fatal = (root: HTMLElement, msg: string): void => root.replaceChildren(h('p', { class: 'fatal' }, msg));

export async function mountApp(root: HTMLElement): Promise<void> {
  // Design section 2: Atomics.wait back-pressure needs cross-origin isolation.
  if (!crossOriginIsolated) {
    return fatal(root, 'crossOriginIsolated is false. Serve via Vite (npm run dev) so the COOP/COEP headers are sent; do not open via file://.');
  }
  let cfg;
  try {
    cfg = validateConfig(cfgRaw);
  } catch (e) {
    return fatal(root, `tester.config.json: ${(e as Error).message}`);
  }
  let limits;
  try {
    limits = parseTimelimitCsv(timelimitCsv);
  } catch (e) {
    return fatal(root, (e as Error).message);
  }
  let solvers: SolverEntry[];
  try {
    const res = await fetch('/Solver/dist/manifest.json');
    if (!res.ok) throw new Error('not found');
    solvers = (await res.json()).solvers as SolverEntry[];
  } catch {
    return fatal(root, 'Solver/dist/manifest.json not found. Run npm run build:solvers first.');
  }
  if (solvers.length === 0) return fatal(root, 'No solvers in the manifest.');

  // ---- state ---------------------------------------------------------------------------------
  let cur = { n: 8, p: 0, seed: 0 };
  let solver = solvers.find((s) => s.ok) ?? solvers[0]!;
  let only = false;

  const timeoutFor = (): number | undefined => effectiveTimeout(limits, cur.n, cur.p, cfg);
  const canRun = (): boolean => solver.ok && timeoutFor() !== undefined;
  const blockReason = (): string | undefined =>
    !solver.ok
      ? `Solver "${solver.name}" failed to build. Fix the error shown under the solver list and run npm run build:solvers.`
      : timeoutFor() === undefined
        ? noBenchmarkMessage(cur.n, cur.p)
        : undefined;
  const makeProblem = (): Problem => ({
    n: cur.n,
    preplaced: generatePreplaced(cur.n, cur.p, cur.seed).queens,
    moduleUrl: solver.module ? new URL(solver.module, location.origin).href : '',
    timeoutSeconds: timeoutFor() ?? 0, // never used while blocked
    onlyShowResult: only,
  });

  const ctrl = new SessionController({
    config: { lookaheadEvents: cfg.lookaheadEvents, maxRetainedEvents: cfg.maxRetainedEvents },
    problem: makeProblem(),
    createWorker: browserWorkerFactory,
  });
  const playback = new PlaybackEngine({ target: ctrl, delayMs: cfg.defaultStepDelayMs }); // subscribes to ctrl itself
  const apply = (): void => ctrl.configure(makeProblem());

  // ---- UI --------------------------------------------------------------------------------------
  const panel = new ConfigPanel({
    solvers,
    initial: { n: cur.n, p: cur.p, seed: cur.seed, solver: solver.name, onlyShowResult: only, delayMs: cfg.defaultStepDelayMs },
    hasBenchmark: (n, p) => effectiveTimeout(limits, n, p, cfg) !== undefined,
    on: {
      resize: (n) => { cur = { ...cur, n, p: 0 }; apply(); },
      place: (n, p, seed) => { cur = { n, p, seed }; apply(); },
      solver: (s) => { solver = s; apply(); },
      onlyShowResult: (b) => { only = b; apply(); },
      delay: (ms) => playback.setDelay(ms),
      back: () => ctrl.back(),
      stop: () => ctrl.stop(),
      next: () => { if (canRun() || ctrl.getView().state !== 'Idle') ctrl.next(); },
      playPause: () => {
        const v = ctrl.getView();
        if (v.controls.playPause === 'pause') ctrl.pause();
        else if (v.controls.playPause === 'play' && (canRun() || v.state !== 'Idle')) ctrl.play();
      },
    },
  });

  const canvas = h('canvas', { class: 'board', 'aria-label': 'Chess board' });
  const overlay = new ResultOverlay();
  const status = new StatusLine(() => overlay.reopen());
  const tracer = new VirtualTracer((i) => ctrl.getEvent(i));
  root.replaceChildren(
    h('h1', {}, 'N-Queen algorithm tester'),
    h('div', { class: 'layout' }, panel.el, h('section', { class: 'center' }, h('div', { class: 'board-wrap' }, canvas, overlay.el), status.el), tracer.el),
  );
  const renderer = new BoardRenderer(canvas); // after mounting: it sizes itself from the parent's width

  // Repaint at most once per frame, however many events the controller emits.
  let raf = 0;
  const paint = (): void => {
    raf = 0;
    const v = ctrl.getView();
    const t = timeoutFor();
    renderer.setState(toRenderState(ctrl.board, v));
    tracer.update(v);
    panel.setControls(v, canRun());
    overlay.update(v.result);
    status.update(v, {
      canReopen: overlay.isDismissed,
      notice: blockReason(),
      instance: `N=${cur.n}, P=${cur.p}, seed ${cur.seed}, timeout ${t === undefined ? 'none' : `${formatTimeout(t)} s`}`,
    });
  };
  const schedule = (): void => { if (!raf) raf = requestAnimationFrame(paint); };
  ctrl.subscribe(schedule);
  overlay.onVisibilityChange = schedule;
  apply(); // emits, so the first paint happens through the normal path
}
