// Environment-neutral solver runner (design section 3): no DOM, no `self`. The browser worker and the
// Node benchmark harness both wrap this, so benchmark and production share one code path.
import { Board, OperationError } from '../../Board/board';
import {
  CTRL_PERMIT, CTRL_STATE, F_ACCUM_MS, F_RESUME_TS, FLUSH_EVENTS, OP_PUT, OP_REMOVE,
  STATE_DONE, STATE_RUNNING, STATE_WAITING, encodeEvent,
  type ControlBlock, type ErrorKind, type RunOutcome,
} from '../protocol';

export interface SolverModule {
  _nq_run(n: number): number;
}

export interface RunOptions {
  n: number;
  /** Already on the board (and locked) when solve(n) is called. Not recorded as events. */
  preplaced: ReadonlyArray<readonly [number, number]>;
  /** Instantiates the WASM module. Excluded from compute time. */
  loadModule: () => Promise<SolverModule>;
  control: ControlBlock;
  /** false = Only Show Result: events are counted but not recorded, and no back-pressure applies. */
  recordEvents: boolean;
  /** Receives each flushed batch (a fresh array, safe to transfer). */
  emit: (events: Uint32Array) => void;
  /** Epoch-like milliseconds, comparable across threads. */
  now?: () => number;
  /** Blocks until PERMIT may have changed from `observed`. Default: Atomics.wait. Injectable for tests. */
  waitOnPermit?: (i32: Int32Array, observed: number) => void;
  /** Where __nqHost is installed. Default: globalThis. */
  hostTarget?: object;
}

const defaultNow = (): number => performance.timeOrigin + performance.now();
const defaultWait = (i32: Int32Array, observed: number): void => {
  Atomics.wait(i32, CTRL_PERMIT, observed);
};

function classify(e: unknown): ErrorKind {
  const name = (e as { name?: string } | null)?.name;
  if (e instanceof OperationError || name === 'OperationError') return 'operation';
  if (name === 'ExitStatus') return 'exit';
  return 'trap';
}

const messageOf = (e: unknown): string => String((e as { message?: string } | null)?.message ?? e);

export async function runSolver(opts: RunOptions): Promise<RunOutcome> {
  const { n, preplaced, loadModule, control, recordEvents, emit } = opts;
  const { i32, f64 } = control;
  const now = opts.now ?? defaultNow;
  const waitOnPermit = opts.waitOnPermit ?? defaultWait;
  const target = (opts.hostTarget ?? globalThis) as Record<string, unknown>;

  const board = new Board(n);
  for (const [x, y] of preplaced) {
    board.put(x, y);
    board.lock(x, y);
  }

  const buf = new Uint32Array(FLUSH_EVENTS);
  let k = 0;
  let produced = 0;
  let accumMs = 0;
  let resumeTs = 0;

  const flush = (): void => {
    if (k > 0) {
      emit(buf.slice(0, k));
      k = 0;
    }
  };

  // Pause the compute clock, block until the permit allows event number `produced`, resume.
  const waitForPermit = (): void => {
    flush();
    accumMs += now() - resumeTs;
    f64[F_ACCUM_MS] = accumMs;
    Atomics.store(i32, CTRL_STATE, STATE_WAITING);
    for (;;) {
      const permit = Atomics.load(i32, CTRL_PERMIT);
      if (produced < permit) break;
      waitOnPermit(i32, permit);
    }
    resumeTs = now();
    f64[F_RESUME_TS] = resumeTs;
    Atomics.store(i32, CTRL_STATE, STATE_RUNNING);
  };

  const record = (x: number, y: number, op: number): void => {
    produced++;
    if (!recordEvents) return;
    buf[k++] = encodeEvent(x, y, op, board.pairs === 0, board.pairs);
    if (k === FLUSH_EVENTS) flush();
    if (produced >= Atomics.load(i32, CTRL_PERMIT)) waitForPermit();
  };

  const encoder = new TextEncoder();
  target.__nqHost = {
    put(x: number, y: number): boolean {
      const ok = board.put(x, y); // throws OperationError before any state change
      record(x, y, OP_PUT);
      return ok;
    },
    remove(x: number, y: number): void {
      board.remove(x, y);
      record(x, y, OP_REMOVE);
    },
    check: (x: number, y: number): boolean => board.check(x, y),
    view: (): Uint8Array => encoder.encode(board.view().join('')),
  };

  try {
    let mod: SolverModule;
    try {
      mod = await loadModule();
    } catch (e) {
      Atomics.store(i32, CTRL_STATE, STATE_DONE);
      return { status: 'error', kind: 'load', message: messageOf(e), computeMs: 0, eventCount: 0 };
    }

    resumeTs = now();
    f64[F_ACCUM_MS] = 0;
    f64[F_RESUME_TS] = resumeTs;
    Atomics.store(i32, CTRL_STATE, STATE_RUNNING);

    let returnCode = 0;
    let failure: { kind: ErrorKind; message: string } | undefined;
    try {
      returnCode = mod._nq_run(n);
    } catch (e) {
      failure = { kind: classify(e), message: messageOf(e) };
    }

    accumMs += now() - resumeTs; // clock is running here: waits never throw out of the solver
    f64[F_ACCUM_MS] = accumMs;
    flush();
    Atomics.store(i32, CTRL_STATE, STATE_DONE);

    const base = { computeMs: accumMs, eventCount: produced, finalBoard: board.view() };
    if (failure) return { status: 'error', ...failure, ...base };
    if (returnCode !== 0) {
      return { status: 'error', kind: 'solver-nonzero', message: `solve() returned ${returnCode}`, ...base };
    }
    return { status: 'completed', ...base };
  } finally {
    delete target.__nqHost;
  }
}
