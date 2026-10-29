// Menghasilkan Tester/timelimit.csv + timelimit.meta.json dari solver referensi.
// Pakai: npx tsx driver/bench/benchmark.ts [--solver backtracking] [--k 20] [--nmax 20] [--out Tester]
import { Worker } from "node:worker_threads";
import { readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { validateConfig } from "../../Tester/Configuration/config";
import { generatePreplaced, MAX_N, MIN_N } from "../../Tester/Board/preplaced";
import { validateBoard } from "../../Tester/Board/validator";
import type { RunOutcome } from "../../Tester/Execution/protocol";

const repo = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
);
const arg = (name: string, def: string): string => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1]! : def;
};

const solverName = arg("solver", "backtracking");
const K = Number(arg("k", "20"));
const nMax = Math.min(Number(arg("nmax", String(MAX_N))), MAX_N);
const outDir = path.resolve(repo, arg("out", "Tester"));

const cfg = validateConfig(
  JSON.parse(
    readFileSync(
      path.join(repo, "Tester/Configuration/tester.config.json"),
      "utf8",
    ),
  ),
);
const capMs = cfg.benchCapSeconds * 1000;

const manifest = JSON.parse(
  readFileSync(path.join(repo, "Solver/dist/manifest.json"), "utf8"),
);
const entry = manifest.solvers.find((s: any) => s.name === solverName);
if (!entry?.ok)
  throw new Error(
    `Solver "${solverName}" tidak ada / gagal build. Jalankan npm run build:solvers.`,
  );
const moduleUrl = pathToFileURL(path.join(repo, entry.module)).href;

const workerUrl = new URL("./bench-worker.ts", import.meta.url);

/** Satu run di worker baru. exceeded=true jika melewati cap (compute time atau wall-clock). */
function runOnce(
  n: number,
  preplaced: Array<[number, number]>,
): Promise<{ exceeded: boolean; outcome?: RunOutcome }> {
  return new Promise((resolve, reject) => {
    const w = new Worker(workerUrl, {
      workerData: { n, preplaced, moduleUrl },
    });
    // Wall-clock = cap + kelonggaran 5 dtk untuk load/kompilasi WASM (tidak dihitung sebagai compute).
    const timer = setTimeout(() => {
      void w.terminate();
      resolve({ exceeded: true });
    }, capMs + 5000);
    w.once("message", (outcome: RunOutcome) => {
      clearTimeout(timer);
      void w.terminate();
      resolve({
        exceeded: outcome.status === "completed" && outcome.computeMs > capMs,
        outcome,
      });
    });
    w.once("error", (e) => {
      clearTimeout(timer);
      reject(e);
    });
  });
}

const rows: Array<{ n: number; p: number; limit: number }> = [];
const dropped: Array<{ n: number; p: number; seed: number }> = [];
const t0 = Date.now();

for (let n = MIN_N; n <= nMax; n++) {
  for (let p = 0; p <= n - 1; p++) {
    let maxMs = 0;
    let over = false;
    for (let seed = 0; seed < K; seed++) {
      const inst = generatePreplaced(n, p, seed);
      const { exceeded, outcome } = await runOnce(n, inst.queens);
      if (exceeded) {
        dropped.push({ n, p, seed });
        over = true;
        break;
      }
      // Solver referensi yang salah tidak boleh menghasilkan batas waktu.
      if (!outcome || outcome.status !== "completed") {
        throw new Error(
          `N=${n} P=${p} seed=${seed}: ${JSON.stringify(outcome)}`,
        );
      }
      const v = validateBoard(outcome.finalBoard, n, inst.queens);
      if (!v.ok)
        throw new Error(
          `N=${n} P=${p} seed=${seed}: solusi tidak valid (${v.message})`,
        );
      maxMs = Math.max(maxMs, outcome.computeMs);
    }
    if (!over) rows.push({ n, p, limit: Math.max(maxMs / 1000, 1e-6) });
    process.stdout.write(
      `N=${n} P=${p}: ${over ? "DROPPED (>cap)" : maxMs.toFixed(2) + " ms"}\n`,
    );
  }
}

const csv =
  "N,P,limit\n" +
  rows.map((r) => `${r.n},${r.p},${Number(r.limit.toFixed(6))}`).join("\n") +
  "\n";
writeFileSync(path.join(outDir, "timelimit.csv"), csv);
writeFileSync(
  path.join(outDir, "timelimit.meta.json"),
  JSON.stringify(
    {
      generatedAt: new Date().toISOString(),
      solver: solverName,
      emsdk: manifest.emsdk,
      seeds: `0..${K - 1}`,
      statistic: "max computeMs over seeds",
      benchCapSeconds: cfg.benchCapSeconds,
      rows: rows.length,
      dropped,
      node: process.version,
      cpu: os.cpus()[0]?.model,
      cores: os.cpus().length,
      platform: `${os.platform()} ${os.release()}`,
      elapsedSeconds: Math.round((Date.now() - t0) / 1000),
    },
    null,
    2,
  ),
);
console.log(
  `Selesai: ${rows.length} baris, ${dropped.length} dibuang. Output di ${outDir}`,
);
