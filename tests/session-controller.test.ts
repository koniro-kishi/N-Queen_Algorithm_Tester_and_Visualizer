import { describe, expect, it, vi } from "vitest";
import { encodeEvent, OP_PUT, OP_REMOVE } from "../Tester/Execution/protocol";
import {
  SessionController,
  type Problem,
  type SessionLike,
} from "../Tester/Execution/session-controller";
import type {
  SessionOptions,
  SessionResult,
  WorkerLike,
} from "../Tester/Execution/session";

const put = (x: number, y: number) => encodeEvent(x, y, OP_PUT, true, 0);
const rem = (x: number, y: number) => encodeEvent(x, y, OP_REMOVE, true, 0);
const batch = (...e: number[]) => Uint32Array.from(e);

class FakeSession implements SessionLike {
  started = false;
  stopped = false;
  permits: number[] = [];
  constructor(readonly o: SessionOptions) {}
  start() {
    this.started = true;
  }
  raisePermit(t: number) {
    this.permits.push(t);
  }
  stop() {
    this.stopped = true;
  }
}

function make(
  over: Partial<Problem> = {},
  config = { lookaheadEvents: 100, maxRetainedEvents: 1000 },
  chunkSize?: number,
) {
  const sessions: FakeSession[] = [];
  const problem: Problem = {
    n: 4,
    preplaced: [],
    moduleUrl: "m",
    timeoutSeconds: 5,
    onlyShowResult: false,
    ...over,
  };
  const c = new SessionController({
    config,
    problem,
    chunkSize,
    createWorker: () => {
      throw new Error("unused");
    },
    sessionFactory: (o) => {
      const s = new FakeSession(o);
      sessions.push(s);
      return s;
    },
  });
  return { c, sessions, last: () => sessions[sessions.length - 1]!, problem };
}

const OK: SessionResult = {
  status: "Successful",
  computeMs: 12,
  eventCount: 3,
  finalBoard: [],
};

describe("Play flow", () => {
  it("Idle -> Play starts the solver with permit L, replays events, drains, then Finished", () => {
    const { c, last } = make();
    c.play();
    expect(c.getView().state).toBe("Running");
    expect(last().o.initialPermit).toBe(100);
    expect(last().o.recordEvents).toBe(true);

    last().o.onEvents!(batch(put(0, 1), put(1, 3), rem(1, 3)));
    expect(c.getView().length).toBe(3);
    expect(c.getView().cursor).toBe(0); // playback has not run yet

    expect(c.advance(2)).toBe(2);
    expect(c.board.view()).toEqual(["xQxx", "xxxQ", "xxxx", "xxxx"]);
    expect(last().permits).toEqual([2 + 100]); // maxEventReached + L

    last().o.onFinish(OK);
    expect(c.getView().state).toBe("Draining");
    expect(c.getView().result).toBeNull(); // not shown until playback reaches the end
    expect(c.getView().controls).toMatchObject({
      back: false,
      next: false,
      playPause: "pause",
      stop: true,
    });

    expect(c.advance(10)).toBe(1);
    expect(c.getView()).toMatchObject({
      state: "Finished",
      status: "Successful",
      cursor: 3,
    });
    expect(c.getView().result).toEqual(OK);
    expect(c.board.view()[1]).toBe("xxxx");
  });

  it("advance does nothing unless Running/Draining", () => {
    const { c, last } = make();
    expect(c.advance(5)).toBe(0);
    c.next();
    last().o.onEvents!(batch(put(0, 0), put(1, 2)));
    expect(c.advance(5)).toBe(0); // Paused
  });
});

describe("Next / Back stepping", () => {
  it("Next from Idle starts the solver with permit 1 and shows event 1", () => {
    const { c, last } = make();
    c.next();
    expect(last().o.initialPermit).toBe(1);
    expect(c.getView().state).toBe("Paused");
    last().o.onEvents!(batch(put(0, 1)));
    expect(c.getView()).toMatchObject({ cursor: 1, state: "Paused" });
    expect(c.getView().currentEvent).toMatchObject({ x: 0, y: 1 });
  });

  it("Next at the frontier raises the permit by one; Back and Next in history never touch the solver", () => {
    const { c, last } = make();
    c.next();
    last().o.onEvents!(batch(put(0, 1)));
    c.next(); // frontier
    expect(last().permits).toEqual([2]);
    last().o.onEvents!(batch(put(1, 3)));
    expect(c.getView().cursor).toBe(2);

    c.back();
    expect(c.getView().cursor).toBe(1);
    expect(c.board.view()[1]).toBe("xxxx");
    c.next(); // replay from history
    expect(c.getView().cursor).toBe(2);
    c.back();
    c.back();
    expect(c.getView().cursor).toBe(0);
    expect(c.getView().controls.back).toBe(false);
    expect(last().permits).toEqual([2]); // unchanged: Back/Next never lowered or raised it
  });

  it("queued Next presses each consume one event", () => {
    const { c, last } = make();
    c.next();
    last().o.onEvents!(batch(put(0, 0)));
    c.next();
    c.next();
    expect(last().permits).toEqual([2, 3]);
    last().o.onEvents!(batch(put(1, 2), put(2, 1), put(3, 3)));
    expect(c.getView().cursor).toBe(3); // exactly two more steps, not all three
  });

  it("Back is disabled while Running and Draining, enabled once Paused", () => {
    const { c, last } = make();
    c.play();
    last().o.onEvents!(batch(put(0, 0), put(1, 2)));
    c.advance(2);
    expect(c.getView().controls.back).toBe(false);
    c.pause();
    expect(c.getView()).toMatchObject({ state: "Paused" });
    expect(c.getView().controls).toMatchObject({
      back: true,
      next: true,
      playPause: "play",
    });
  });

  it("Play from the middle of history replays to the frontier then continues", () => {
    const { c, last } = make();
    c.play();
    last().o.onEvents!(batch(put(0, 0), put(1, 2), put(2, 1)));
    c.advance(3);
    c.pause();
    c.back();
    c.back();
    expect(c.getView().cursor).toBe(1);
    c.play();
    expect(c.getView().state).toBe("Running");
    c.advance(10);
    expect(c.getView().cursor).toBe(3);
    expect(c.getView().maxEventReached).toBe(3);
  });

  it("Draining -> Pause -> step to the end finalizes the result", () => {
    const { c, last } = make();
    c.play();
    last().o.onEvents!(batch(put(0, 0), put(1, 2)));
    c.advance(1);
    last().o.onFinish(OK);
    expect(c.getView().state).toBe("Draining");
    c.pause();
    expect(c.getView().state).toBe("Paused");
    expect(c.getView().controls.back).toBe(true);
    c.next();
    expect(c.getView()).toMatchObject({
      state: "Finished",
      status: "Successful",
    });
  });
});

describe("Terminal results", () => {
  it("Failed (timeout) shows immediately; history stays navigable", () => {
    const { c, last } = make();
    c.play();
    last().o.onEvents!(batch(put(0, 0), put(1, 2), put(2, 1)));
    c.advance(1);
    last().o.onFinish({
      status: "Failed",
      timeoutSeconds: 0.5,
      elapsedMs: 600,
    });
    const v = c.getView();
    expect(v).toMatchObject({
      state: "Finished",
      status: "Failed",
      cursor: 1,
      length: 3,
    });
    expect(v.controls).toMatchObject({
      back: true,
      next: true,
      playPause: "off",
      stop: true,
    });
    c.next();
    c.next();
    expect(c.getView().cursor).toBe(3);
    expect(c.getView().controls.next).toBe(false);
  });

  it("Execution Error shows immediately", () => {
    const { c, last } = make();
    c.next();
    last().o.onFinish({
      status: "Execution Error",
      kind: "operation",
      message: "removeQueen(3,7): cell is empty",
      computeMs: 1,
      eventCount: 0,
    });
    expect(c.getView()).toMatchObject({
      state: "Finished",
      status: "Execution Error",
    });
  });

  it("a result with no events at all finishes immediately", () => {
    const { c, last } = make();
    c.play();
    last().o.onFinish({
      status: "Invalid Solution",
      rule: "queen-count",
      message: "x",
      computeMs: 0,
      eventCount: 0,
      finalBoard: [],
    });
    expect(c.getView()).toMatchObject({
      state: "Finished",
      status: "Invalid Solution",
    });
  });
});

describe("Only Show Result", () => {
  it("records nothing, Back/Next/Pause permanently off, result shown on finish", () => {
    const { c, last } = make({ onlyShowResult: true });
    expect(c.getView().controls).toEqual({
      back: false,
      next: false,
      stop: false,
      playPause: "play",
    });
    c.next(); // ignored
    expect(c.getView().state).toBe("Idle");
    c.play();
    expect(last().o.recordEvents).toBe(false);
    expect(c.getView().controls).toEqual({
      back: false,
      next: false,
      stop: true,
      playPause: "off",
    });
    c.pause();
    expect(c.getView().state).toBe("Running");
    last().o.onFinish(OK);
    expect(c.getView()).toMatchObject({
      state: "Finished",
      status: "Successful",
    });
    expect(c.getView().controls).toEqual({
      back: false,
      next: false,
      stop: true,
      playPause: "off",
    });
  });
});

describe("Stop / configure / isolation", () => {
  it("Stop returns to Idle: initial board, empty history, status Cancelled; stale events are ignored", () => {
    const { c, last } = make({ preplaced: [[0, 1]] });
    c.play();
    const old = last();
    old.o.onEvents!(batch(put(1, 3)));
    c.advance(1);
    c.stop();
    expect(old.stopped).toBe(true);
    expect(c.getView()).toMatchObject({
      state: "Idle",
      status: "Cancelled",
      cursor: 0,
      length: 0,
      maxEventReached: 0,
      result: null,
    });
    expect(c.board.view()).toEqual(["xQxx", "xxxx", "xxxx", "xxxx"]);
    expect(c.board.isLocked(0, 1)).toBe(true);

    old.o.onEvents!(batch(put(2, 2))); // late message from the dead session
    old.o.onFinish(OK);
    expect(c.getView()).toMatchObject({
      state: "Idle",
      length: 0,
      cursor: 0,
      result: null,
    });
  });

  it("Stop is disabled in Idle; a new Play after Stop uses a fresh session", () => {
    const { c, sessions } = make();
    c.stop();
    expect(c.getView().status).toBe("Idle");
    c.play();
    c.stop();
    c.play();
    expect(sessions).toHaveLength(2);
    expect(c.getView().status).toBe("Running");
  });

  it("configure() replaces the problem, stops the old session, plain Idle status", () => {
    const { c, last } = make();
    c.play();
    const old = last();
    c.configure({
      n: 6,
      preplaced: [[2, 3]],
      moduleUrl: "m",
      timeoutSeconds: 1,
      onlyShowResult: false,
    });
    expect(old.stopped).toBe(true);
    expect(c.getView()).toMatchObject({ state: "Idle", status: "Idle" });
    expect(c.board.n).toBe(6);
    expect(c.board.view()[2]).toBe("xxxQxx");
  });

  it("notifies subscribers and supports unsubscribe", () => {
    const { c, last } = make();
    const fn = vi.fn();
    const off = c.subscribe(fn);
    c.play();
    last().o.onEvents!(batch(put(0, 0)));
    expect(fn).toHaveBeenCalled();
    const n = fn.mock.calls.length;
    off();
    c.advance(1);
    expect(fn.mock.calls.length).toBe(n);
  });
});

describe("Truncation", () => {
  it("keeps the cursor valid and disables Back at the oldest retained event", () => {
    const { c, last } = make(
      { n: 20 },
      { lookaheadEvents: 1000, maxRetainedEvents: 8 },
      4,
    );
    c.play();
    // 30 alternating put/remove events on one cell keep the display board trivially valid
    const events: number[] = [];
    for (let i = 0; i < 15; i++) events.push(put(0, 0), rem(0, 0));
    for (let i = 0; i < events.length; i += 6) {
      last().o.onEvents!(batch(...events.slice(i, i + 6)));
      c.advance(6);
    }
    const v = c.getView();
    expect(v.truncated).toBe(true);
    expect(v.firstIndex).toBeGreaterThan(0);
    expect(v.cursor).toBe(30);
    c.pause();
    while (c.getView().controls.back) c.back();
    expect(c.getView().cursor).toBeGreaterThanOrEqual(c.getView().firstIndex);
    expect(c.getView().controls.back).toBe(false);
  });
});

describe("advance budget", () => {
  it("berhenti saat budget habis (dicek tiap 128 event); tanpa budget menghabiskan sisanya", () => {
    const { c, last } = make(
      {},
      { lookaheadEvents: 100, maxRetainedEvents: 100_000 },
    );
    c.play();
    const evs: number[] = [];
    for (let i = 0; i < 500; i++) evs.push(put(0, 0), rem(0, 0)); // 1000 event
    last().o.onEvents!(Uint32Array.from(evs));
    let t = 0;
    // now() naik 5 per panggilan: deadline = 5 + 10 = 15; cek di event 128 -> 10, di event 256 -> 15 => berhenti
    expect(c.advance(Infinity, { ms: 10, now: () => (t += 5) })).toBe(256);
    expect(c.getView().cursor).toBe(256);
    expect(c.advance(Infinity)).toBe(744);
  });
});
