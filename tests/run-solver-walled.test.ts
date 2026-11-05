import { describe, expect, it } from "vitest";
import { validateBoard } from "../Tester/Board/validator";
import { generateWalled } from "../Tester/Board/walled";
import { runSolver, type SolverModule } from "../Tester/Execution/core/run-solver";
import {
  CTRL_PERMIT,
  PERMIT_UNLIMITED,
  createControlBlock,
  decodeEvent,
  OP_PUT,
} from "../Tester/Execution/protocol";

function setup() {
  const control = createControlBlock();
  control.i32[CTRL_PERMIT] = PERMIT_UNLIMITED;
  const hostTarget: Record<string, any> = {};
  const batches: Uint32Array[] = [];
  return { control, hostTarget, batches, emit: (e: Uint32Array) => batches.push(e) };
}

describe("runSolver with walls and a target", () => {
  it("passes (n, q) to the solver, shows walls in view(), and the witness validates", async () => {
    const inst = generateWalled(10, 2, 12, 4);
    const s = setup();
    let args: number[] = [];
    let seenView = "";
    const out = await runSolver({
      n: 10,
      preplaced: inst.queens,
      walls: inst.walls,
      target: inst.q,
      control: s.control,
      recordEvents: true,
      emit: s.emit,
      hostTarget: s.hostTarget,
      loadModule: async (): Promise<SolverModule> => ({
        _nq_run: (n, q) => {
          args = [n, q];
          const h = s.hostTarget.__nqHost;
          seenView = new TextDecoder().decode(h.view());
          const pre = new Set(inst.queens.map(([x, y]) => `${x},${y}`));
          for (const [x, y] of inst.witness) if (!pre.has(`${x},${y}`)) expect(h.put(x, y)).toBe(true);
          return 0;
        },
      }),
    });
    expect(args).toEqual([10, inst.q]);
    expect([...seenView].filter((c) => c === "W")).toHaveLength(12);
    expect([...seenView].filter((c) => c === "Q")).toHaveLength(2);
    expect(out.status).toBe("completed");
    if (out.status !== "completed") return;
    expect(validateBoard(out.finalBoard, 10, inst.queens, { walls: inst.walls, target: inst.q })).toEqual({ ok: true });
    expect(out.eventCount).toBe(inst.q - 2);
    const ev = s.batches.flatMap((b) => [...b]).map(decodeEvent);
    expect(ev.every((e) => e.op === OP_PUT && e.valid && e.pairs === 0)).toBe(true);
  });

  it("without walls/target the solver gets q = n and the board is classic", async () => {
    const s = setup();
    let args: number[] = [];
    await runSolver({
      n: 6, preplaced: [], control: s.control, recordEvents: false, emit: s.emit, hostTarget: s.hostTarget,
      loadModule: async () => ({ _nq_run: (n, q) => ((args = [n, q]), 0) }),
    });
    expect(args).toEqual([6, 6]);
  });

  it("putQueen on a wall is an operation error; removeQueen on a wall too", async () => {
    for (const call of ["put", "remove"] as const) {
      const s = setup();
      const out = await runSolver({
        n: 4, preplaced: [], walls: [[1, 1]], control: s.control, recordEvents: true, emit: s.emit, hostTarget: s.hostTarget,
        loadModule: async () => ({ _nq_run: () => (s.hostTarget.__nqHost[call](1, 1), 0) }),
      });
      expect(out).toMatchObject({ status: "error", kind: "operation" });
      expect((out as any).message).toContain("cell is a wall");
    }
  });

  it("a wall cuts attacks: two queens on one row across a wall are both valid", async () => {
    const s = setup();
    const out = await runSolver({
      n: 4, preplaced: [], walls: [[0, 1]], target: 2, control: s.control, recordEvents: true, emit: s.emit, hostTarget: s.hostTarget,
      loadModule: async () => ({
        _nq_run: () => {
          const h = s.hostTarget.__nqHost;
          return h.put(0, 0) && h.put(0, 2) ? 0 : 1;
        },
      }),
    });
    expect(out.status).toBe("completed");
  });
});
