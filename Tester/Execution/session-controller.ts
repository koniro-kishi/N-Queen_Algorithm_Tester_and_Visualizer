// Main-thread state machine (design 6.1) over one Session at a time, plus history and display board.
// Playback timing (rAF) is NOT here: PlaybackEngine will call advance(). Back/Next never touch the solver,
// except Next at the frontier, which raises the permit by one (design 5.4).
import { Board } from "../Board/board";
import { HistoryStore } from "../Visualization/history";
import {
  decodeEvent,
  OP_PUT,
  OP_REMOVE,
  type DecodedEvent,
  PERMIT_UNLIMITED,
} from "./protocol";
import {
  Session,
  type SessionOptions,
  type SessionResult,
  type WorkerFactory,
} from "./session";

export type ControllerState =
  | "Idle"
  | "Measuring"
  | "Running"
  | "Paused"
  | "Draining"
  | "Finished";

export interface Problem {
  n: number;
  preplaced: Array<[number, number]>;
  walls?: Array<[number, number]>;
  target?: number;
  moduleUrl: string;
  /** Effective timeout in seconds. */
  timeoutSeconds: number;
  cutoffSeconds: number;
  onlyShowResult: boolean;
}

export interface OpCounts {
  put: number;
  remove: number;
  check: number;
}

export interface RunConsistency {
  eventCount: [number, number]; // [pass 1 (measuring), pass 2 (trace)]
  finalBoard: [string[] | undefined, string[] | undefined];
}

export interface ControllerConfig {
  lookaheadEvents: number;
  maxRetainedEvents: number;
}

export interface SessionLike {
  start(): void;
  raisePermit(target: number): void;
  stop(): void;
}
export type SessionFactory = (o: SessionOptions) => SessionLike;

export interface Controls {
  back: boolean;
  next: boolean;
  stop: boolean;
  playPause: "play" | "pause" | "off";
}

export interface ControllerView {
  state: ControllerState;
  controls: Controls;
  /** Number of events applied to the display board; the active tracer row is cursor - 1. */
  cursor: number;
  length: number;
  firstIndex: number;
  truncated: boolean;
  maxEventReached: number;
  currentEvent: DecodedEvent | null;
  /** Operations among events [0, cursor). Follows Back/Next. */
  opCounts: OpCounts;
  consistency: RunConsistency | null;
  /** Terminal result once it is known and may be shown (see 6.5 / I6). */
  result: SessionResult | null;
  /** Status line text. */
  status: string;
}

export interface ControllerOptions {
  config: ControllerConfig;
  problem: Problem;
  createWorker: WorkerFactory;
  sessionFactory?: SessionFactory;
  chunkSize?: number;
  measureFirst?: boolean; // default true
}

export class SessionController {
  private problem: Problem;
  private history: HistoryStore;
  private displayBoard!: Board;
  private session?: SessionLike;
  private state: ControllerState = "Idle";
  private cursor = 0;
  private counts: OpCounts = { put: 0, remove: 0, check: 0 };
  private maxEventReached = 0;
  private solverDone = false;
  private pendingResult?: SessionResult; // Successful / Invalid Solution, waiting for playback to reach the end
  private result: SessionResult | null = null;
  private pendingSteps = 0;
  private measured?: SessionResult;
  private afterMeasure?: "play" | "next";
  private consistency: RunConsistency | null = null;
  private statusOverride?: string;
  private listeners = new Set<(v: ControllerView) => void>();

  constructor(private readonly o: ControllerOptions) {
    this.problem = o.problem;
    this.history = new HistoryStore(o.config.maxRetainedEvents, o.chunkSize);
    this.reset();
  }

  // ---- observation -------------------------------------------------------------------------
  subscribe(fn: (v: ControllerView) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  /** The display board (read-only for callers). Rebuilt from events; not the worker's execution board. */
  get board(): Board {
    return this.displayBoard;
  }

  getView(): ControllerView {
    const cur =
      this.cursor - 1 >= this.history.firstIndex && this.cursor > 0
        ? decodeEvent(this.history.get(this.cursor - 1))
        : null;
    return {
      state: this.state,
      controls: this.controls(),
      cursor: this.cursor,
      length: this.history.length,
      firstIndex: this.history.firstIndex,
      truncated: this.history.truncated,
      opCounts: this.counts,
      consistency: this.consistency,
      maxEventReached: this.maxEventReached,
      currentEvent: cur,
      result: this.result,
      status:
        this.statusOverride ??
        (this.result
          ? this.result.status
          : this.state === "Draining"
            ? "Running"
            : this.state),
    };
  }

  /** Decoded event at a global index, or null outside the retained window. */
  getEvent(i: number): DecodedEvent | null {
    return this.history.has(i) ? decodeEvent(this.history.get(i)) : null;
  }

  private controls(): Controls {
    const only = this.problem.onlyShowResult;
    const canBack = !only && this.cursor > this.history.firstIndex;
    switch (this.state) {
      case "Idle":
        return { back: false, next: !only, stop: false, playPause: "play" };
      case "Measuring":
        return { back: false, next: false, stop: true, playPause: "off" };
      case "Running":
        return {
          back: false,
          next: false,
          stop: true,
          playPause: only ? "off" : "pause",
        };
      case "Paused":
        return { back: canBack, next: true, stop: true, playPause: "play" };
      case "Draining":
        return { back: false, next: false, stop: true, playPause: "pause" };
      // Finished: the table says Next is off; navigation would be one-way, so Next replays recorded events
      // (never generates new ones). Flagged as issue I8.
      case "Finished":
        return {
          back: canBack,
          next: !only && this.cursor < this.history.length,
          stop: true,
          playPause: "off",
        };
    }
  }

  // ---- user actions ------------------------------------------------------------------------
  play(): void {
    if (this.state === "Idle") {
      if (this.problem.onlyShowResult || this.o.measureFirst === false) {
        this.startSession(this.o.config.lookaheadEvents);
        this.state = "Running";
      } else {
        this.startMeasure("play");
      }
    } else if (this.state === "Paused") {
      this.pendingSteps = 0;
      this.state = this.solverDone ? "Draining" : "Running";
    } else return;
    this.emit();
  }

  pause(): void {
    if (this.state !== "Running" && this.state !== "Draining") return;
    if (this.problem.onlyShowResult) return;
    this.state = "Paused";
    this.emit();
  }

  next(): void {
    if (!this.controls().next) return;
    if (this.state === "Idle") {
      if (this.o.measureFirst === false) {
        this.startSession(1);
        this.state = "Paused";
        this.pendingSteps = 1;
      } else {
        this.startMeasure("next");
      }
    } else if (this.cursor < this.history.length) {
      this.applyForward();
      this.afterMove(false);
    } else if (this.state === "Paused" && this.session && !this.solverDone) {
      this.pendingSteps++;
      this.session.raisePermit(this.history.length + this.pendingSteps); // frontier: permit up by one
    }
    this.emit();
  }

  back(): void {
    if (!this.controls().back) return;
    this.applyBackward();
    this.emit();
  }

  /** Pre-emptive cancel. Always returns to Idle with the initial board, empty history, status "Cancelled". */
  stop(): void {
    if (!this.controls().stop) return;
    this.session?.stop();
    this.reset();
    this.statusOverride = "Cancelled";
    this.emit();
  }

  /** Resize / Place: new problem, same cleanup as Stop but with a plain Idle status. */
  configure(problem: Problem): void {
    this.session?.stop();
    this.problem = problem;
    this.reset();
    this.emit();
  }

  dispose(): void {
    this.session?.stop();
    this.session = undefined;
    this.listeners.clear();
  }

  // ---- called by PlaybackEngine ------------------------------------------------------------
  /**
   * Applies up to `max` recorded events (Running / Draining only). Returns how many were applied.
   * Raises the permit to maxEventReached + L once per call, i.e. once per frame.
   */
  advance(max: number, budget?: { ms: number; now?: () => number }): number {
    if (this.state !== "Running" && this.state !== "Draining") return 0;

    const now = budget?.now ?? (() => performance.now());
    const deadline = budget ? now() + budget.ms : Infinity;
    let applied = 0;

    while (applied < max && this.cursor < this.history.length) {
      this.applyForward();
      applied++;
      if (budget && (applied & 127) === 0 && now() >= deadline) break;
    }
    if (applied > 0 || this.cursor === this.history.length)
      this.afterMove(true);
    if (applied > 0) this.emit();
    return applied;
  }

  // ---- internals ---------------------------------------------------------------------------
  private emit(): void {
    if (this.listeners.size === 0) return;
    const v = this.getView();
    for (const l of this.listeners) l(v);
  }

  private reset(): void {
    this.history.clear();
    const b = new Board(this.problem.n, this.problem.walls ?? []);
    for (const [x, y] of this.problem.preplaced) {
      b.put(x, y);
      b.lock(x, y);
    }
    this.displayBoard = b;
    this.session = undefined;
    this.state = "Idle";
    this.cursor = 0;
    this.counts = { put: 0, remove: 0, check: 0 };
    this.maxEventReached = 0;
    this.solverDone = false;
    this.pendingResult = undefined;
    this.measured = undefined;
    this.afterMeasure = undefined;
    this.consistency = null;
    this.result = null;
    this.pendingSteps = 0;
    this.statusOverride = undefined;
  }

  private startSession(initialPermit: number): void {
    this.statusOverride = undefined; // "Cancelled" only lasts until the next run starts
    const p = this.problem;
    const factory: SessionFactory =
      this.o.sessionFactory ?? ((o) => new Session(o));
    const s: SessionLike = factory({
      n: p.n,
      preplaced: p.preplaced,
      walls: p.walls,
      target: p.target,
      moduleUrl: p.moduleUrl,
      timeoutSeconds: p.timeoutSeconds,
      cutoffSeconds: p.cutoffSeconds,
      recordEvents: !p.onlyShowResult,
      initialPermit,
      createWorker: this.o.createWorker,
      onEvents: (ev) => {
        if (this.session === s) this.handleEvents(ev);
      },
      onFinish: (r) => {
        if (this.session === s) this.handleFinish(r);
      },
    });
    this.session = s;
    s.start();
  }

  private startMeasure(after: "play" | "next"): void {
    this.statusOverride = undefined;
    this.afterMeasure = after;
    this.state = "Measuring";
    const p = this.problem;
    const factory: SessionFactory =
      this.o.sessionFactory ?? ((o) => new Session(o));
    const s: SessionLike = factory({
      n: p.n,
      preplaced: p.preplaced,
      moduleUrl: p.moduleUrl,
      timeoutSeconds: p.timeoutSeconds,
      cutoffSeconds: p.cutoffSeconds,
      recordEvents: false, // same path as the benchmark
      initialPermit: PERMIT_UNLIMITED,
      createWorker: this.o.createWorker,
      onFinish: (r) => {
        if (this.session === s) this.handleMeasured(r);
      },
    });
    this.session = s;
    s.start();
  }

  private handleMeasured(r: SessionResult): void {
    if (r.status === "Cancelled") return;
    this.measured = r;
    this.session = undefined;
    const after = this.afterMeasure;
    this.afterMeasure = undefined;
    if (after === "next") {
      this.startSession(1);
      this.state = "Paused";
      this.pendingSteps = 1;
    } else {
      this.startSession(this.o.config.lookaheadEvents);
      this.state = "Running";
    }
    this.emit();
  }

  private handleEvents(events: Uint32Array): void {
    this.history.append(events, this.cursor);
    if (this.state === "Paused") {
      while (this.pendingSteps > 0 && this.cursor < this.history.length) {
        this.applyForward();
        this.pendingSteps--;
      }
      this.afterMove(false);
    }
    this.emit();
  }

  private handleFinish(r: SessionResult): void {
    if (r.status === "Cancelled") return;
    this.solverDone = true;
    this.session = undefined;
    this.pendingSteps = 0;
    if (this.problem.onlyShowResult && "finalBoard" in r && r.finalBoard)
      this.showFinalBoard(r.finalBoard);
    if (this.measured) {
      // Step mode: pass 1 is the official result; pass 2 only supplies the trace.
      this.consistency = compareRuns(this.measured, r);
      this.pendingResult = this.measured;
      if (this.state === "Running") this.state = "Draining";
      this.finalizeIfDone();
    } else if (r.status === "Failed" || r.status === "Execution Error") {
      this.result = r; // timeouts and errors are shown immediately (I6)
      this.state = "Finished";
    } else {
      this.pendingResult = r;
      if (this.state === "Running") this.state = "Draining";
      this.finalizeIfDone();
    }
    this.emit();
  }

  /** Only Show Result records no events, so the display board is built straight from the final snapshot. */
  private showFinalBoard(rows: string[]): void {
    const n = this.problem.n;
    if (rows.length !== n) return;
    const b = new Board(n, this.problem.walls ?? []);
    rows.forEach((row, x) => {
      for (let y = 0; y < Math.min(n, row.length); y++)
        if (row[y] === "Q") b.put(x, y);
    });
    for (const [x, y] of this.problem.preplaced)
      if (rows[x]?.[y] === "Q") b.lock(x, y);
    this.displayBoard = b;
  }

  private applyForward(): void {
    const e = decodeEvent(this.history.get(this.cursor));
    if (e.op === OP_PUT) {
      this.displayBoard.put(e.x, e.y);
      this.counts.put++;
    } else if (e.op === OP_REMOVE) {
      this.displayBoard.remove(e.x, e.y);
      this.counts.remove++;
    } else this.counts.check++; // a check never changes the board
    this.cursor++;
  }

  private applyBackward(): void {
    const e = decodeEvent(this.history.get(this.cursor - 1)); // events are their own inverse
    if (e.op === OP_PUT) {
      this.displayBoard.remove(e.x, e.y);
      this.counts.put--;
    } else if (e.op === OP_REMOVE) {
      this.displayBoard.put(e.x, e.y);
      this.counts.remove--;
    } else this.counts.check--;
    this.cursor--;
  }

  private afterMove(raisePermit: boolean): void {
    this.maxEventReached = Math.max(this.maxEventReached, this.cursor);
    if (raisePermit && this.session && !this.solverDone) {
      this.session.raisePermit(
        this.maxEventReached + this.o.config.lookaheadEvents,
      );
    }
    this.finalizeIfDone();
  }

  private finalizeIfDone(): void {
    if (
      this.pendingResult &&
      this.solverDone &&
      this.cursor === this.history.length
    ) {
      this.result = this.pendingResult;
      this.pendingResult = undefined;
      this.state = "Finished";
    }
  }
}

/** null when the two passes agree (or one of them has no event count, e.g. killed at the cutoff). */
function compareRuns(
  a: SessionResult,
  b: SessionResult,
): RunConsistency | null {
  if (!("eventCount" in a) || !("eventCount" in b)) return null;
  const fa = "finalBoard" in a ? a.finalBoard : undefined;
  const fb = "finalBoard" in b ? b.finalBoard : undefined;
  const same =
    a.eventCount === b.eventCount && JSON.stringify(fa) === JSON.stringify(fb);
  return same
    ? null
    : { eventCount: [a.eventCount, b.eventCount], finalBoard: [fa, fb] };
}
