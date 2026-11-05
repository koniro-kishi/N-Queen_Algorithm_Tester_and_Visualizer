// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { ConfigPanel, noBenchmarkMessage, type ConfigPanelOptions } from "../Tester/UI/panels";
import { maxWallsByFraction } from "../Tester/Board/walled";

function make(over: Partial<ConfigPanelOptions> = {}) {
  const on = {
    resize: vi.fn(), place: vi.fn(), solver: vi.fn(), onlyShowResult: vi.fn(), delay: vi.fn(),
    back: vi.fn(), playPause: vi.fn(), next: vi.fn(), stop: vi.fn(),
  };
  const bench = new Set(["8,0,0", "8,3,0", "8,0,10", "8,3,10", "12,2,20"]);
  const panel = new ConfigPanel({
    solvers: [{ name: "backtracking", kind: "default", ok: true, module: "/m.mjs" }],
    initial: { n: 8, p: 0, w: 0, seed: 0, solver: "backtracking", onlyShowResult: false, delayMs: 500 },
    hasBenchmark: (n, p, w) => bench.has(`${n},${p},${w}`),
    maxWalls: (n) => maxWallsByFraction(n, 0.25),
    feasibility: () => undefined,
    on,
    ...over,
  });
  document.body.replaceChildren(panel.el);
  const q = (label: string) => [...panel.el.querySelectorAll<HTMLLabelElement>("label.field")].find((l) => l.textContent!.startsWith(label))!.querySelector("input")!;
  const set = (label: string, v: string) => { const i = q(label); i.value = v; i.dispatchEvent(new Event("input")); };
  const btn = (t: string) => [...panel.el.querySelectorAll("button")].find((b) => b.textContent === t)!;
  const msg = () => panel.el.querySelector(".msg")!.textContent!;
  return { panel, on, set, btn, msg, q };
}

describe("ConfigPanel with walls", () => {
  it("has a numeric W field next to N and P; classic (W=0) still places on a benchmarked pair", () => {
    const { btn, on, q } = make();
    expect(q("W").type).toBe("number");
    expect(btn("Place").disabled).toBe(false);
    btn("Place").click();
    expect(on.place).toHaveBeenCalledWith(8, 0, 0, 0);
  });

  it("limits W to floor(N^2 * maxWallFraction) and reports it", () => {
    const { set, btn, msg, q } = make();
    set("W", "17");                                   // 8*8*0.25 = 16
    expect(msg()).toMatch(/W must be an integer from 0 to 16/);
    expect(btn("Place").disabled).toBe(true);
    expect(q("W").max).toBe("16");
    set("W", "16");
    expect(msg()).not.toMatch(/W must be/);
    for (const bad of ["-1", "1.5", ""]) { set("W", bad); expect(msg()).toMatch(/W must be/); }
  });

  it("P is 0..3 while W > 0 and 0..N-1 when W = 0", () => {
    const { set, msg, q } = make();
    set("P", "5");
    expect(msg()).not.toMatch(/P must/);              // classic: 5 <= 7
    set("W", "10");
    expect(msg()).toMatch(/With walls, P must be an integer from 0 to 3/);
    expect(q("P").max).toBe("3");
    set("P", "3");
    expect(msg()).not.toMatch(/P must/);
    set("W", "0");
    expect(q("P").max).toBe("7");
  });

  it("Place needs a walled benchmark; the message names timelimit-walled.csv", () => {
    const { set, btn, msg } = make();
    set("W", "5");                                    // valid, but 8,0,5 is not benchmarked
    expect(btn("Place").disabled).toBe(true);
    expect(msg()).toBe(noBenchmarkMessage(8, 0, 5));
    expect(msg()).toContain("timelimit-walled.csv");
    set("W", "10");
    expect(btn("Place").disabled).toBe(false);
  });

  it("an infeasible instance disables Place with the generator's reason, even if benchmarked", () => {
    const feasibility = vi.fn((_n: number, p: number, w: number) => (w === 10 && p === 3 ? "P=3 exceeds Q-1" : undefined));
    const { set, btn, msg } = make({ feasibility });
    set("W", "10"); set("P", "3");
    expect(btn("Place").disabled).toBe(true);
    expect(msg()).toContain("P=3 exceeds Q-1");
    expect(btn("Place").title).toContain("exceeds");
    set("P", "0");
    expect(btn("Place").disabled).toBe(false);
  });

  it("feasibility is only asked for otherwise valid input", () => {
    const feasibility = vi.fn(() => undefined);
    const { set } = make({ feasibility });
    feasibility.mockClear();
    set("W", "99");
    expect(feasibility).not.toHaveBeenCalled();
  });

  it("Place passes (n, p, w, seed); Resize resets P and W to 0", () => {
    const { set, btn, on, q } = make();
    set("W", "10"); set("P", "3"); set("Seed", "4");
    btn("Place").click();
    expect(on.place).toHaveBeenCalledWith(8, 3, 10, 4);
    set("N", "12");
    btn("Resize").click();
    expect(on.resize).toHaveBeenCalledWith(12);
    expect(q("W").value).toBe("0");
    expect(q("P").value).toBe("0");
  });

  it("N change re-derives the W limit", () => {
    const { set, q } = make();
    set("N", "12");
    expect(q("W").max).toBe("36");
  });
});
