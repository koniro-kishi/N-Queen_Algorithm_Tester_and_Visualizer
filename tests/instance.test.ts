import { describe, expect, it } from "vitest";
import { buildInstance, InstanceCache } from "../Tester/Board/instance";
import { generatePreplaced } from "../Tester/Board/preplaced";
import { generateWalled } from "../Tester/Board/walled";

describe("buildInstance", () => {
  it("W = 0 is the classic instance: no walls, target = N", () => {
    const b = buildInstance(8, 3, 0, 1);
    expect(b).toEqual({ ok: true, n: 8, preplaced: generatePreplaced(8, 3, 1).queens, walls: [], target: 8 });
  });

  it("W > 0 is the walled instance: walls, preplaced and target come from the generator", () => {
    const g = generateWalled(10, 2, 12, 4);
    const b = buildInstance(10, 2, 12, 4);
    expect(b).toEqual({ ok: true, n: 10, preplaced: g.queens, walls: g.walls, target: g.q });
    expect(g.q).toBeGreaterThan(10);
  });

  it("returns the reason instead of throwing when no instance exists", () => {
    const noQ = buildInstance(8, 0, 0 + 1, 0);        // may or may not be feasible; must not throw
    expect(typeof noQ.ok).toBe("boolean");
    const bad = buildInstance(8, 9, 0, 0);            // P > N-1 in classic mode
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.reason).toMatch(/P must/);
    const q = generateWalled(8, 0, 8, 1).q;
    const tooMany = buildInstance(8, q, 8, 1);        // P >= Q
    expect(tooMany.ok).toBe(false);
    if (!tooMany.ok) expect(tooMany.reason).toMatch(/exceeds/);
  });
});

describe("InstanceCache", () => {
  it("returns the same object for the same key and rebuilds after the limit", () => {
    const c = new InstanceCache(2);
    const a = c.get(8, 0, 0, 0);
    expect(c.get(8, 0, 0, 0)).toBe(a);
    c.get(8, 0, 0, 1);
    c.get(8, 0, 0, 2);                                 // limit reached: cache cleared
    expect(c.get(8, 0, 0, 0)).not.toBe(a);
    expect(c.get(8, 0, 0, 0)).toEqual(a);
  });
});
