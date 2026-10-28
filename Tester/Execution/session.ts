// Main-thread session (design 5.6, 6.1 partially): one worker, one control block, one id.
// Owns the watchdog, final validation and the terminal status. History/playback come later.
import { validateBoard, type Rule } from '../Board/validator';
import {
  CTRL_PERMIT, CTRL_STATE, F_ACCUM_MS, F_RESUME_TS, PERMIT_UNLIMITED, STATE_RUNNING, STATE_WAITING, STATE_IDLE,
  createControlBlock,
  type ControlBlock, type ErrorKind, type FromWorker, type ToWorker,
} from './protocol';

export interface WorkerLike {
  postMessage(msg: ToWorker, transfer?: Transferable[]): void;
  terminate(): void;
  onmessage: ((e: { data: FromWorker }) => void) | null;
  onerror: ((e: { message?: string }) => void) | null;
}
export type WorkerFactory = () => WorkerLike;

export type SessionResult =
  | { status: 'Successful'; computeMs: number; eventCount: number; finalBoard: string[] }
  | { status: 'Failed'; timeoutSeconds: number; elapsedMs: number }
  | { status: 'Invalid Solution'; rule: Rule; message: string; computeMs: number; eventCount: number; finalBoard: string[] }
  | { status: 'Execution Error'; kind: ErrorKind; message: string; computeMs: number; eventCount: number; finalBoard?: string[] }
  | { status: 'Cancelled' };

export interface SessionOptions {
  n: number;
  preplaced: Array<[number, number]>;
  moduleUrl: string;
  /** Effective timeout in seconds (already includes tolerance factor and floor). */
  timeoutSeconds: number;
  /** false = Only Show Result. */
  recordEvents: boolean;
  /** Events the solver may produce before it first waits (1 for Idle + Next). Ignored when !recordEvents. */
  initialPermit: number;
  createWorker: WorkerFactory;
  onFinish: (result: SessionResult) => void;
  onEvents?: (events: Uint32Array) => void;
  now?: () => number;
  watchdogMs?: number;
}

let nextSessionId = 1;

export class Session {
  readonly id = nextSessionId++;
  readonly control: ControlBlock = createControlBlock();
  private worker?: WorkerLike;
  private timer?: ReturnType<typeof setInterval>;
  private finished = false;
  private readonly now: () => number;

  constructor(private readonly o: SessionOptions) {
    this.now = o.now ?? (() => performance.timeOrigin + performance.now());
  }

  get isFinished(): boolean {
    return this.finished;
  }

  start(): void {
    if (this.worker || this.finished) throw new Error('Session already started');
    const { i32 } = this.control;
    Atomics.store(i32, CTRL_PERMIT, this.o.recordEvents ? Math.min(this.o.initialPermit, PERMIT_UNLIMITED) : PERMIT_UNLIMITED);

    const w = this.o.createWorker();
    this.worker = w;
    w.onmessage = (e) => this.handle(e.data);
    w.onerror = (e) => {
      const started = Atomics.load(i32, CTRL_STATE) !== STATE_IDLE;
      this.finish({
        status: 'Execution Error',
        kind: started ? 'trap' : 'load',
        message: e.message ?? 'Worker error',
        computeMs: this.elapsedMs(),
        eventCount: 0,
      });
    };
    w.postMessage({
      type: 'start',
      sessionId: this.id,
      moduleUrl: this.o.moduleUrl,
      n: this.o.n,
      preplaced: this.o.preplaced,
      recordEvents: this.o.recordEvents,
      control: this.control.sab,
    });
    this.timer = setInterval(() => this.tick(), this.o.watchdogMs ?? 20);
  }

  /** Let the solver run up to `target` events ahead. Never lowers the permit (Back never touches it). */
  raisePermit(target: number): void {
    const { i32 } = this.control;
    const t = Math.min(target, PERMIT_UNLIMITED);
    if (t <= Atomics.load(i32, CTRL_PERMIT) || this.finished) return;
    Atomics.store(i32, CTRL_PERMIT, t);
    if (Atomics.load(i32, CTRL_STATE) === STATE_WAITING) Atomics.notify(i32, CTRL_PERMIT);
  }

  /** User Stop / Resize / Place: pre-emptive cancel. The solver never learns about it. */
  stop(): void {
    this.finish({ status: 'Cancelled' });
  }

  /** Compute time so far: accumulated + current running slice (design 5.5). Small read skew is accepted. */
  elapsedMs(): number {
    const { i32, f64 } = this.control;
    const state = Atomics.load(i32, CTRL_STATE);
    const accum = f64[F_ACCUM_MS]!;
    return accum + (state === STATE_RUNNING ? Math.max(0, this.now() - f64[F_RESUME_TS]!) : 0);
  }

  private tick(): void {
    if (this.finished) return;
    const elapsed = this.elapsedMs();
    if (elapsed > this.o.timeoutSeconds * 1000) {
      this.finish({ status: 'Failed', timeoutSeconds: this.o.timeoutSeconds, elapsedMs: elapsed });
    }
  }

  private handle(msg: FromWorker): void {
    if (this.finished || msg.sessionId !== this.id) return; // stale message
    if (msg.type === 'events') {
      this.o.onEvents?.(msg.events);
      return;
    }
    const out = msg.outcome;
    if (out.status === 'error') {
      this.finish({ status: 'Execution Error', kind: out.kind, message: out.message, computeMs: out.computeMs, eventCount: out.eventCount, finalBoard: out.finalBoard });
      return;
    }
    const v = validateBoard(out.finalBoard, this.o.n, this.o.preplaced);
    if (!v.ok) {
      this.finish({ status: 'Invalid Solution', rule: v.rule, message: v.message, computeMs: out.computeMs, eventCount: out.eventCount, finalBoard: out.finalBoard });
    } else if (out.computeMs > this.o.timeoutSeconds * 1000) {
      this.finish({ status: 'Failed', timeoutSeconds: this.o.timeoutSeconds, elapsedMs: out.computeMs });
    } else {
      this.finish({ status: 'Successful', computeMs: out.computeMs, eventCount: out.eventCount, finalBoard: out.finalBoard });
    }
  }

  private finish(result: SessionResult): void {
    if (this.finished) return;
    this.finished = true;
    if (this.timer !== undefined) clearInterval(this.timer);
    if (this.worker) {
      this.worker.onmessage = null;
      this.worker.onerror = null;
      this.worker.terminate();
    }
    this.o.onFinish(result);
  }
}
