#!/usr/bin/env node
// Compiles Solver/backtracking and every Solver/custom/* to WASM with emcc.
// Default: runs emcc inside a pinned emscripten/emsdk Docker image.
// Use --native (or NQ_NATIVE=1) to use an emcc already on PATH instead.
import { spawnSync } from "node:child_process";
import {
  readdirSync,
  statSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  existsSync,
  rmSync,
} from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import os from "node:os";

const repo = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
);
const EMSDK_TAG = process.env.EMSDK_TAG ?? "5.0.5"; // pinned; override with EMSDK_TAG
const native =
  process.argv.includes("--native") || process.env.NQ_NATIVE === "1";

const cfg = JSON.parse(
  readFileSync(
    path.join(repo, "Tester/Configuration/tester.config.json"),
    "utf8",
  ),
);
const maxMemBytes = Math.round(cfg.solverMaxMemoryMB * 1024 * 1024);

const posix = (p) => p.split(path.sep).join("/");
const rel = (p) => posix(path.relative(repo, p));

function listCpp(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) out.push(...listCpp(full));
    else if (name.endsWith(".cpp")) out.push(full);
  }
  return out.sort();
}

function discoverSolvers() {
  const solvers = [];
  const bt = path.join(repo, "Solver/backtracking");
  if (existsSync(bt))
    solvers.push({ name: "backtracking", dir: bt, kind: "default" });
  const customRoot = path.join(repo, "Solver/custom");
  if (existsSync(customRoot)) {
    for (const name of readdirSync(customRoot)) {
      const dir = path.join(customRoot, name);
      if (statSync(dir).isDirectory())
        solvers.push({ name, dir, kind: "custom" });
    }
  }
  return solvers;
}

function emccArgs(solver, outJs) {
  const sources = [
    ...listCpp(solver.dir),
    path.join(repo, "Solver/include/nqueen_runtime.cpp"),
  ];
  return [
    ...sources.map(rel),
    `-I${rel(solver.dir)}`,
    "-ISolver/common",
    "-ISolver/include",
    "-O2",
    "-std=c++17",
    "-sMODULARIZE=1",
    "-sEXPORT_ES6=1",
    "-sEXPORT_NAME=createSolver",
    // worker for the browser, node for the benchmark harness (see README note)
    "-sENVIRONMENT=worker,node",
    "-sALLOW_MEMORY_GROWTH=1",
    `-sMAXIMUM_MEMORY=${maxMemBytes}`,
    "-sSTACK_SIZE=1048576",
    "-sFILESYSTEM=0",
    "-sEXPORTED_FUNCTIONS=_nq_run",
    "--js-library",
    "Solver/include/nqueen_host.js",
    "-o",
    rel(outJs),
  ];
}

function run(args) {
  if (native)
    return spawnSync("em++", args, {
      cwd: repo,
      encoding: "utf8",
      shell: process.platform === "win32",
    });
  const dockerArgs = ["run", "--rm", "-v", `${repo}:/src`, "-w", "/src"];
  if (process.platform !== "win32" && os.userInfo().uid >= 0) {
    dockerArgs.push("-u", `${os.userInfo().uid}:${os.userInfo().gid}`);
  }
  dockerArgs.push(`emscripten/emsdk:${EMSDK_TAG}`, "em++", ...args);
  return spawnSync("docker", dockerArgs, { cwd: repo, encoding: "utf8" });
}

const distRoot = path.join(repo, "Solver/dist");
rmSync(distRoot, { recursive: true, force: true });
mkdirSync(distRoot, { recursive: true });

const manifest = {
  generatedAt: new Date().toISOString(),
  emsdk: native ? "native" : EMSDK_TAG,
  solvers: [],
};
let failed = 0;

for (const s of discoverSolvers()) {
  const outDir = path.join(distRoot, s.name);
  mkdirSync(outDir, { recursive: true });
  const outJs = path.join(outDir, "solver.mjs");
  process.stdout.write(`Building ${s.name} ... `);
  const r = run(emccArgs(s, outJs));
  if (r.error || r.status !== 0) {
    failed++;
    console.log("FAILED");
    const msg = r.error
      ? String(r.error.message)
      : `${r.stdout ?? ""}${r.stderr ?? ""}`;
    console.error(msg);
    manifest.solvers.push({
      name: s.name,
      kind: s.kind,
      ok: false,
      error: msg,
    });
    continue;
  }
  console.log("ok");
  manifest.solvers.push({
    name: s.name,
    kind: s.kind,
    ok: true,
    module: `/Solver/dist/${s.name}/solver.mjs`,
    wasm: `/Solver/dist/${s.name}/solver.wasm`,
  });
}

writeFileSync(
  path.join(distRoot, "manifest.json"),
  JSON.stringify(manifest, null, 2),
);
console.log(
  `Manifest written: Solver/dist/manifest.json (${manifest.solvers.length - failed} ok, ${failed} failed)`,
);
process.exit(failed ? 1 : 0);
