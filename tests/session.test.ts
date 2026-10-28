import { afterEach, describe, expect, it, vi } from 'vitest';
import { generatePreplaced } from '../Tester/Board/preplaced';
import { runSolver } from '../Tester/Execution/core/run-solver';
import {
  CTRL_PERMIT, CTRL_STATE, F_ACCUM_MS, F_RESUME_TS, PERMIT_UNLIMITED, STATE_RUNNING, STATE_WAITING,
  createControlBlock, type FromWorker, type StartMessage,
} from '../Tester/Execution/protocol';
import { Session, type SessionResult, type WorkerLike } from '../Tester/Execution/session';

type Host = { put(x: number, y: number): boolean; remove(x: number, y: number): void; view(): Uint8Array };
type Behavior = (msg: StartMessage, post: (m: FromWorker) => void) => Promise<void> | void;

class FakeWorker implements WorkerLike {
  onmessage: WorkerLike['onmessage'] = null;
  onerror: WorkerLike['onerror'] = null;
  terminated = false;
  constructor(private behavior: Behavior) {}
  postMessage(msg: any): void {
    queueMicrotask(() => this.behavior(msg, (m) => { if (!this.terminated) this.onmessage?.({ data: m }); }));
  }
  terminate(): void { this.terminated = true; }
  deliver(m: FromWorker) { this.onmessage?.({ data: m }); }
}

const backtracking = (host: Host, n: number): number => {
  const b = host.view();
  const fixed = Array.from({ length: n }, (_, r) => b.slice(r * n, r * n + n).includes(81));
  const place = (r: number): boolean => {
    if (r === n) return true;
    if (fixed[r]) return place(r + 1);
    for (let c = 0; c < n; c++) { if (host.put(r, c) && place(r + 1)) return true; host.remove(r, c); }
    return false;
  };
  return place(0) ? 0 : 1;
};

/** Worker that really runs runSolver on a given fake solver body. */
function runningWorker(solve: (host: Host, n: number) => number, now?: () => number): FakeWorker {
  return new FakeWorker(async (msg, post) => {
    const hostTarget: Record<string, any> = {};
    const outcome = await runSolver({
      n: msg.n, preplaced: msg.preplaced, recordEvents: msg.recordEvents, control: createControlBlock(msg.control),
      loadModule: async () => ({ _nq_run: (n: number) => solve(hostTarget.__nqHost, n) }),
      emit: (events) => post({ type: 'events', sessionId: msg.sessionId, events }),
      hostTarget, now,
    });
    post({ type: 'outcome', sessionId: msg.sessionId, outcome });
  });
}

function run(worker: FakeWorker, over: Partial<ConstructorParameters<typeof Session>[0]> = {}) {
  const inst = generatePreplaced(8, 3, 1);
  let resolve!: (r: SessionResult) => void;
  const done = new Promise<SessionResult>((r) => (resolve = r));
  const events: number[] = [];
  const session = new Session({
    n: 8, preplaced: inst.queens, moduleUrl: 'x', timeoutSeconds: 5, recordEvents: true, initialPermit: PERMIT_UNLIMITED,
    createWorker: () => worker, onFinish: resolve, onEvents: (e) => events.push(...e), ...over,
  });
  session.start();
  return { session, done, events, inst };
}

afterEach(() => vi.useRealTimers());

describe('Session', () => {
  it('Successful: valid board within the timeout', async () => {
    const w = runningWorker(backtracking);
    const { done, events } = run(w);
    const r = await done;
    expect(r.status).toBe('Successful');
    expect(events.length).toBeGreaterThan(0);
    expect(w.terminated).toBe(true);
  });

  it('Invalid Solution: returns 0 but the board breaks a rule', async () => {
    const w = runningWorker((h, n) => { for (let i = 0; i < n; i++) h.put(i, i); return 0; });
    const { done } = run(w, { n: 4, preplaced: [] });
    expect(await done).toMatchObject({ status: 'Invalid Solution', rule: 'diagonal' });
  });

  it('Execution Error: invalid API call surfaces the message', async () => {
    const w = runningWorker((h) => { h.remove(2, 2); return 0; });
    const { done } = run(w, { n: 4, preplaced: [] });
    const r = await done;
    expect(r).toMatchObject({ status: 'Execution Error', kind: 'operation' });
    expect((r as any).message).toContain('removeQueen(2,2): cell is empty');
  });

  it('Failed: completes correctly but compute time exceeds the timeout', async () => {
    let t = 0;
    const w = runningWorker((h, n) => { const r = backtracking(h, n); t += 5000; return r; }, () => t);
    const { done } = run(w, { timeoutSeconds: 1, now: () => t });
    expect(await done).toMatchObject({ status: 'Failed', timeoutSeconds: 1 });
  });

  it('Failed via watchdog: a hung solver is terminated after the timeout', async () => {
    vi.useFakeTimers();
    const clock = { t: 1_000 };
    const w = new FakeWorker((msg) => {
      const c = createControlBlock(msg.control);
      c.f64[F_ACCUM_MS] = 0; c.f64[F_RESUME_TS] = clock.t; Atomics.store(c.i32, CTRL_STATE, STATE_RUNNING);
    });
    const { done } = run(w, { timeoutSeconds: 1, now: () => clock.t });
    await vi.advanceTimersByTimeAsync(20);
    clock.t += 1500;
    await vi.advanceTimersByTimeAsync(20);
    expect(await done).toMatchObject({ status: 'Failed', timeoutSeconds: 1 });
    expect(w.terminated).toBe(true);
  });

  it('Pause never times out: waiting time is not counted', async () => {
    vi.useFakeTimers();
    const clock = { t: 1_000 };
    const w = new FakeWorker((msg) => {
      const c = createControlBlock(msg.control);
      c.f64[F_ACCUM_MS] = 100; Atomics.store(c.i32, CTRL_STATE, STATE_WAITING);
    });
    let result: SessionResult | undefined;
    const { session } = run(w, { timeoutSeconds: 1, now: () => clock.t, onFinish: (r) => (result = r) });
    await vi.advanceTimersByTimeAsync(20);
    clock.t += 60_000;
    await vi.advanceTimersByTimeAsync(200);
    expect(result).toBeUndefined();
    session.stop();
    expect(result).toEqual({ status: 'Cancelled' });
  });

  it('stop(): Cancelled, worker terminated, stale messages ignored, finishes once', async () => {
    const w = new FakeWorker(() => {});
    const results: SessionResult[] = [];
    const { session } = run(w, { onFinish: (r) => results.push(r) });
    session.stop();
    session.stop();
    w.deliver({ type: 'outcome', sessionId: session.id, outcome: { status: 'completed', computeMs: 1, eventCount: 0, finalBoard: [] } });
    expect(results).toEqual([{ status: 'Cancelled' }]);
    expect(w.terminated).toBe(true);
  });

  it('ignores messages from another session id', async () => {
    const w = new FakeWorker(() => {});
    const results: SessionResult[] = [];
    const { session } = run(w, { onFinish: (r) => results.push(r) });
    w.deliver({ type: 'outcome', sessionId: session.id + 999, outcome: { status: 'completed', computeMs: 1, eventCount: 0, finalBoard: [] } });
    expect(results).toHaveLength(0);
    session.stop();
  });

  it('raisePermit never lowers, and notifies only while the worker is waiting', async () => {
    const w = new FakeWorker(() => {});
    const { session } = run(w, { initialPermit: 1 });
    const notify = vi.spyOn(Atomics, 'notify');
    expect(Atomics.load(session.control.i32, CTRL_PERMIT)).toBe(1);
    session.raisePermit(5);
    expect(Atomics.load(session.control.i32, CTRL_PERMIT)).toBe(5);
    expect(notify).not.toHaveBeenCalled();
    session.raisePermit(3);
    expect(Atomics.load(session.control.i32, CTRL_PERMIT)).toBe(5);
    Atomics.store(session.control.i32, CTRL_STATE, STATE_WAITING);
    session.raisePermit(6);
    expect(notify).toHaveBeenCalledTimes(1);
    notify.mockRestore();
    session.stop();
  });

  it('Only Show Result forces an unlimited permit', () => {
    const { session } = run(new FakeWorker(() => {}), { recordEvents: false, initialPermit: 1 });
    expect(Atomics.load(session.control.i32, CTRL_PERMIT)).toBe(PERMIT_UNLIMITED);
    session.stop();
  });

  it('worker script error before start is reported as a load error', () => {
    const w = new FakeWorker(() => {});
    let result: SessionResult | undefined;
    run(w, { onFinish: (r) => (result = r) });
    w.onerror?.({ message: 'Failed to fetch module' });
    expect(result).toMatchObject({ status: 'Execution Error', kind: 'load', message: 'Failed to fetch module' });
  });
});
