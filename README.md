# N-Queen Algorithm Tester & Visualizer

A local browser app for testing N-Queens solvers written in C++. Solvers are compiled to WebAssembly, run in a Web Worker, and can be stepped through, replayed and validated independently. A default backtracking solver is included, and you can add your own.

- UI: vanilla TypeScript + Vite, no UI library.
- Solvers: C++17 compiled with Emscripten (Docker or a native emsdk).
- Board size N = 4 to 20. Preplaced queens P = 0 to N-1.

## Prerequisites

- Node.js >= 20 (LTS)
- One of the following C++/WASM toolchains:
  - **Docker** (default): image `emscripten/emsdk`, roughly 800 MB compressed, pulled on first build. On Windows this needs Docker Desktop with WSL2.
  - **Native emsdk** (no Docker): see [Native emsdk setup](#native-emsdk-setup). Needs Git; emsdk bundles its own Python on Windows.

## Quick start

```
npm install
npm run build:solvers   # compiles Solver/backtracking and every Solver/custom/* into Solver/dist/
npm run dev             # open the printed URL
```

Do **not** open `index.html` via `file://`. The app needs cross-origin isolation (`SharedArrayBuffer` and `Atomics.wait`), which Vite provides by sending the COOP/COEP headers. If `crossOriginIsolated` is false the app shows a blocking error.

With a native toolchain: `npm run build:solvers -- --native`.

## Scripts

| Command | What it does |
| --- | --- |
| `npm run dev` | Vite dev server with COOP/COEP headers |
| `npm run build:solvers` | Compiles all solvers to WASM, writes `Solver/dist/manifest.json` |
| `npm run bench` | Regenerates `Tester/timelimit.csv` and `Tester/timelimit.meta.json` |
| `npm run bench:wall` | Regenerates `Tester/timelimit-walled.csv` and `Tester/timelimit-walled.meta.json` |
| `npm test` | Vitest unit tests |
| `npm run typecheck` | TypeScript check |
| `npm run build` / `npm run preview` | Vite production build / preview |

## Using the app

**Configuration**

- **Solver**: any solver in the manifest. A solver that failed to build is still listed, marked "(build failed)", with the compiler output shown below the list; it cannot be run.
- **N** and **P**: board size (4 to 20) and number of preplaced queens (0 to N-1). Preplaced queens are drawn with a lock mark and cannot be removed by the solver.
- **Resize** sets a new N with an empty board (P resets to 0). **Place** generates P preplaced queens for the current N, P and seed.
- **Advanced > Seed**: preplaced queens are generated from a seeded PRNG, so a run can be reproduced from (N, P, seed). Seeds 0 to 19 are the benchmark seeds. Other seeds work, but the time limit was not measured for them and the UI warns about it.
- **Only show result**: runs the solver without recording events and shows only the outcome. Back, Next and Pause are off in this mode; Stop still works.

**Controls**

| Control | Behaviour |
| --- | --- |
| Play / Pause | Plays recorded events, then continues the solver. Pausing never causes a timeout. |
| Next | From Idle, starts the solver and shows event 1. While Paused at the frontier, lets the solver produce one more event. Inside recorded history it only replays. |
| Back | Steps back one event (available while Paused or Finished). Back never changes what the solver does. |
| Stop | Cancels the run (the worker is terminated) and returns to Idle with the initial board and empty history. |
| Step delay | Slider from 5000 ms per step (left) to 0 ms (right). At 0 the app applies events for a few milliseconds per frame, so intermediate states may not be painted. |

**Step tracer**: virtualized list of every `putQueen` / `removeQueen` event, for example `#1234  PUT (3,5)  valid` or `#7  PUT (2,4)  conflict (2 pairs)`. The active row is highlighted; "Follow" keeps it in view. History is capped (see `maxRetainedEvents`); once the oldest events are dropped a "History truncated" note appears and Back stops at the oldest retained event.

**Board colours**: valid placement `#f5c839`, conflict `#c67863` (the new queen and every queen attacking it). A removed cell is outlined.

## Result statuses

| Status | Meaning |
| --- | --- |
| Successful | `solve()` returned 0, the final board passed validation, and compute time was within the timeout. Shows compute time in seconds (2 decimals) and the final board. |
| Failed | Compute time exceeded the effective timeout. Shows "Cannot solve under X second(s)" with the real timeout value. |
| Invalid Solution | `solve()` returned 0 but the board is wrong. Shows the rule that failed: board size, queen count, shared row, column or diagonal, or a preplaced queen that was moved. |
| Execution Error | Invalid API call, `exit()`, WASM trap (out of memory, stack overflow), module load failure, or a non-zero return from `solve()`. Shows the message. |
| Cancelled | You pressed Stop. |

Success is decided by the board, never by the return value. The final board is validated on the main thread by code that shares nothing with the incremental board used during execution.

In step mode, success and invalid-solution overlays appear when playback reaches the last event. Timeouts and execution errors appear immediately. All overlays can be closed and reopened with "Show result".

## Timeouts and benchmarks

The effective timeout for a run is

```
max(limit(N, P) * toleranceFactor, minTimeoutSeconds)
```

where `limit` comes from `Tester/timelimit.csv` (header `N,P,limit`, seconds). If there is no row for the selected (N, P), the solver does not start and Place is disabled with an explanation.

`npm run bench` regenerates the file. For each (N, P) it runs the reference solver (default: `backtracking`) with seeds 0 to K-1 (K = 20), each in a fresh worker, in Only-Show-Result mode, and records the **maximum** compute time. If any run exceeds `benchCapSeconds`, that (N, P) is omitted.

```
npm run bench -- [--solver backtracking] [--k 20] [--cap <seconds>] [--nmin 4] [--nmax 20] [--out Tester/timelimit.csv]
```

It also writes `timelimit.meta.json` (machine, Node version, date, K, cap, discarded pairs). A full run takes several minutes.

**Walled N-Queen** has its own file, `Tester/timelimit-walled.csv` (header `N,P,W,limit`), because (N, P) alone cannot key a walled instance. `npm run bench:wall` runs the same harness in walled mode:

```
npm run bench:wall -- [--max-wall-fraction 0.25] [--solver backtracking] [--k 20] [--cap <seconds>] [--nmin 4] [--nmax 20] [--out Tester/timelimit-walled.csv]
```

For each N it samples a **sparse** grid of wall counts (spread over `1 .. floor(N^2 * maxWallFraction)`) and crosses it with P = 0..3, K seeds each. The (N, P, W) space is far too large to enumerate exhaustively, so the grid is fixed by `WALL_FRACTIONS` in `driver/bench/walled-grid.ts`. Each instance comes from the same deterministic generator the app uses (`generateWalled`), so `W`, `Q` and the witness match a run in the browser.

A (N, P, W) is skipped (no CSV row) when the generator cannot build an instance for a seed (for example W too small for Q > N) or when any seed exceeds `benchCapSeconds`. The metadata records every skipped cell with its reason, plus the generator version and target fraction. W only counts W ≥ 1; W = 0 is the classic N-Queen and stays in `timelimit.csv`.

Since a walled limit is only usable when the app can regenerate the same instance, the app's W field is validated against this file: a W that is not a benchmarked value disables Place with the message from `noBenchmarkMessage`.

Things to know:

- Benchmarks depend on the machine, the JS engine and the Emscripten version. Limits measured on one computer can be wrong on another; regenerate them on the machine you test on. `manifest.json` records whether the build used Docker (with its tag) or a native emsdk.
- Many limits are below a millisecond, so the `minTimeoutSeconds` floor decides the effective timeout for most (N, P).
- Recording events adds overhead that is inside compute time. Timings in step mode are advisory compared with Only show result.
- Successful runs under about 5 ms display as `0.00` seconds because of the two-decimal format.
- P = N-1 is allowed but trivial: only one cell is left, and it is forced.

## Configuration

`Tester/Configuration/tester.config.json` is validated at startup. An invalid value stops the app with a message. It is not editable from the UI.

| Key | Default | Meaning |
| --- | --- | --- |
| `toleranceFactor` | 3.0 | Multiplier on the benchmark limit (range 1 to 100) |
| `minTimeoutSeconds` | 0.25 | Lower bound on the effective timeout |
| `lookaheadEvents` | 4096 | How many events the solver may run ahead of playback |
| `maxRetainedEvents` | 4194304 | Event history cap (about 16 MB) |
| `defaultStepDelayMs` | 500 | Initial step delay |
| `solverMaxMemoryMB` | 512 | WASM `MAXIMUM_MEMORY` used by the build script |
| `benchCapSeconds` | 10 | Per-run cap in `npm run bench` |

`toleranceFactor` and `minTimeoutSeconds` are proposals, not measured values.

## Writing a custom solver

A solver is a directory `Solver/custom/<name>/` containing any number of `.cpp`, `.h` and `.hpp` files and subfolders. Every `.cpp` is compiled into one WASM module. Exactly one file must define `solve`:

```cpp
#include "nqueen_api.h"

int solve(int n) {
  // use putQueen / removeQueen / viewBoard / checkQueen
  return 0;   // 0 = finished normally
}
```

`Solver/common/` is on the include path of every solver, for shared helpers. A multi-file example is in `Solver/custom/example-modular/`.

### The board API (`Solver/include/nqueen_api.h`)

```cpp
bool putQueen(int x, int y);           // x = row, y = column, 0-based
void removeQueen(int x, int y);
std::vector<std::string> viewBoard();  // N strings of N chars, 'Q' or 'x'; a copy
bool checkQueen(int x, int y);
int  solve(int n);                     // you implement this
```

- `putQueen` **keeps the queen even when it conflicts**. It returns `true` only if **no attacking pair exists anywhere on the board** after the placement, not just for the new queen. If it returns `false`, remove the queen yourself.
- `checkQueen(x, y)` returns `true` if no *other* queen shares a row, column or diagonal with the cell. It works for empty and occupied cells, and returns `false` out of bounds.
- The preplaced queens are already on the board and locked when `solve(n)` is called. Read them with `viewBoard()`.
- `putQueen` and `removeQueen` are recorded as events. `viewBoard` and `checkQueen` are not recorded, but their time counts toward compute time.

### Rules

- Strict API: `putQueen` out of bounds or on an occupied cell, and `removeQueen` out of bounds, on an empty cell or on a locked preplaced queen, end the run as **Execution Error** with a message such as `removeQueen(3,7): cell is empty`.
- No `main`, threads, file or network I/O, or `exit()`. These end as Execution Error.
- Returning non-zero from `solve` is an Execution Error. Return 0 when you are done, and leave the final board in place.
- Globals and statics are fine: every session gets a fresh WASM instance, and static initializers run before timing starts.
- C++ exceptions are not enabled. A `throw` aborts the run as Execution Error. To enable them, add the Emscripten exception flag to `emccArgs` in `driver/scripts/build-solvers.mjs`.
- A missing or duplicate `solve` shows up as a link error in the solver list.

### Build and run

```
npm run build:solvers
npm run dev
```

The script rebuilds every solver in full each time (no incremental builds). Compile errors are printed verbatim and also shown in the UI under the solver list. Your solver appears in the dropdown as `<name> (custom)`.

`Solver/custom/spike-hang/` is a deliberate infinite loop used to check that `worker.terminate()` stops a runaway solver. It appears in the dropdown and will simply time out if selected.

### Default solver

`Solver/backtracking/solver.cpp` places queens row by row and skips rows that already hold a preplaced queen:

```cpp
static bool place(int r) {
  if (r == N) return true;
  if (fixedRow[r]) return place(r + 1);
  for (int c = 0; c < N; ++c) {
    if (putQueen(r, c) && place(r + 1)) return true;
    removeQueen(r, c);   // putQueen keeps the queen even on conflict
  }
  return false;
}
```

## Native emsdk setup

### Windows (PowerShell)

```
git clone https://github.com/emscripten-core/emsdk.git C:\emsdk
cd C:\emsdk
.\emsdk install latest
.\emsdk activate latest
.\emsdk_env.ps1
em++ --version
```

If PowerShell blocks the script (execution policy), use `cmd /k "C:\emsdk\emsdk_env.bat"` instead and run the build from that shell.

### Linux / macOS

```
git clone https://github.com/emscripten-core/emsdk.git ~/emsdk
cd ~/emsdk
./emsdk install latest
./emsdk activate latest
source ./emsdk_env.sh
em++ --version
```

### Build with the native toolchain

```
npm run build:solvers -- --native
```

(or set `NQ_NATIVE=1`). The build must run in the same terminal where `emsdk_env` was loaded, because it only sets PATH for that session. To make it permanent: `emsdk activate latest --permanent` (on Windows, from an Administrator PowerShell), then reopen your terminals.

Notes:

- The build script calls `em++`, not `emcc`. Plain `emcc` does not link the C++ standard library for `.cpp` files and fails with `undefined symbol: operator new` and similar errors.
- With `--native`, the Docker tag is ignored and `manifest.json` records `"emsdk": "native"`. Benchmark results depend on the compiler version, so note which emsdk version you used.
- Docker builds use the pinned tag `5.0.5`. Override it with `EMSDK_TAG=x.y.z npm run build:solvers`, and verify the tag exists on Docker Hub.
- Solvers are compiled with `-sENVIRONMENT=worker,node` (the browser worker and the Node benchmark harness both load them).

## How it works

- Each run gets its own Web Worker and `SharedArrayBuffer` control block. The solver reaches the host only through four imports (`nq_put`, `nq_remove`, `nq_view`, `nq_check`) that forward to an incremental board inside the worker.
- The main thread keeps a separate display board rebuilt from recorded events. Every event is its own inverse, so Back is O(1).
- Back-pressure: the solver may run ahead of playback by at most `lookaheadEvents`. When the limit is reached the worker blocks in `Atomics.wait`, and that waiting time is excluded from compute time. In Only show result mode there is no back-pressure.
- Compute time is measured from the start of `solve` to its return. Module loading and worker start-up are excluded. A watchdog on the main thread checks it every 20 ms and terminates the worker on timeout.
- Stop, Resize and Place terminate the worker. Messages from older sessions are discarded.
- The benchmark harness and the browser worker share `Tester/Execution/core/run-solver.ts`, so both measure the same code path.

The full design, including open decisions and known specification issues, is in the technical design document.

## Project layout

```
index.html                    entry page
driver/
  main.ts                     mounts the app
  vite.config.ts              COOP/COEP headers for dev and preview
  scripts/build-solvers.mjs   emcc/em++ wrapper (Docker or native), writes the manifest
  bench/benchmark.ts          benchmark harness, classic and walled (npm run bench / bench:wall)
  bench/walled-grid.ts        sparse W grid sampled by the walled benchmark
  spike.ts, spikes/           browser spikes S1 to S4b (not loaded by index.html)
Tester/
  Board/                      board, segments, validator, preplaced generator, walled generator, instance, PRNG
  Configuration/              tester.config.json, config and CSV parsing
  Execution/                  session, session controller, worker adapter, protocol, core/run-solver
  Visualization/              history, playback, renderer, highlight rules
  UI/                         app wiring, config panel, tracer, overlay, styles
  timelimit.csv               classic benchmark limits (generated)
  timelimit-walled.csv        Walled N-Queen benchmark limits (generated)
Solver/
  include/                    nqueen_api.h, nqueen_runtime.cpp, nqueen_host.js
  backtracking/               default solver
  common/                     shared helpers on every solver's include path
  custom/<name>/              your solvers
  dist/                       build output and manifest.json (generated, git-ignored)
tests/                        Vitest unit tests
```

## Tests

`npm test` runs the Vitest suite (board, validator, preplaced generator, config and CSV, protocol, `runSolver`, session and watchdog, session controller, history, playback, highlight and render state). There are no automated tests yet for the panels, overlay, tracer or end-to-end browser behaviour.
