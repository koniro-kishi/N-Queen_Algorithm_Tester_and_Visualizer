// Benchmark harness (Phase 3). Runs the reference solver (default: backtracking) with K seeds, one fresh
// worker thread per run, and writes a CSV plus a matching .meta.json.
//
// Two modes:
//   classic (default): every (N, P), P = 0..N-1  -> Tester/timelimit.csv
//   walled (--walled): P = 0..WALLED_MAX_P and a sparse W grid over [1, floor(N^2 * maxWallFraction)]
//                      -> Tester/timelimit-walled.csv (each row is a Walled N-Queen instance)
//
// Reuses Session + runSolver, so the benchmark measures exactly what production measures (compute time,
// Only Show Result mode, same validator, same watchdog). The only Node-specific part is NodeWorker.
//
// Usage:  npm run bench     -- [--solver backtracking] [--k 20] [--cap <seconds>] [--nmin 4] [--nmax 20] [--out Tester/timelimit.csv]
//         npm run bench:wall -- [--max-wall-fraction 0.25] [same flags]
// This file doubles as the worker entry (isMainThread === false), loaded through driver/bench/worker-entry.mjs.
import { Worker, isMainThread, parentPort } from "node:worker_threads";
import { readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { validateConfig } from "../../Tester/Configuration/config";
import {
  parseTimelimitCsv,
  parseWalledTimelimitCsv,
} from "../../Tester/Configuration/timelimit";
import { generatePreplaced, MAX_N, MIN_N } from "../../Tester/Board/preplaced";
import {
  generateWalled,
  GENERATOR_VERSION,
  TARGET_FRACTION,
  WALLED_MAX_P,
} from "../../Tester/Board/walled";
import { WALL_FRACTIONS, walledGridForN } from "./walled-grid";
import {
  runSolver,
  type SolverModule,
} from "../../Tester/Execution/core/run-solver";
import {
  PERMIT_UNLIMITED,
  createControlBlock,
  type FromWorker,
  type ToWorker,
} from "../../Tester/Execution/protocol";
import {
  Session,
  type SessionResult,
  type WorkerLike,
} from "../../Tester/Execution/session";

// ------------------------------------------------------------------------------------------------
// Worker side
// ------------------------------------------------------------------------------------------------
function workerMain(): void {
  const port = parentPort!;
  port.on("message", async (msg: ToWorker) => {
    if (msg.type !== "start") return;
    const { sessionId, moduleUrl } = msg;
    try {
      const outcome = await runSolver({
        n: msg.n,
        preplaced: msg.preplaced,
        walls: msg.walls,
        target: msg.target,
        recordEvents: msg.recordEvents,
        control: createControlBlock(msg.control),
        loadModule: async (): Promise<SolverModule> => {
          const { default: createSolver } = await import(moduleUrl);
          return createSolver(); // Node: emscripten resolves solver.wasm next to solver.mjs
        },
        emit: (events) =>
          port.postMessage(
            { type: "events", sessionId, events } satisfies FromWorker,
            [events.buffer as ArrayBuffer],
          ),
      });
      port.postMessage({
        type: "outcome",
        sessionId,
        outcome,
      } satisfies FromWorker);
    } catch (err) {
      port.postMessage({
        type: "outcome",
        sessionId,
        outcome: {
          status: "error",
          kind: "trap",
          message: String((err as Error)?.message ?? err),
          computeMs: 0,
          eventCount: 0,
        },
      } satisfies FromWorker);
    } finally {
      // Close the port once we are done so the thread exits on its own. The benchmark runs thousands of
      // workers; a clean shutdown avoids the abrupt Worker.terminate() that corrupts the process heap.
      port.close();
    }
  });
}

// ------------------------------------------------------------------------------------------------
// Main-thread side
// ------------------------------------------------------------------------------------------------
class NodeWorker implements WorkerLike {
  onmessage: WorkerLike["onmessage"] = null;
  onerror: WorkerLike["onerror"] = null;
  private readonly w: Worker;
  private readonly exited: Promise<number>;
  private sawOutcome = false;
  private forced = false;

  constructor() {
    // .mjs bootstrap, because Worker() does not accept a .ts path on every Node version.
    this.w = new Worker(new URL("./worker-entry.mjs", import.meta.url));
    this.exited = new Promise<number>((resolve) =>
      this.w.on("exit", (code: number) => resolve(code)),
    );
    this.w.on("message", (data: FromWorker) => {
      if (data.type === "outcome") this.sawOutcome = true;
      this.onmessage?.({ data });
    });
    this.w.on("error", (e: Error) => this.onerror?.({ message: e.message }));
  }
  postMessage(msg: ToWorker): void {
    this.w.postMessage(msg);
  }
  terminate(): Promise<number> {
    // After posting its outcome the worker closes its port and exits on its own; waiting for that clean
    // exit avoids the abrupt Worker.terminate() that corrupts the heap across thousands of runs. A solver
    // that never posts an outcome (watchdog timeout) is force-terminated, with a safety net if a worker
    // that did post one still fails to exit.
    if (!this.sawOutcome) {
      this.force();
    } else {
      const t = setTimeout(() => this.force(), 2000);
      void this.exited.then(() => clearTimeout(t));
    }
    return this.exited;
  }
  private force(): void {
    if (this.forced) return;
    this.forced = true;
    void this.w.terminate();
  }
}

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

function runOnce(
  n: number,
  preplaced: Array<[number, number]>,
  walls: Array<[number, number]>,
  target: number,
  moduleUrl: string,
  capSeconds: number,
): Promise<SessionResult> {
  return new Promise<SessionResult>((resolve) => {
    let worker: NodeWorker | undefined;
    // A benchmark run creates one worker thread and thousands of runs create thousands of them.
    // Awaiting terminate() (the thread having really exited) before the next run starts keeps
    // teardown from overlapping the next worker's startup, which otherwise corrupts the process heap.
    const done = (r: SessionResult): void => {
      void (worker?.terminate() ?? Promise.resolve()).then(() => resolve(r));
    };
    new Session({
      n,
      preplaced,
      walls,
      target,
      moduleUrl,
      timeoutSeconds: capSeconds, // Session marks > cap as 'Failed' (watchdog or post-hoc), same as production
      cutoffSeconds: capSeconds, // benchmark: anything above the cap is Failed, no Overtime band
      recordEvents: false, // Only Show Result: no event recording, no back-pressure
      initialPermit: PERMIT_UNLIMITED,
      createWorker: () => (worker = new NodeWorker()),
      onFinish: done,
    }).start();
  });
}

async function main(): Promise<void> {
  const repo = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "..",
    "..",
  );
  const cfg = validateConfig(
    JSON.parse(
      readFileSync(
        path.join(repo, "Tester/Configuration/tester.config.json"),
        "utf8",
      ),
    ),
  );

  const walled = process.argv.includes("--walled");
  const solverName = arg("solver") ?? "backtracking";
  const k = Number(arg("k") ?? 20);
  const cap = Number(arg("cap") ?? cfg.benchCapSeconds);
  const nMin = Number(arg("nmin") ?? MIN_N);
  const nMax = Number(arg("nmax") ?? MAX_N);
  const maxWallFraction = Number(
    arg("max-wall-fraction") ?? cfg.maxWallFraction,
  );
  const outCsv = path.resolve(
    repo,
    arg("out") ??
      (walled ? "Tester/timelimit-walled.csv" : "Tester/timelimit.csv"),
  );
  const outMeta = outCsv.replace(/\.csv$/, ".meta.json");

  if (!Number.isInteger(k) || k < 1)
    throw new Error("--k must be a positive integer");
  if (!Number.isFinite(cap) || cap <= 0) throw new Error("--cap must be > 0");
  if (
    !Number.isInteger(nMin) ||
    !Number.isInteger(nMax) ||
    nMin < MIN_N ||
    nMax > MAX_N ||
    nMin > nMax
  ) {
    throw new Error(
      `--nmin/--nmax must be integers with ${MIN_N} <= nmin <= nmax <= ${MAX_N}`,
    );
  }
  if (
    walled &&
    (!Number.isFinite(maxWallFraction) ||
      maxWallFraction <= 0 ||
      maxWallFraction > 1)
  )
    throw new Error("--max-wall-fraction must be in (0, 1]");

  const manifestPath = path.join(repo, "Solver/dist/manifest.json");
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  const entry = manifest.solvers.find(
    (s: { name: string; ok: boolean }) => s.name === solverName && s.ok,
  );
  if (!entry)
    throw new Error(
      `Solver "${solverName}" not found or build failed in ${manifestPath}. Run npm run build:solvers.`,
    );
  const moduleUrl = pathToFileURL(
    path.join(repo, "Solver/dist", solverName, "solver.mjs"),
  ).href;

  console.log(
    `solver=${solverName} K=${k} cap=${cap}s N=${nMin}..${nMax}` +
      (walled
        ? ` mode=walled P=0..${WALLED_MAX_P} W<=floor(N^2*${maxWallFraction})`
        : " mode=classic"),
  );

  const rows: string[] = [];
  // Walled: a whole (N, P, W) is skipped when the instance cannot be generated or any seed exceeds the cap.
  const skipped: Array<{
    n: number;
    p: number;
    w: number;
    seed: number;
    reason: string;
    seedsRun: number;
  }> = [];
  // Classic (kept exactly as before): a whole (N, P) is discarded when any seed exceeds the cap.
  const discarded: Array<{
    n: number;
    p: number;
    seed: number;
    elapsedMs: number;
    seedsRun: number;
  }> = [];
  let totalRuns = 0;
  const t0 = Date.now();

  if (walled) {
    for (let n = nMin; n <= nMax; n++) {
      for (let p = 0; p <= WALLED_MAX_P; p++) {
        for (const w of walledGridForN(n, maxWallFraction)) {
          let maxMs = 0;
          let drop: (typeof skipped)[number] | undefined;
          for (let seed = 0; seed < k; seed++) {
            let inst;
            try {
              inst = generateWalled(n, p, w, seed);
            } catch (e) {
              drop = {
                n,
                p,
                w,
                seed,
                reason: `no instance: ${(e as Error).message}`,
                seedsRun: seed + 1,
              };
              break;
            }
            const r = await runOnce(
              n,
              inst.queens,
              inst.walls,
              inst.q,
              moduleUrl,
              cap,
            );
            totalRuns++;
            if (r.status === "Successful") {
              maxMs = Math.max(maxMs, r.computeMs);
            } else if (r.status === "Failed") {
              drop = {
                n,
                p,
                w,
                seed,
                reason: `over cap (${(r.elapsedMs / 1000).toFixed(3)}s)`,
                seedsRun: seed + 1,
              };
              break;
            } else {
              // Invalid Solution / Execution Error / Cancelled: the reference solver itself is broken.
              const detail = "message" in r ? r.message : "";
              throw new Error(
                `Reference solver failed: ${r.status} at N=${n} P=${p} W=${w} seed=${seed}. ${detail}`,
              );
            }
          }
          if (drop) {
            skipped.push(drop);
            console.log(
              `N=${n} P=${p} W=${w}: ${drop.reason} at seed ${drop.seed} -> skipped`,
            );
          } else {
            const limit = Math.max(maxMs / 1000, 1e-6); // parseWalledTimelimitCsv requires limit > 0
            rows.push(`${n},${p},${w},${limit.toFixed(6)}`);
            console.log(`N=${n} P=${p} W=${w}: max ${maxMs.toFixed(3)} ms`);
          }
        }
      }
    }
  } else {
    for (let n = nMin; n <= nMax; n++) {
      for (let p = 0; p <= n - 1; p++) {
        let maxMs = 0;
        let over: (typeof discarded)[number] | undefined;
        for (let seed = 0; seed < k; seed++) {
          const r = await runOnce(
            n,
            generatePreplaced(n, p, seed).queens,
            [],
            n,
            moduleUrl,
            cap,
          );
          totalRuns++;
          if (r.status === "Successful") {
            maxMs = Math.max(maxMs, r.computeMs);
          } else if (r.status === "Failed") {
            // One seed above the cap discards the whole (N, P): the remaining seeds cannot change that.
            over = { n, p, seed, elapsedMs: r.elapsedMs, seedsRun: seed + 1 };
            break;
          } else {
            // Invalid Solution / Execution Error / Cancelled: the reference solver itself is broken. Do not emit a CSV.
            const detail = "message" in r ? r.message : "";
            throw new Error(
              `Reference solver failed: ${r.status} at N=${n} P=${p} seed=${seed}. ${detail}`,
            );
          }
        }
        if (over) {
          discarded.push(over);
          console.log(
            `N=${n} P=${p}: over cap at seed ${over.seed} -> discarded`,
          );
        } else {
          const limit = Math.max(maxMs / 1000, 1e-6); // parseTimelimitCsv requires limit > 0
          rows.push(`${n},${p},${limit.toFixed(6)}`);
          console.log(`N=${n} P=${p}: max ${maxMs.toFixed(3)} ms`);
        }
      }
    }
  }

  const csv = `${walled ? "N,P,W,limit" : "N,P,limit"}\n${rows.join("\n")}${rows.length ? "\n" : ""}`;
  (walled ? parseWalledTimelimitCsv : parseTimelimitCsv)(csv); // self-check: what we write must pass the parser the app uses
  writeFileSync(outCsv, csv);

  const cpus = os.cpus();
  writeFileSync(
    outMeta,
    JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        mode: walled ? "walled" : "classic",
        solver: solverName,
        emsdk: manifest.emsdk,
        manifestGeneratedAt: manifest.generatedAt,
        k,
        seeds: [0, k - 1],
        benchCapSeconds: cap,
        nRange: [nMin, nMax],
        recordEvents: false,
        ...(walled
          ? {
              generatorVersion: GENERATOR_VERSION,
              targetFraction: TARGET_FRACTION,
              maxWallFraction,
              pRange: [0, WALLED_MAX_P],
              wFractions: WALL_FRACTIONS,
              wGrid: Object.fromEntries(
                Array.from({ length: nMax - nMin + 1 }, (_, i) => nMin + i).map(
                  (n) => [String(n), walledGridForN(n, maxWallFraction)],
                ),
              ),
              rule: "limit = max computeMs over seeds (seconds); (N,P,W) is skipped when the instance cannot be generated or any seed exceeds the cap",
            }
          : {
              rule: "limit = max computeMs over seeds (seconds); (N,P) with any seed above cap is omitted",
            }),
        rowsWritten: rows.length,
        ...(walled ? { skipped } : { discarded }),
        totalRuns,
        wallSeconds: Math.round((Date.now() - t0) / 1000),
        host: {
          node: process.version,
          platform: process.platform,
          arch: process.arch,
          cpu: cpus[0]?.model,
          logicalCpus: cpus.length,
        },
      },
      null,
      2,
    ) + "\n",
  );
  console.log(
    `\nWrote ${rows.length} rows to ${outCsv} (${walled ? skipped.length : discarded.length} ${walled ? "skipped" : "discarded"}). Meta: ${outMeta}`,
  );
}

if (isMainThread) {
  main().catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  });
} else {
  workerMain();
}
