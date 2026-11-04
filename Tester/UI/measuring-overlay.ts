// Grey overlay with a throbber, shown while the unrecorded measuring pass runs.
import { h } from "./dom";

export class MeasuringOverlay {
  readonly el: HTMLElement;

  constructor() {
    this.el = h(
      "div",
      { class: "overlay measuring", role: "status", "aria-live": "polite" },
      h(
        "div",
        { class: "overlay-box" },
        h("div", { class: "throbber", "aria-hidden": "true" }),
        h("p", {}, "Mengukur compute time..."),
      ),
    );
    this.el.hidden = true;
  }

  update(measuring: boolean): void {
    this.el.hidden = !measuring;
  }
}
