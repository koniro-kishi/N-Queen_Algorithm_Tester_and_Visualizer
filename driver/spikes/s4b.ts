// Spike S4b: Pause -> Back sampai firstIndex (history terpotong) -> Play. Ukur catch-up replay di main thread.
import cfgRaw from "../../Tester/Configuration/tester.config.json";
import { validateConfig } from "../../Tester/Configuration/config";
import { generatePreplaced } from "../../Tester/Board/preplaced";
import { SessionController } from "../../Tester/Execution/session-controller";
import { browserWorkerFactory } from "../../Tester/Execution/worker-factory";
import {
  PlaybackEngine,
  type PlaybackTarget,
} from "../../Tester/Visualization/playback";
import {
  BoardRenderer,
  type DrawStats,
} from "../../Tester/Visualization/renderer";
import { buildRenderState } from "../../Tester/Visualization/render-state";

export interface S4bOptions {
  n?: number;
  p?: number;
  seed?: number;
  frameBudgetMs?: number; // harus sama dengan default PlaybackEngine (8) kecuali Anda mengubahnya
  maxWallMs?: number;
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const pct = (a: number[], q: number): number => {
  if (a.length === 0) return 0;
  const s = [...a].sort((x, y) => x - y);
  return s[Math.min(s.length - 1, Math.floor(q * s.length))]!;
};
const max = (a: number[]): number => a.reduce((m, v) => (v > m ? v : m), 0);
const avg = (a: number[]): number =>
  a.length ? a.reduce((s, v) => s + v, 0) / a.length : 0;
const r2 = (v: number): number => Math.round(v * 100) / 100;

export async function runS4b(
  host: HTMLElement,
  solver: { name: string; module: string },
  o: S4bOptions = {},
) {
  const n = o.n ?? 20;
  const p = o.p ?? 0;
  const seed = o.seed ?? 1;
  const budgetMs = o.frameBudgetMs ?? 8;
  const maxWallMs = o.maxWallMs ?? 180_000;
  const config = validateConfig(cfgRaw);
  const inst = generatePreplaced(n, p, seed);

  const controller = new SessionController({
    config,
    createWorker: browserWorkerFactory,
    problem: {
      n,
      preplaced: inst.queens,
      moduleUrl: new URL(solver.module, location.origin).href,
      timeoutSeconds: 120,
      onlyShowResult: false,
    },
  });

  const advMs: number[] = [];
  const applied: number[] = [];
  const target: PlaybackTarget = {
    getView: () => controller.getView(),
    subscribe: (fn) => controller.subscribe(fn),
    advance: (m, budget) => {
      const t0 = performance.now();
      const a = controller.advance(m, budget);
      advMs.push(performance.now() - t0); // termasuk emit() / listener
      applied.push(a);
      return a;
    },
  };

  const fail = (reason: string) => {
    const out = document.createElement("div");
    out.innerHTML = `<h3>S4b ABORT: ${reason}</h3>`;
    host.appendChild(out);
    controller.dispose();
    return { pass: false, report: { reason } };
  };

  // ---- Fase A: jalankan sampai history terpotong (tanpa renderer, tanpa listener) ----
  let engineA: PlaybackEngine | null = new PlaybackEngine({
    target,
    delayMs: 0,
  });
  controller.play();
  const aDeadline = performance.now() + maxWallMs;
  while (!controller.getView().truncated) {
    if (controller.getView().state === "Finished") {
      engineA.dispose();
      return fail("run selesai sebelum history terpotong");
    }
    if (performance.now() > aDeadline) {
      engineA.dispose();
      return fail("timeout menunggu truncation");
    }
    await sleep(50);
  }
  controller.pause();
  engineA.dispose();
  engineA = null;
  await sleep(300); // biarkan batch event yang masih di jalan mendarat
  const before = controller.getView();

  // ---- Fase B: Back sampai firstIndex (per 50k, memberi napas ke event loop) ----
  const b0 = performance.now();
  for (;;) {
    if (!controller.getView().controls.back) break;
    for (let i = 0; i < 50_000; i++) controller.back();
    await sleep(0);
  }
  const backMs = performance.now() - b0;
  await sleep(300);
  const afterBack = controller.getView();
  const backChecks = {
    backs: before.cursor - afterBack.cursor,
    backMs: r2(backMs),
    cursorAtFirstIndex: afterBack.cursor === afterBack.firstIndex,
    currentEventNullAtBoundary: afterBack.currentEvent === null,
    lengthUnchanged: afterBack.length === before.length, // solver tidak maju: permit tidak berubah
    maxEventReachedUnchanged:
      afterBack.maxEventReached === before.maxEventReached,
  };

  // ---- Fase C: Play dari firstIndex; ukur catch-up sampai frontier lama ----
  const wrap = document.createElement("div");
  wrap.style.cssText = "width:640px;height:640px;margin:8px 0";
  const canvas = document.createElement("canvas");
  wrap.appendChild(canvas);
  host.appendChild(wrap);
  const renderer = new BoardRenderer(canvas);

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
    /* fallback ke frame gap */
  }

  const gaps: number[] = [];
  let lastTs: number | null = null;
  let stopFrames = false;
  const tick = (ts: number) => {
    if (lastTs !== null) gaps.push(ts - lastTs);
    lastTs = ts;
    if (!stopFrames) requestAnimationFrame(tick);
  };

  const subMs: number[] = [];
  const targetLen = afterBack.length; // frontier saat Pause
  let catchUpAt: number | null = null;
  let snap: {
    gaps: number[];
    long: number[];
    adv: number[];
    app: number[];
    sub: number[];
    draw: DrawStats;
  } | null = null;

  controller.subscribe((v) => {
    const t0 = performance.now();
    renderer.setState(buildRenderState(controller.board, v.currentEvent));
    subMs.push(performance.now() - t0);
    if (catchUpAt === null && v.cursor >= targetLen) {
      catchUpAt = performance.now();
      po?.takeRecords().forEach((e) => longTasks.push(e.duration));
      snap = {
        gaps: gaps.slice(),
        long: longTasks.slice(),
        adv: advMs.slice(),
        app: applied.slice(),
        sub: subMs.slice(),
        draw: { ...renderer.stats },
      };
    }
  });
  renderer.setState(buildRenderState(controller.board, afterBack.currentEvent));

  advMs.length = 0;
  applied.length = 0;
  renderer.resetStats();
  const engineC = new PlaybackEngine({
    target,
    delayMs: 0,
    frameBudgetMs: budgetMs,
  });
  requestAnimationFrame(tick);
  const playStart = performance.now();
  controller.play();

  const deadline = playStart + maxWallMs;
  while (
    controller.getView().state !== "Finished" &&
    performance.now() < deadline
  )
    await sleep(100);
  stopFrames = true;
  po?.disconnect();
  engineC.dispose();

  const fv = controller.getView();
  const res = fv.result;
  const finalBoardMatches =
    res?.status === "Successful" &&
    JSON.stringify(controller.board.view()) === JSON.stringify(res.finalBoard);
  controller.dispose();

  if (!snap || catchUpAt === null)
    return fail("catch-up tidak tercapai dalam batas waktu");
  const s = snap as NonNullable<typeof snap>;
  const catchUpMs = catchUpAt - playStart;
  const replayed = targetLen - afterBack.cursor;

  const report = {
    solver: solver.name,
    n,
    p,
    seed,
    frameBudgetMs: budgetMs,
    finalStatus: fv.status,
    finalBoardMatchesSolver: finalBoardMatches,
    backPhase: backChecks,
    catchUp: {
      events: replayed,
      seconds: r2(catchUpMs / 1000),
      eventsPerSec: Math.round(replayed / (catchUpMs / 1000)),
    },
    advanceMs: {
      calls: s.adv.length,
      p50: r2(pct(s.adv, 0.5)),
      p99: r2(pct(s.adv, 0.99)),
      max: r2(max(s.adv)),
    },
    eventsPerCall: { avg: Math.round(avg(s.app)), max: max(s.app) },
    subscriberMs: {
      calls: s.sub.length,
      p99: r2(pct(s.sub, 0.99)),
      max: r2(max(s.sub)),
    },
    drawMs: {
      draws: s.draw.draws,
      avg: r2(s.draw.totalMs / Math.max(1, s.draw.draws)),
      max: r2(s.draw.maxMs),
    },
    frameGapMs: {
      frames: s.gaps.length,
      p50: r2(pct(s.gaps, 0.5)),
      p99: r2(pct(s.gaps, 0.99)),
      max: r2(max(s.gaps)),
    },
    longTasks: {
      supported: ltSupported,
      count: s.long.length,
      maxMs: r2(max(s.long)),
    },
  };

  const checks = {
    backInvariants:
      backChecks.cursorAtFirstIndex &&
      backChecks.currentEventNullAtBoundary &&
      backChecks.lengthUnchanged &&
      backChecks.maxEventReachedUnchanged,
    budgetHeld: report.advanceMs.max <= 2 * budgetMs, // ambang saya: 2x budget (advance sudah termasuk emit)
    noLongTask: ltSupported ? s.long.length === 0 : max(s.gaps) <= 100,
    replayCorrect: finalBoardMatches,
  };
  const pass = Object.values(checks).every(Boolean);

  const out = document.createElement("div");
  out.innerHTML =
    `<h3>S4b ${solver.name} N=${n} P=${p}: ${pass ? "PASS" : "FAIL"}</h3>` +
    `<pre>${JSON.stringify({ checks, ...report }, null, 2)}</pre>`;
  host.appendChild(out);
  console.log("S4b", { checks, ...report });
  return { pass, report: { checks, ...report } };
}
