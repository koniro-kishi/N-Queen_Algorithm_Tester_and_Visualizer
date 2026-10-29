// Spike S4 (acceptance #11): renderer + playback pada N=20, delay 0. Ukur task panjang di main thread.
import cfgRaw from "../../Tester/Configuration/tester.config.json";
import { validateConfig } from "../../Tester/Configuration/config";
import { generatePreplaced } from "../../Tester/Board/preplaced";
import { SessionController } from "../../Tester/Execution/session-controller";
import { browserWorkerFactory } from "../../Tester/Execution/worker-factory";
import {
  PlaybackEngine,
  type PlaybackTarget,
} from "../../Tester/Visualization/playback";
import { BoardRenderer } from "../../Tester/Visualization/renderer";
import { buildRenderState } from "../../Tester/Visualization/render-state";

export interface S4Options {
  n?: number;
  p?: number;
  seed?: number;
  timeoutSeconds?: number;
  maxWallMs?: number;
}

const pct = (a: number[], q: number): number => {
  if (a.length === 0) return 0;
  const s = [...a].sort((x, y) => x - y);
  return s[Math.min(s.length - 1, Math.floor(q * s.length))]!;
};
const max = (a: number[]): number => a.reduce((m, v) => (v > m ? v : m), 0);
const r2 = (v: number): number => Math.round(v * 100) / 100;

export async function runS4(
  host: HTMLElement,
  solver: { name: string; module: string },
  o: S4Options = {},
) {
  const n = o.n ?? 20;
  const p = o.p ?? 0;
  const seed = o.seed ?? 1;
  const config = validateConfig(cfgRaw);
  const inst = generatePreplaced(n, p, seed);

  const wrap = document.createElement("div");
  wrap.style.cssText = "width:640px;height:640px;margin:8px 0";
  const canvas = document.createElement("canvas");
  wrap.appendChild(canvas);
  host.appendChild(wrap);
  const renderer = new BoardRenderer(canvas);

  const controller = new SessionController({
    config,
    createWorker: browserWorkerFactory,
    problem: {
      n,
      preplaced: inst.queens,
      moduleUrl: new URL(solver.module, location.origin).href,
      timeoutSeconds: o.timeoutSeconds ?? 120,
      onlyShowResult: false,
    },
  });

  // --- metrik ---
  const longTasks: number[] = [];
  let ltSupported = false;
  let po: PerformanceObserver | undefined;
  try {
    ltSupported =
      PerformanceObserver.supportedEntryTypes?.includes("longtask") ?? false;
    if (ltSupported) {
      po = new PerformanceObserver((l) => {
        for (const e of l.getEntries()) longTasks.push(e.duration);
      });
      po.observe({ type: "longtask" });
    }
  } catch {
    /* longtask tidak didukung (Firefox/Safari): fallback ke frame gap */
  }

  const gaps: number[] = [];
  let runStart = 0;
  const bigGaps: Array<{ atS: number; gapMs: number }> = [];
  const vis: Array<{ atS: number; state: string }> = [];
  const onVis = () =>
    vis.push({
      atS: r2((performance.now() - runStart) / 1000),
      state: document.visibilityState,
    });
  document.addEventListener("visibilitychange", onVis);

  let lastTs: number | null = null;
  let stopFrames = false;
  const tick = (ts: number) => {
    if (lastTs !== null) {
      const g = ts - lastTs;
      gaps.push(g);
      if (g > 100 && bigGaps.length < 20)
        bigGaps.push({ atS: r2((ts - runStart) / 1000), gapMs: r2(g) });
    }
    lastTs = ts;
    if (!stopFrames) requestAnimationFrame(tick);
  };

  const advMs: number[] = [];
  const subMs: number[] = [];

  const target: PlaybackTarget = {
    getView: () => controller.getView(),
    subscribe: (fn) => controller.subscribe(fn),
    advance: (m, budget) => {
      const t0 = performance.now();
      const applied = controller.advance(m, budget);
      advMs.push(performance.now() - t0);
      return applied;
    },
  };

  controller.subscribe((v) => {
    const t0 = performance.now();
    renderer.setState(buildRenderState(controller.board, v.currentEvent));
    subMs.push(performance.now() - t0);
  });
  renderer.setState(buildRenderState(controller.board, null));

  const finished = new Promise<boolean>((resolve) => {
    const off = controller.subscribe((v) => {
      if (v.state === "Finished") {
        off();
        resolve(true);
      }
    });
    setTimeout(() => resolve(false), o.maxWallMs ?? 180_000);
  });

  const engine = new PlaybackEngine({ target, delayMs: 0 });
  renderer.resetStats();
  requestAnimationFrame(tick);
  const wall0 = performance.now();
  runStart = performance.now();
  controller.play();
  const completed = await finished;
  const wallMs = performance.now() - wall0;
  await new Promise((r) => setTimeout(r, 500)); // beri satu-dua frame terakhir

  stopFrames = true;
  po?.disconnect();
  document.removeEventListener("visibilitychange", onVis);
  engine.dispose();
  const view = controller.getView();
  controller.dispose();

  const report = {
    solver: solver.name,
    n,
    p,
    seed,
    completed,
    status: view.status,
    events: view.length,
    truncated: view.truncated,
    firstIndex: view.firstIndex,
    wallSeconds: r2(wallMs / 1000),
    longTasks: {
      supported: ltSupported,
      count: longTasks.length,
      maxMs: r2(max(longTasks)),
    },
    frameGapMs: {
      frames: gaps.length,
      p50: r2(pct(gaps, 0.5)),
      p99: r2(pct(gaps, 0.99)),
      max: r2(max(gaps)),
    },
    advanceMs: {
      calls: advMs.length,
      p99: r2(pct(advMs, 0.99)),
      max: r2(max(advMs)),
    },
    subscriberMs: {
      calls: subMs.length,
      p99: r2(pct(subMs, 0.99)),
      max: r2(max(subMs)),
    },
    drawMs: {
      draws: renderer.stats.draws,
      avg: r2(renderer.stats.totalMs / Math.max(1, renderer.stats.draws)),
      max: r2(renderer.stats.maxMs),
    },
    bigGaps,
    visibilityChanges: vis,
  };
  // Verdict ketat: Long Tasks API hanya melaporkan task > 50 ms, jadi satu entri = gagal.
  // Tanpa API itu, frame gap > 100 ms (50 ms task + ~16 ms frame + toleransi) dipakai sebagai proksi.
  const pass =
    completed && (ltSupported ? longTasks.length === 0 : max(gaps) <= 100);

  const out = document.createElement("div");
  out.innerHTML = `<h3>S4 ${solver.name} N=${n} P=${p}: ${pass ? "PASS" : "FAIL"}</h3><pre>${JSON.stringify(report, null, 2)}</pre>`;
  host.appendChild(out);
  console.log("S4", report);
  return { pass, report };
}
