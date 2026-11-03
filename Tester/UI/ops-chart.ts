// Horizontal bar chart of board operations up to the current step.
import type { OpCounts } from "../Execution/session-controller";
import { h } from "./dom";

const ROWS = [
  { key: "put", label: "putQueen", cls: "put" },
  { key: "remove", label: "removeQueen", cls: "remove" },
  { key: "check", label: "checkQueen", cls: "check" },
] as const;

export class OpsChart {
  readonly el: HTMLElement;
  private readonly fills = new Map<string, HTMLElement>();
  private readonly nums = new Map<string, HTMLElement>();

  constructor() {
    const rows = ROWS.map((r) => {
      const fill = h("div", { class: `ops-fill ${r.cls}` });
      const num = h("span", { class: "ops-num" }, "0");
      this.fills.set(r.key, fill);
      this.nums.set(r.key, num);
      return h(
        "div",
        { class: "ops-row" },
        h("span", { class: "ops-label" }, r.label),
        h("div", { class: "ops-track" }, fill),
        num,
      );
    });
    this.el = h(
      "section",
      { class: "ops", "aria-label": "Board operations up to the current step" },
      h("h2", {}, "Board operations"),
      ...rows,
    );
  }

  update(c: OpCounts): void {
    const max = Math.max(1, c.put, c.remove, c.check);
    for (const r of ROWS) {
      const v = c[r.key];
      this.fills.get(r.key)!.style.width = `${(v / max) * 100}%`;
      this.nums.get(r.key)!.textContent = v.toLocaleString("en-US");
    }
  }
}
