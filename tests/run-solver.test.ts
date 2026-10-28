import { describe, expect, it } from 'vitest';
import { Board } from '../Tester/Board/board';
import { generatePreplaced } from '../Tester/Board/preplaced';
import { validateBoard } from '../Tester/Board/validator';
import { runSolver, type SolverModule } from '../Tester/Execution/core/run-solver';
import {
  CTRL_PERMIT, CTRL_STATE, PERMIT_UNLIMITED, STATE_DONE, createControlBlock, decodeEvent, OP_PUT,
} from '../Tester/Execution/protocol';

type Host = { put(x: number, y: number): boolean; remove(x: number, y: number): void; view(): Uint8Array };

/** JS stand-in for the WASM backtracking solver: same call pattern, talks to globalThis-like host. */
function fakeBacktracking(host: Host, tick: () => void = () => {}): (n: number) => number {
  return (n) => {
    const b = host.view();
    const fixed = Array.from({ length: n }, (_, r) => b.slice(r * n, r * n + n).includes(81));
    const place = (r: number): boolean => {
      if (r === n) return true;
      if (fixed[r]) return place(r + 1);
      for (let c = 0; c < n; c++) {
        tick(); if (host.put(r, c) && place(r + 1)) return true;
        tick(); host.remove(r, c);
      }
      return false;
    };
    return place(0) ? 0 : 1;
  };
}

function setup(n: number, p: number, seed: number) {
  const inst = generatePreplaced(n, p, seed);
  const hostTarget: Record<string, any> = {};
  const control = createControlBlock();
  const batches: Uint32Array[] = [];
  const module = (run?: (n: number) => number): (() => Promise<SolverModule>) => async () => ({
    _nq_run: run ?? fakeBacktracking(hostTarget.__nqHost),
  });
  return { inst, hostTarget, control, batches, emit: (e: Uint32Array) => batches.push(e), module };
}

describe('runSolver', () => {
  it('solves, validates, and the event stream replays to the final board', async () => {
    const s = setup(8, 3, 1);
    s.control.i32[CTRL_PERMIT] = PERMIT_UNLIMITED;
    const out = await runSolver({
      n: 8, preplaced: s.inst.queens, loadModule: async () => ({ _nq_run: fakeBacktracking(s.hostTarget.__nqHost) }),
      control: s.control, recordEvents: true, emit: s.emit, hostTarget: s.hostTarget,
    });
    expect(out.status).toBe('completed');
    if (out.status !== 'completed') return;
    expect(validateBoard(out.finalBoard, 8, s.inst.queens)).toEqual({ ok: true });
    expect(Atomics.load(s.control.i32, CTRL_STATE)).toBe(STATE_DONE);

    const events = s.batches.flatMap((b) => [...b]);
    expect(events.length).toBe(out.eventCount);
    const replay = new Board(8);
    s.inst.queens.forEach(([x, y]) => replay.put(x, y));
    for (const e of events) {
      const d = decodeEvent(e);
      if (d.op === OP_PUT) replay.put(d.x, d.y); else replay.remove(d.x, d.y);
      expect(d.pairs).toBe(replay.pairs);
      expect(d.valid).toBe(replay.pairs === 0);
    }
    expect(replay.view()).toEqual(out.finalBoard);
  });

  it('applies back-pressure: flushes before every wait and resumes only after the permit rises', async () => {
    const s = setup(6, 0, 2);
    s.control.i32[CTRL_PERMIT] = 1; // Idle + Next: exactly one event allowed
    let waits = 0;
    const out = await runSolver({
      n: 6, preplaced: [], loadModule: async () => ({ _nq_run: fakeBacktracking(s.hostTarget.__nqHost) }),
      control: s.control, recordEvents: true, emit: s.emit, hostTarget: s.hostTarget,
      waitOnPermit: (i32, observed) => {
        waits++;
        const emitted = s.batches.reduce((a, b) => a + b.length, 0);
        expect(emitted).toBe(observed); // everything produced so far was flushed before blocking
        expect(Atomics.load(i32, CTRL_STATE)).toBe(2); // WAITING
        Atomics.store(i32, CTRL_PERMIT, observed + 1); // "Next" at the frontier
      },
    });
    expect(out.status).toBe('completed');
    expect(waits).toBe(out.eventCount); // permit = produced + 1 each time, so every event waits
  });

  it('excludes waiting time from compute time', async () => {
    const s = setup(6, 0, 3);
    s.control.i32[CTRL_PERMIT] = 1;
    let t = 1_000_000;
    const out = await runSolver({
      n: 6, preplaced: [],
      loadModule: async () => ({ _nq_run: fakeBacktracking(s.hostTarget.__nqHost, () => { t += 2; }) }),
      control: s.control, recordEvents: true, emit: s.emit, hostTarget: s.hostTarget,
      now: () => t,
      waitOnPermit: (i32, observed) => { t += 1000; Atomics.store(i32, CTRL_PERMIT, observed + 1); },
    });
    expect(out.status).toBe('completed');
    expect(out.computeMs).toBe(2 * out.eventCount); // 2 ms per op, 1000 ms waits not counted
  });

  it('Only Show Result: counts events, records none, never waits', async () => {
    const s = setup(8, 2, 4);
    let waits = 0;
    const out = await runSolver({
      n: 8, preplaced: s.inst.queens, loadModule: async () => ({ _nq_run: fakeBacktracking(s.hostTarget.__nqHost) }),
      control: s.control, recordEvents: false, emit: s.emit, hostTarget: s.hostTarget,
      waitOnPermit: () => { waits++; },
    });
    expect(out.status).toBe('completed');
    expect(out.eventCount).toBeGreaterThan(0);
    expect(s.batches).toHaveLength(0);
    expect(waits).toBe(0);
  });

  it('maps an invalid operation to an operation error and keeps events up to it', async () => {
    const s = setup(4, 0, 5);
    s.control.i32[CTRL_PERMIT] = PERMIT_UNLIMITED;
    const out = await runSolver({
      n: 4, preplaced: [], control: s.control, recordEvents: true, emit: s.emit, hostTarget: s.hostTarget,
      loadModule: async () => ({ _nq_run: () => { s.hostTarget.__nqHost.put(0, 0); s.hostTarget.__nqHost.remove(3, 3); return 0; } }),
    });
    expect(out).toMatchObject({ status: 'error', kind: 'operation', eventCount: 1 });
    expect((out as any).message).toContain('removeQueen(3,3): cell is empty');
    expect(s.batches.flatMap((b) => [...b])).toHaveLength(1);
  });

  it('refuses to remove a locked preplaced queen', async () => {
    const s = setup(4, 0, 6);
    s.control.i32[CTRL_PERMIT] = PERMIT_UNLIMITED;
    const out = await runSolver({
      n: 4, preplaced: [[0, 1]], control: s.control, recordEvents: true, emit: s.emit, hostTarget: s.hostTarget,
      loadModule: async () => ({ _nq_run: () => { s.hostTarget.__nqHost.remove(0, 1); return 0; } }),
    });
    expect(out).toMatchObject({ status: 'error', kind: 'operation' });
    expect((out as any).message).toContain('locked');
  });

  it('reports non-zero return, exit, trap and load failures', async () => {
    const mk = (fn: () => number) => async () => {
      const s = setup(4, 0, 7);
      return runSolver({
        n: 4, preplaced: [], control: s.control, recordEvents: false, emit: s.emit, hostTarget: s.hostTarget,
        loadModule: async () => ({ _nq_run: fn }),
      });
    };
    expect(await mk(() => 1)()).toMatchObject({ status: 'error', kind: 'solver-nonzero' });
    expect(await mk(() => { throw Object.assign(new Error('exit(1)'), { name: 'ExitStatus' }); })()).toMatchObject({ kind: 'exit' });
    expect(await mk(() => { throw new RangeError('Maximum call stack size exceeded'); })()).toMatchObject({ kind: 'trap' });

    const s = setup(4, 0, 8);
    const out = await runSolver({
      n: 4, preplaced: [], control: s.control, recordEvents: false, emit: s.emit, hostTarget: s.hostTarget,
      loadModule: async () => { throw new Error('404 solver.wasm'); },
    });
    expect(out).toMatchObject({ status: 'error', kind: 'load', computeMs: 0, message: '404 solver.wasm' });
  });

  it('does not leak __nqHost after a run', async () => {
    const s = setup(4, 0, 9);
    await runSolver({
      n: 4, preplaced: [], control: s.control, recordEvents: false, emit: s.emit, hostTarget: s.hostTarget,
      loadModule: async () => ({ _nq_run: () => 1 }),
    });
    expect(s.hostTarget.__nqHost).toBeUndefined();
  });
});
