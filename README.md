# N-Queen Algorithm Tester & Visualizer

Scaffold for the technical design (Vite + vanilla TypeScript, C++ -> WASM via Emscripten in Docker).

## Prerequisites

- Node.js >= 20 (LTS)
- One of the following C++/WASM toolchains:
  - **Docker** (default): image `emscripten/emsdk`, roughly 800 MB compressed, pulled on first build.
    On Windows this needs Docker Desktop with WSL2.
  - **Native emsdk** (no Docker): see "Native emsdk setup" below. Needs Git; emsdk bundles its own Python on Windows.

## Native emsdk setup (no Docker)

### Windows (PowerShell)

```powershell
git clone https://github.com/emscripten-core/emsdk.git C:\emsdk
cd C:\emsdk
.\emsdk install latest
.\emsdk activate latest
.\emsdk_env.ps1
em++ --version
```

If PowerShell blocks the script (execution policy), use `cmd /k "C:\emsdk\emsdk_env.bat"` instead and run the
build from that shell.

### Linux / macOS

```bash
git clone https://github.com/emscripten-core/emsdk.git ~/emsdk
cd ~/emsdk
./emsdk install latest
./emsdk activate latest
source ./emsdk_env.sh
em++ --version
```

### Build with the native toolchain

```bash
npm run build:solvers -- --native
```

(or set `NQ_NATIVE=1`). The build must run in the same terminal where `emsdk_env` was loaded, because it only
sets PATH for that session. To make it permanent: `emsdk activate latest --permanent` (on Windows, from an
Administrator PowerShell), then reopen your terminals.

Notes:

- The build script calls `em++`, not `emcc`. Plain `emcc` does not link the C++ standard library for `.cpp` files
  and fails with `undefined symbol: operator new` and similar errors.
- With `--native`, the Docker tag (`EMSDK_TAG`) is ignored and `manifest.json` records `"emsdk": "native"`.
  Benchmark results (`timelimit.csv`) depend on the compiler version, so note which emsdk version you used.

## Run

```bash
npm install
npm run build:solvers   # compiles Solver/backtracking and Solver/custom/* -> Solver/dist/
npm run dev             # open the printed URL; do NOT open index.html via file://
```

The page currently shows a smoke test (spike S1): it checks `crossOriginIsolated`, validates the
config, and runs each built solver once at N=8 in a fresh worker.

## Other scripts

`npm test` (Vitest), `npm run typecheck`, `npm run build`, `npm run preview`, `npm run bench` (harness not implemented yet).

## Notes

- Pinned emsdk tag: `5.0.5` (override: `EMSDK_TAG=x.y.z npm run build:solvers`). Verify it on Docker Hub.
- Solvers are compiled with `-sENVIRONMENT=worker,node`. The design doc says `worker` only, which would make
  the Node benchmark harness unable to load the module.
