// Shared contract between main thread, worker adapter and the environment-neutral core.
// No DOM / worker globals here.

// ---- Event encoding (design 5.2): one Uint32 per event ---------------------------------------
// bits 0-4 x | 5-9 y | 10 op (0 put, 1 remove) | 11 valid (pairs === 0 after op) | 12-19 pairs
export const OP_PUT = 0;
export const OP_REMOVE = 1;

export interface DecodedEvent {
  x: number;
  y: number;
  op: typeof OP_PUT | typeof OP_REMOVE;
  valid: boolean;
  pairs: number;
}

export function encodeEvent(x: number, y: number, op: number, valid: boolean, pairs: number): number {
  return (x | (y << 5) | (op << 10) | ((valid ? 1 : 0) << 11) | (pairs << 12)) >>> 0;
}

export function decodeEvent(e: number): DecodedEvent {
  return {
    x: e & 31,
    y: (e >>> 5) & 31,
    op: ((e >>> 10) & 1) as 0 | 1,
    valid: ((e >>> 11) & 1) === 1,
    pairs: (e >>> 12) & 255,
  };
}

/** Events are batched: flushed every FLUSH_EVENTS events, before any wait, and at finish. */
export const FLUSH_EVENTS = 512;

// ---- Control block (design 5.4 / 5.5) -------------------------------------------------------
// SharedArrayBuffer layout: 8 x Int32 header (32 bytes), then 2 x Float64 (clock fields).
export const CTRL_PERMIT = 0; // solver may produce events up to this count, then must wait
export const CTRL_STATE = 1;
export const STATE_IDLE = 0;
export const STATE_RUNNING = 1;
export const STATE_WAITING = 2;
export const STATE_DONE = 3;
export const F_ACCUM_MS = 0;  // compute ms accumulated up to the last pause
export const F_RESUME_TS = 1; // epoch-ms timestamp of the last resume

/** Largest Int32; used as "no back-pressure". */
export const PERMIT_UNLIMITED = 0x7fffffff;
export const CONTROL_BYTES = 48;

export interface ControlBlock {
  sab: SharedArrayBuffer;
  i32: Int32Array;
  f64: Float64Array;
}

export function createControlBlock(sab: SharedArrayBuffer = new SharedArrayBuffer(CONTROL_BYTES)): ControlBlock {
  return { sab, i32: new Int32Array(sab, 0, 8), f64: new Float64Array(sab, 32, 2) };
}

// ---- Run outcome ----------------------------------------------------------------------------
export type ErrorKind =
  | 'operation'      // invalid putQueen/removeQueen (design D8)
  | 'exit'           // solver called exit()
  | 'trap'           // WASM trap, OOM, stack overflow, any other runtime failure
  | 'load'           // module failed to load/instantiate
  | 'solver-nonzero'; // solve() returned non-zero

export type RunOutcome =
  | { status: 'completed'; computeMs: number; eventCount: number; finalBoard: string[] }
  | { status: 'error'; kind: ErrorKind; message: string; computeMs: number; eventCount: number; finalBoard?: string[] };

// ---- Messages (used by solver-worker.ts / session.ts) ----------------------------------------
export interface StartMessage {
  type: 'start';
  sessionId: number;
  moduleUrl: string;
  n: number;
  preplaced: Array<[number, number]>;
  recordEvents: boolean; // false = Only Show Result
  control: SharedArrayBuffer;
}

export type ToWorker = StartMessage;

export type FromWorker =
  | { type: 'events'; sessionId: number; events: Uint32Array }
  | { type: 'outcome'; sessionId: number; outcome: RunOutcome };
