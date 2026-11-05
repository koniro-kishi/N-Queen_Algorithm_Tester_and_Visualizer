// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { ConfigPanel, noBenchmarkMessage, type ConfigPanelOptions } from "../Tester/UI/panels";

function make(over: Partial<ConfigPanelOptions> = {}) {
  const on = {
    resize: vi.fn(), place: vi.fn(), solver: vi.fn(), onlyShowResult: vi.fn(), delay: vi.fn(),
    back: vi.fn(), playPause: vi.fn(), next: vi.fn(), stop: vi.fn(),
  };
  const bench = new Set([
    "8,0,0", "8,3,0",
    "8,0,3", "8,0,10", "8,0,16",
    "8,3,3", "8,3,10", "8,3,16",
    "12,2,20",
  ]);
  const walls = new Map<string, number[]>([
    ["8,0", [3, 10, 16]],
    ["8,3", [3, 10, 16]],
    ["12,2", [20]],
  ]);
  const panel = new ConfigPanel({
    solvers: [{ name: "backtracking", kind: "default", ok: true, module: "/m.mjs" }],
    initial: { n: 8, p: 0, w: 0, seed: 0, solver: "backtracking", onlyShowResult: false, delayMs: 500 },
    hasBenchmark: (n, p, w) => bench.has(`${n},${p},${w}`),
    availableWalls: (n, p) => walls.get(`${n},${p}`) ?? [],
    feasibility: () => undefined,
    on,
    ...over,
  });
  document.body.replaceChildren(panel.el);
  const q = (label: string) =>
    [...panel.el.querySelectorAll<HTMLLabelElement>("label.field")]
      .find((l) => l.textContent!.startsWith(label))!
      .querySelector<HTMLInputElement | HTMLSelectElement>("input, select")!;
  const set = (label: string, v: string) => {
    const i = q(label) as HTMLInputElement;
    i.value = v;
    i.dispatchEvent(new Event("input"));
  };
  const choose = (label: string, v: string) => {
    const s = q(label) as HTMLSelectElement;
    s.value = v;
    s.dispatchEvent(new Event("change"));
  };
  const wallOptions = () => [...(q("W") as HTMLSelectElement).options].map((o) => o.value);
  const wallText = () => [...(q("W") as HTMLSelectElement).options].map((o) => o.textContent);
  const btn = (t: string) => [...panel.el.querySelectorAll("button")].find((b) => b.textContent === t)!;
  const msg = () => panel.el.querySelector(".msg")!.textContent!;
  return { panel, on, set, choose, wallOptions, wallText, btn, msg, q };
}

describe("ConfigPanel with walls", () => {
  it("W is a dropdown listing classic plus the walls benchmarked for the current N and P", () => {
    const { btn, on, wallOptions, wallText, q } = make();
    expect(q("W").tagName).toBe("SELECT");
    expect(wallOptions()).toEqual(["0", "3", "10", "16"]);
    expect(wallText()[0]).toBe("0 (classic)");
    expect(btn("Place").disabled).toBe(false);
    btn("Place").click();
    expect(on.place).toHaveBeenCalledWith(8, 0, 0, 0);
  });

  it("changing N or P rebuilds the list and falls back to classic when the old W is unavailable", () => {
    const { set, choose, wallOptions, q } = make();
    choose("W", "10");
    expect((q("W") as HTMLSelectElement).value).toBe("10");

    set("P", "1"); // no benchmarked walls for (8, 1)
    expect(wallOptions()).toEqual(["0"]);
    expect((q("W") as HTMLSelectElement).value).toBe("0");

    set("N", "12");
    set("P", "2");
    expect(wallOptions()).toEqual(["0", "20"]);

    set("N", "8");
    set("P", "0");
    choose("W", "16");
    set("P", "4"); // walls need P <= 3, so only classic remains
    expect(wallOptions()).toEqual(["0"]);
    expect((q("W") as HTMLSelectElement).value).toBe("0");
  });

  it("P is 0..3 while a wall is selected and 0..N-1 in classic", () => {
    const { set, choose, msg, q } = make();
    expect((q("P") as HTMLInputElement).max).toBe("7");
    choose("W", "10");
    expect((q("P") as HTMLInputElement).max).toBe("3");
    set("P", "3");
    expect(msg()).not.toMatch(/P must/);

    set("P", "5"); // drops the wall selection rather than reporting an error
    expect((q("W") as HTMLSelectElement).value).toBe("0");
    expect((q("P") as HTMLInputElement).max).toBe("7");
    expect(msg()).not.toMatch(/P must/);
  });

  it("Place is disabled when the selected configuration has no benchmark", () => {
    const { set, btn, msg } = make();
    set("N", "9"); // no walled rows and no classic row for N=9
    expect(btn("Place").disabled).toBe(true);
    expect(msg()).toBe(noBenchmarkMessage(9, 0, 0));
    expect(msg()).toContain("timelimit.csv");
  });

  it("an infeasible instance disables Place with the generator's reason, even if benchmarked", () => {
    const feasibility = vi.fn((_n: number, p: number, w: number) => (w === 10 && p === 3 ? "P=3 exceeds Q-1" : undefined));
    const { set, choose, btn, msg } = make({ feasibility });
    choose("W", "10");
    set("P", "3");
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
    set("N", "99");
    expect(feasibility).not.toHaveBeenCalled();
  });

  it("Place passes (n, p, w, seed); Resize resets P and W to 0", () => {
    const { set, choose, btn, on, q } = make();
    choose("W", "10");
    set("P", "3");
    set("Seed", "4");
    btn("Place").click();
    expect(on.place).toHaveBeenCalledWith(8, 3, 10, 4);

    set("N", "12");
    btn("Resize").click();
    expect(on.resize).toHaveBeenCalledWith(12);
    expect((q("W") as HTMLSelectElement).value).toBe("0");
    expect(q("P").value).toBe("0");
  });

  it("N change re-derives the wall list", () => {
    const { set, wallOptions } = make();
    set("N", "12");
    set("P", "2");
    expect(wallOptions()).toEqual(["0", "20"]);
  });
});
