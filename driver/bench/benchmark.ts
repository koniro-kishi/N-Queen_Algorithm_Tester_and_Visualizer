// Benchmark harness (Phase 3). Runs the reference solver (default: backtracking) over every (N, P) with
// K seeds, one fresh worker thread per run, and writes Tester/timelimit.csv + Tester/timelimit.meta.json.
//
// Reuses Session + runSolver, so the benchmark measures exactly what production measures (compute time,
// Only Show Result mode, same validator, same watchdog). The only Node-specific part is NodeWorker.
//
// Usage:  npm run bench -- [--solver backtracking] [--k 20] [--cap <seconds>] [--nmin 4] [--nmax 20] [--out Tester/timelimit.csv]
// This file doubles as the worker entry (isMainThread === false), loaded through driver/bench/worker-entry.mjs.
import { Worker, isMainThread, parentPort } from "node:worker_threads";
import { readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { validateConfig } from "../../Tester/Configuration/config";
import { parseTimelimitCsv } from "../../Tester/Configuration/timelimit";
import { generatePreplaced, MAX_N, MIN_N } from "../../Tester/Board/preplaced";
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

  constructor() {
    // .mjs bootstrap, because Worker() does not accept a .ts path on every Node version.
    this.w = new Worker(new URL("./worker-entry.mjs", import.meta.url));
    this.w.on("message", (data: FromWorker) => this.onmessage?.({ data }));
    this.w.on("error", (e: Error) => this.onerror?.({ message: e.message }));
  }
  postMessage(msg: ToWorker): void {
    this.w.postMessage(msg);
  }
  terminate(): void {
    void this.w.terminate();
  }
}

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

function runOnce(
  n: number,
  p: number,
  seed: number,
  moduleUrl: string,
  capSeconds: number,
): Promise<SessionResult> {
  const inst = generatePreplaced(n, p, seed);
  return new Promise<SessionResult>((resolve) => {
    new Session({
      n,
      preplaced: inst.queens,
      moduleUrl,
      timeoutSeconds: capSeconds, // Session marks > cap as 'Failed' (watchdog or post-hoc), same as production
      cutoffSeconds: capSeconds, // benchmark: anything above the cap is Failed, no Overtime band
      recordEvents: false, // Only Show Result: no event recording, no back-pressure
      initialPermit: PERMIT_UNLIMITED,
      createWorker: () => new NodeWorker(),
      onFinish: resolve,
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

  const solverName = arg("solver") ?? "backtracking";
  const k = Number(arg("k") ?? 20);
  const cap = Number(arg("cap") ?? cfg.benchCapSeconds);
  const nMin = Number(arg("nmin") ?? MIN_N);
  const nMax = Number(arg("nmax") ?? MAX_N);
  const outCsv = path.resolve(repo, arg("out") ?? "Tester/timelimit.csv");
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

  console.log(`solver=${solverName} K=${k} cap=${cap}s N=${nMin}..${nMax}`);

  const rows: string[] = [];
  const discarded: Array<{
    n: number;
    p: number;
    seed: number;
    elapsedMs: number;
    seedsRun: number;
  }> = [];
  let totalRuns = 0;
  const t0 = Date.now();

  for (let n = nMin; n <= nMax; n++) {
    for (let p = 0; p <= n - 1; p++) {
      let maxMs = 0;
      let over: (typeof discarded)[number] | undefined;
      for (let seed = 0; seed < k; seed++) {
        const r = await runOnce(n, p, seed, moduleUrl, cap);
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

  const csv = `N,P,limit\n${rows.join("\n")}${rows.length ? "\n" : ""}`;
  parseTimelimitCsv(csv); // self-check: what we write must pass the same parser the app uses
  writeFileSync(outCsv, csv);

  const cpus = os.cpus();
  writeFileSync(
    outMeta,
    JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        solver: solverName,
        emsdk: manifest.emsdk,
        manifestGeneratedAt: manifest.generatedAt,
        k,
        seeds: [0, k - 1],
        benchCapSeconds: cap,
        nRange: [nMin, nMax],
        recordEvents: false,
        rule: "limit = max computeMs over seeds (seconds); (N,P) with any seed above cap is omitted",
        rowsWritten: rows.length,
        discarded,
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
    `\nWrote ${rows.length} rows to ${outCsv} (${discarded.length} discarded). Meta: ${outMeta}`,
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
