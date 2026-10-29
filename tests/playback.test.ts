import { describe, expect, it, vi } from 'vitest';
import { encodeEvent, OP_PUT, OP_REMOVE } from '../Tester/Execution/protocol';
import { SessionController, type SessionLike } from '../Tester/Execution/session-controller';
import type { SessionOptions } from '../Tester/Execution/session';
import { delayMsToSlider, PlaybackEngine, sliderToDelayMs, type PlaybackTarget } from '../Tester/Visualization/playback';

/** Manual requestAnimationFrame. */
function makeRaf() {
  let id = 0;
  const pending = new Map<number, (ts: number) => void>();
  return {
    raf: (cb: (ts: number) => void) => { pending.set(++id, cb); return id; },
    caf: (h: number) => { pending.delete(h); },
    get count() { return pending.size; },
    frame(ts: number) {
      const cbs = [...pending.values()];
      pending.clear();
      cbs.forEach((cb) => cb(ts));
    },
  };
}

function fakeTarget(state = 'Idle') {
  const subs = new Set<(v: { state: string }) => void>();
  const t = {
    state,
    advance: vi.fn((max: number) => (Number.isFinite(max) ? max : 0)),
    getView: () => ({ state: t.state }),
    subscribe: (fn: (v: { state: string }) => void) => { subs.add(fn); return () => subs.delete(fn); },
    set(s: string) { t.state = s; subs.forEach((f) => f({ state: s })); },
  };
  return t satisfies PlaybackTarget & Record<string, unknown>;
}

describe('slider mapping', () => {
  it('right end is fastest; clamps; round-trips', () => {
    expect(sliderToDelayMs(0)).toBe(5000);
    expect(sliderToDelayMs(5000)).toBe(0);
    expect(sliderToDelayMs(-10)).toBe(5000);
    expect(sliderToDelayMs(9999)).toBe(0);
    expect(delayMsToSlider(sliderToDelayMs(1234))).toBe(1234);
  });
});

describe('PlaybackEngine scheduling', () => {
  it('runs rAF only while Running/Draining', () => {
    const r = makeRaf(); const t = fakeTarget();
    new PlaybackEngine({ target: t, delayMs: 100, raf: r.raf, caf: r.caf });
    expect(r.count).toBe(0);
    t.set('Running');
    expect(r.count).toBe(1);
    t.set('Paused');
    expect(r.count).toBe(0);
    t.set('Draining');
    expect(r.count).toBe(1);
    r.frame(0);
    t.set('Finished');
    r.frame(16);
    expect(r.count).toBe(0);
  });

  it('starts already running when the target is Running at construction', () => {
    const r = makeRaf();
    new PlaybackEngine({ target: fakeTarget('Running'), delayMs: 100, raf: r.raf, caf: r.caf });
    expect(r.count).toBe(1);
  });

  it('shows one event on the first frame, then one per delay (accumulator, not per-frame rounding)', () => {
    const r = makeRaf(); const t = fakeTarget();
    new PlaybackEngine({ target: t, delayMs: 100, raf: r.raf, caf: r.caf });
    t.set('Running');
    r.frame(1000);
    expect(t.advance).toHaveBeenLastCalledWith(1, expect.anything());
    let applied = 1;
    for (let ts = 1016; ts <= 1016 + 16 * 30; ts += 16) { // 31 frames, 480 ms
      t.advance.mockClear();
      r.frame(ts);
      applied += t.advance.mock.calls.reduce((a, c) => a + (c[0] as number), 0);
    }
    expect(applied).toBe(1 + Math.floor((16 * 30 + 16) / 100)); // 1 initial + floor(496 / 100) = 5
  });

  it('delay below the frame time applies several events per frame', () => {
    const r = makeRaf(); const t = fakeTarget();
    new PlaybackEngine({ target: t, delayMs: 4, raf: r.raf, caf: r.caf });
    t.set('Running');
    r.frame(0);          // initial event
    t.advance.mockClear();
    r.frame(16);
    expect(t.advance).toHaveBeenCalledWith(4, expect.anything());
  });

  it('delay 0 runs a time budget instead of a count', () => {
    const r = makeRaf(); const t = fakeTarget();
    new PlaybackEngine({ target: t, delayMs: 0, frameBudgetMs: 8, raf: r.raf, caf: r.caf });
    t.set('Running');
    r.frame(0);
    expect(t.advance).toHaveBeenCalledWith(Infinity, { ms: 8 });
  });

  it('clamps long frame gaps so a background tab does not burst', () => {
    const r = makeRaf(); const t = fakeTarget();
    new PlaybackEngine({ target: t, delayMs: 10, maxDtMs: 100, raf: r.raf, caf: r.caf });
    t.set('Running');
    r.frame(0);
    t.advance.mockClear();
    r.frame(60_000);
    expect(t.advance).toHaveBeenCalledWith(10, expect.anything()); // 100 ms / 10 ms, not 6000
  });

  it('drops the carried time when starved, so waiting for the solver causes no catch-up burst', () => {
    const r = makeRaf(); const t = fakeTarget();
    t.advance.mockImplementation(() => 0); // nothing available
    new PlaybackEngine({ target: t, delayMs: 100, raf: r.raf, caf: r.caf });
    t.set('Running');
    r.frame(0); r.frame(100); r.frame(200);
    t.advance.mockClear();
    t.advance.mockImplementation((max: number) => max);
    r.frame(216);
    expect(t.advance).not.toHaveBeenCalled(); // 16 ms accumulated, below one delay
  });

  it('setDelay takes effect immediately and clamps negatives', () => {
    const r = makeRaf(); const t = fakeTarget();
    const p = new PlaybackEngine({ target: t, delayMs: 1000, raf: r.raf, caf: r.caf });
    p.setDelay(-5);
    expect(p.delay).toBe(0);
    t.set('Running');
    r.frame(0);
    expect(t.advance).toHaveBeenCalledWith(Infinity, expect.anything());
  });

  it('dispose cancels the pending frame and ignores later state changes', () => {
    const r = makeRaf(); const t = fakeTarget();
    const p = new PlaybackEngine({ target: t, delayMs: 100, raf: r.raf, caf: r.caf });
    t.set('Running');
    p.dispose();
    expect(r.count).toBe(0);
    t.set('Paused'); t.set('Running');
    expect(r.count).toBe(0);
  });

  it('does not double-schedule when the target changes state during its own frame', () => {
    const r = makeRaf(); const t = fakeTarget();
    t.advance.mockImplementation((max: number) => { t.set('Draining'); return max; }); // controller emits inside advance
    new PlaybackEngine({ target: t, delayMs: 100, raf: r.raf, caf: r.caf });
    t.set('Running');
    r.frame(0);
    expect(r.count).toBe(1);
  });
});

// ---- with the real controller ----------------------------------------------------------------
class FakeSession implements SessionLike {
  permits: number[] = [];
  constructor(readonly o: SessionOptions) {}
  start() {}
  raisePermit(t: number) { this.permits.push(t); }
  stop() {}
}

describe('PlaybackEngine + SessionController', () => {
  function setup() {
    let session!: FakeSession;
    const c = new SessionController({
      config: { lookaheadEvents: 50, maxRetainedEvents: 100_000 },
      problem: { n: 8, preplaced: [], moduleUrl: 'm', timeoutSeconds: 5, onlyShowResult: false },
      createWorker: () => { throw new Error('unused'); },
      sessionFactory: (o) => (session = new FakeSession(o)),
    });
    const r = makeRaf();
    const p = new PlaybackEngine({ target: c, delayMs: 0, raf: r.raf, caf: r.caf });
    return { c, r, p, session: () => session };
  }

  it('delay 0 drains every recorded event in one frame, then the terminal result appears', () => {
    const { c, r, session } = setup();
    c.play();
    // alternate put/remove on one cell so the display board stays consistent
    const evs = Uint32Array.from({ length: 400 }, (_, i) => encodeEvent(0, 0, i % 2 === 0 ? OP_PUT : OP_REMOVE, true, 0));
    session().o.onEvents!(evs);
    session().o.onFinish({ status: 'Successful', computeMs: 3, eventCount: 400, finalBoard: [] });
    expect(c.getView().state).toBe('Draining');

    r.frame(0);
    expect(c.getView()).toMatchObject({ cursor: 400, state: 'Finished', status: 'Successful' });
    expect(r.count).toBe(0); // loop stopped by itself
  });

  it('a short budget leaves events for the next frame, and the permit rises once per frame', () => {
    const { c, r, session } = setup();
    c.play();
    const evs = Uint32Array.from({ length: 1000 }, (_, i) => encodeEvent(0, 0, i % 2 === 0 ? OP_PUT : OP_REMOVE, true, 0));
    session().o.onEvents!(evs);
    let t = 0;
    const applied = c.advance(Infinity, { ms: 5, now: () => (t += 100) }); // clock jumps 100 ms per read
    expect(applied).toBe(128);
    expect(c.getView().cursor).toBe(128);
    expect(session().permits).toEqual([128 + 50]);
    r.frame(0);
    expect(c.getView().cursor).toBeGreaterThan(128);
  });

  it('Pause stops the loop; Play resumes it', () => {
    const { c, r, session } = setup();
    c.play();
    expect(r.count).toBe(1);
    session().o.onEvents!(Uint32Array.from([encodeEvent(0, 0, OP_PUT, true, 0)]));
    c.pause();
    expect(r.count).toBe(0);
    c.play();
    expect(r.count).toBe(1);
  });
});
