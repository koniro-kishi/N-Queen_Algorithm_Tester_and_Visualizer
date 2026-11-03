// Result overlay + status line (plan item 9; design 6.5 and issue I6).
import { formatDuration, formatTimeout } from "../Configuration/timelimit";
import type { Rule } from "../Board/validator";
import type { ErrorKind } from "../Execution/protocol";
import type { SessionResult } from "../Execution/session";
import type { ControllerView } from "../Execution/session-controller";
import { h } from "./dom";

const RULE_LABEL: Record<Rule, string> = {
  size: "board size",
  "queen-count": "queen count",
  row: "two queens share a row",
  column: "two queens share a column",
  diagonal: "two queens share a diagonal",
  preplaced: "a preplaced queen was moved or removed",
};

const KIND_LABEL: Record<ErrorKind, string> = {
  operation: "invalid board operation",
  exit: "solver called exit()",
  trap: "runtime failure (trap, out of memory or stack overflow)",
  load: "module failed to load",
  "solver-nonzero": "solve() returned a non-zero value",
};

type Shown = Exclude<SessionResult, { status: "Cancelled" }>;
type Tone = "ok" | "warn" | "bad";

function describeResult(r: Shown): { tone: Tone; details: string[] } {
  const ops = (n: number) => `${n.toLocaleString("en-US")} board operations`;
  switch (r.status) {
    case "Successful":
      return {
        tone: "ok",
        details: [
          `Compute time: ${formatDuration(r.computeMs)}`,
          ops(r.eventCount),
        ],
      };
    case "Overtime":
      return {
        tone: "warn",
        details: [
          `Compute time: ${formatDuration(r.computeMs)}`,
          `Over the benchmark limit (${formatTimeout(r.timeoutSeconds)} s), still under the cutoff`,
          ops(r.eventCount),
        ],
      };
    case "Failed":
      return {
        tone: "bad",
        details: [
          `Exceeded the cutoff (${formatDuration(r.cutoffSeconds * 1000)})`,
        ],
      };
    case "Invalid Solution":
      return {
        tone: "bad",
        details: [`Rule broken: ${RULE_LABEL[r.rule]}`, r.message],
      };
    case "Execution Error":
      return {
        tone: "bad",
        details: [`Error: ${KIND_LABEL[r.kind]}`, r.message],
      };
  }
}

export class ResultOverlay {
  readonly el: HTMLElement;
  /** Called when the overlay is dismissed or reopened, so the status line can update. */
  onVisibilityChange?: () => void;
  private readonly box: HTMLElement;
  private readonly closeBtn: HTMLButtonElement;
  private current: SessionResult | null = null;
  private dismissed = false;

  constructor() {
    this.closeBtn = h(
      "button",
      { type: "button", class: "close", "aria-label": "Close result" },
      "Close",
    );
    this.box = h("div", { class: "overlay-box" });
    this.el = h(
      "div",
      { class: "overlay", role: "dialog", "aria-label": "Run result" },
      this.box,
    );
    this.el.hidden = true;
    this.closeBtn.addEventListener("click", () => this.dismiss());
    this.el.addEventListener("click", (e) => {
      if (e.target === this.el) this.dismiss();
    });
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && !this.el.hidden) this.dismiss();
    });
  }

  get isDismissed(): boolean {
    return this.dismissed;
  }

  /** Idempotent: the same result object (reference) changes nothing, so a dismissed overlay stays closed. */
  update(result: SessionResult | null): void {
    if (result === this.current) return;
    this.current = result;
    this.dismissed = false;
    if (!result || result.status === "Cancelled") {
      this.el.hidden = true;
      return;
    }
    const d = describeResult(result);
    this.el.className = `overlay ${d.tone}`;
    this.box.className = "overlay-box";
    this.box.replaceChildren(
      h("h2", {}, result.status),
      ...d.details.map((t) => h("p", {}, t)),
      this.closeBtn,
    );
    this.el.hidden = false;
    this.closeBtn.focus();
  }

  dismiss(): void {
    if (!this.current || this.el.hidden) return;
    this.dismissed = true;
    this.el.hidden = true;
    this.onVisibilityChange?.();
  }

  reopen(): void {
    if (!this.current || !this.dismissed) return;
    this.dismissed = false;
    this.el.hidden = false;
    this.closeBtn.focus();
    this.onVisibilityChange?.();
  }
}

export interface StatusExtras {
  /** Instance summary, e.g. "N=8, P=3, seed 1, timeout 6 s". */
  instance: string;
  /** Why the run is blocked (no benchmark, build failed). */
  notice?: string;
}

export class StatusLine {
  readonly el: HTMLElement;
  private readonly state = h("strong", {});
  private readonly pos = h("span", { class: "muted" });
  private readonly instance = h("span", { class: "muted" });
  private readonly truncated = h("p", { class: "note" });
  private readonly notice = h("p", { class: "note warn" });
  private readonly reopenBtn = h(
    "button",
    { type: "button", class: "link" },
    "Show result",
  );

  constructor(onReopen: () => void) {
    this.reopenBtn.addEventListener("click", onReopen);
    this.el = h(
      "div",
      { class: "status", "aria-live": "polite" },
      h("div", { class: "status-main" }, this.state, this.pos, this.reopenBtn),
      this.instance,
      this.truncated,
      this.notice,
    );
  }

  update(v: ControllerView, x: StatusExtras & { canReopen: boolean }): void {
    this.state.textContent = v.status;
    this.pos.textContent =
      v.length > 0
        ? `Event ${v.cursor.toLocaleString("en-US")} of ${v.length.toLocaleString("en-US")}`
        : "";
    this.instance.textContent = x.instance;
    this.reopenBtn.hidden = !x.canReopen;
    this.truncated.hidden = !v.truncated;
    this.truncated.textContent = v.truncated
      ? `History truncated: the oldest ${v.firstIndex.toLocaleString("en-US")} events were dropped, so Back stops at event ${v.firstIndex.toLocaleString("en-US")}.`
      : "";
    this.notice.hidden = !x.notice;
    this.notice.textContent = x.notice ?? "";
  }
}
