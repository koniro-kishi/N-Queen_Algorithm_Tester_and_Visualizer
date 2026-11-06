/// <reference types="vite/client" />
// Wires config panel, controller, playback, renderer, tracer, overlay and status line together.
// W = 0 is the classic N-Queen; W > 0 is Walled N-Queen (walls + target Q from the generator).
import "./styles.css";
import cfgRaw from "../Configuration/tester.config.json";
import timelimitCsv from "../timelimit.csv?raw";
import walledTimelimitCsv from "../timelimit-walled.csv?raw";
import { InstanceCache } from "../Board/instance";
import { validateConfig } from "../Configuration/config";
import {
  effectiveTimeout,
  effectiveWalledTimeout,
  formatTimeout,
  parseTimelimitCsv,
  parseWalledTimelimitCsv,
  walledWallsFor,
} from "../Configuration/timelimit";
import {
  SessionController,
  type Problem,
} from "../Execution/session-controller";
import { browserWorkerFactory } from "../Execution/worker-factory";
import { PlaybackEngine } from "../Visualization/playback";
import { BoardRenderer } from "../Visualization/renderer";
import { buildRenderState } from "../Visualization/render-state";
import { h } from "./dom";
import { MeasuringOverlay } from "./measuring-overlay";
import { ResultOverlay, StatusLine } from "./overlay";
import { ConfigPanel, noBenchmarkMessage, type SolverEntry } from "./panels";
import { OpsChart } from "./ops-chart";
import { VirtualTracer } from "./virtual-tracer";

const fatal = (root: HTMLElement, msg: string): void =>
  root.replaceChildren(h("p", { class: "fatal" }, msg));

export async function mountApp(root: HTMLElement): Promise<void> {
  // Design section 2: Atomics.wait back-pressure needs cross-origin isolation.
  if (!crossOriginIsolated) {
    return fatal(
      root,
      "crossOriginIsolated is false. Serve via Vite (npm run dev) so the COOP/COEP headers are sent; do not open via file://.",
    );
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
  let walledLimits;
  try {
    walledLimits = parseWalledTimelimitCsv(walledTimelimitCsv);
  } catch (e) {
    return fatal(root, (e as Error).message);
  }
  let solvers: SolverEntry[];
  try {
    const res = await fetch("/Solver/dist/manifest.json");
    if (!res.ok) throw new Error("not found");
    solvers = (await res.json()).solvers as SolverEntry[];
  } catch {
    return fatal(
      root,
      "Solver/dist/manifest.json not found. Run npm run build:solvers first.",
    );
  }
  if (solvers.length === 0) return fatal(root, "No solvers in the manifest.");

  // ---- state ---------------------------------------------------------------------------------
  let cur = { n: 8, p: 0, w: 0, seed: 0 };
  let solver = solvers.find((s) => s.ok) ?? solvers[0]!;
  let only = false;

  const instances = new InstanceCache();
  const built = () => instances.get(cur.n, cur.p, cur.w, cur.seed);
  const timeoutAt = (n: number, p: number, w: number): number | undefined =>
    w > 0
      ? effectiveWalledTimeout(walledLimits, n, p, w, cfg)
      : effectiveTimeout(limits, n, p, cfg);
  const timeoutFor = (): number | undefined => timeoutAt(cur.n, cur.p, cur.w);
  const canRun = (): boolean =>
    solver.ok && built().ok && timeoutFor() !== undefined;
  const blockReason = (): string | undefined => {
    if (!solver.ok)
      return `Solver "${solver.name}" failed to build. Fix the error shown under the solver list and run npm run build:solvers.`;
    const b = built();
    if (!b.ok) return b.reason;
    return timeoutFor() === undefined
      ? noBenchmarkMessage(cur.n, cur.p, cur.w)
      : undefined;
  };
  const makeProblem = (): Problem => {
    const b = built();
    return {
      n: cur.n,
      // An instance that cannot be built shows an empty board and stays blocked (see blockReason).
      preplaced: b.ok ? b.preplaced : [],
      walls: b.ok ? b.walls : [],
      target: b.ok ? b.target : cur.n,
      moduleUrl: solver.module
        ? new URL(solver.module, location.origin).href
        : "",
      timeoutSeconds: timeoutFor() ?? 0, // never used while blocked
      cutoffSeconds: cfg.cutoffSeconds,
      onlyShowResult: only,
    };
  };

  const ctrl = new SessionController({
    config: {
      lookaheadEvents: cfg.lookaheadEvents,
      maxRetainedEvents: cfg.maxRetainedEvents,
    },
    problem: makeProblem(),
    createWorker: browserWorkerFactory,
  });
  const playback = new PlaybackEngine({
    target: ctrl,
    delayMs: cfg.defaultStepDelayMs,
  }); // subscribes to ctrl itself
  const apply = (): void => ctrl.configure(makeProblem());

  // ---- UI --------------------------------------------------------------------------------------
  const panel = new ConfigPanel({
    solvers,
    initial: {
      n: cur.n,
      p: cur.p,
      w: cur.w,
      seed: cur.seed,
      solver: solver.name,
      onlyShowResult: only,
      delayMs: cfg.defaultStepDelayMs,
    },
    hasBenchmark: (n, p, w) => timeoutAt(n, p, w) !== undefined,
    availableWalls: (n, p) => walledWallsFor(walledLimits, n, p),
    feasibility: (n, p, w, seed) => {
      const b = instances.get(n, p, w, seed);
      return b.ok ? undefined : b.reason;
    },
    on: {
      resize: (n) => {
        cur = { ...cur, n, p: 0, w: 0 };
        apply();
      },
      place: (n, p, w, seed) => {
        cur = { n, p, w, seed };
        apply();
      },
      solver: (s) => {
        solver = s;
        apply();
      },
      onlyShowResult: (b) => {
        only = b;
        apply();
      },
      delay: (ms) => playback.setDelay(ms),
      back: () => ctrl.back(),
      stop: () => ctrl.stop(),
      next: () => {
        if (canRun() || ctrl.getView().state !== "Idle") ctrl.next();
      },
      playPause: () => {
        const v = ctrl.getView();
        if (v.controls.playPause === "pause") ctrl.pause();
        else if (
          v.controls.playPause === "play" &&
          (canRun() || v.state !== "Idle")
        )
          ctrl.play();
      },
    },
  });

  const canvas = h("canvas", { class: "board", "aria-label": "Chess board" });
  const measuring = new MeasuringOverlay();
  const overlay = new ResultOverlay();
  const status = new StatusLine(() => overlay.reopen());
  const opsChart = new OpsChart();
  const tracer = new VirtualTracer((i) => ctrl.getEvent(i));
  root.replaceChildren(
    h("h1", {}, "N-Queen algorithm tester"),
    h(
      "div",
      { class: "layout" },
      panel.el,
      h(
        "section",
        { class: "center" },
        h("div", { class: "board-wrap" }, canvas, measuring.el, overlay.el),
        status.el,
        opsChart.el,
      ),
      tracer.el,
    ),
  );
  const renderer = new BoardRenderer(canvas); // after mounting: it sizes itself from the parent's width

  const instanceText = (): string => {
    const b = built();
    const t = timeoutFor();
    const parts = [`N=${cur.n}`, `P=${cur.p}`];
    if (cur.w > 0) parts.push(`W=${cur.w}`);
    parts.push(`seed ${cur.seed}`);
    if (cur.w > 0 && b.ok) parts.push(`target Q=${b.target}`);
    parts.push(
      `benchmark ${t === undefined ? "none" : `${formatTimeout(t)} s`}`,
      `cutoff ${formatTimeout(cfg.cutoffSeconds)} s`,
    );
    return parts.join(", ");
  };

  // Repaint at most once per frame, however many events the controller emits.
  let raf = 0;
  const paint = (): void => {
    raf = 0;
    const v = ctrl.getView();
    renderer.setState(buildRenderState(ctrl.board, v.currentEvent));
    tracer.update(v);
    opsChart.update(v.opCounts);
    panel.setControls(v, canRun());
    measuring.update(v.state === "Measuring");
    overlay.update(v.result);
    status.update(v, {
      canReopen: overlay.isDismissed,
      notice: blockReason(),
      instance: instanceText(),
    });
  };
  const schedule = (): void => {
    if (!raf) raf = requestAnimationFrame(paint);
  };
  ctrl.subscribe(schedule);
  overlay.onVisibilityChange = schedule;
  apply(); // emits, so the first paint happens through the normal path
}
