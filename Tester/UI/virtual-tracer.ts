// Virtualized Step Tracer (design 6.4): fixed row height, only visible rows exist in the DOM.
import type { DecodedEvent } from '../Execution/protocol';
import type { ControllerView } from '../Execution/session-controller';
import { describeEvent } from '../Visualization/format';
import { h } from './dom';

export const ROW_HEIGHT = 18;
/**
 * Browsers cap element height (~33M px Chrome, ~17M Firefox). At the default retention of 4,194,304 events the
 * natural height would be ~75M px, so above this limit the scroll range is scaled: scrollTop maps
 * proportionally onto the row range instead of 1:1.
 */
const MAX_SPACER_PX = 10_000_000;
const EXTRA_ROWS = 2;

export class VirtualTracer {
  readonly el: HTMLElement;
  private readonly scroller: HTMLDivElement;
  private readonly spacer: HTMLDivElement;
  private readonly layer: HTMLDivElement;
  private readonly follow: HTMLInputElement;
  private readonly counter: HTMLSpanElement;
  private readonly empty: HTMLDivElement;
  private readonly rows: HTMLDivElement[] = [];
  private view?: ControllerView;
  private raf = 0;

  /** `getEvent` returns the decoded event at a global index, or null outside the retained window. */
  constructor(private readonly getEvent: (index: number) => DecodedEvent | null) {
    this.follow = h('input', { type: 'checkbox' });
    this.follow.checked = true;
    this.counter = h('span', { class: 'muted' });
    this.layer = h('div', { class: 'tracer-layer' });
    this.spacer = h('div', { class: 'tracer-spacer' }, this.layer);
    this.scroller = h('div', { class: 'tracer-scroller', tabindex: '0', 'aria-label': 'Step tracer' }, this.spacer);
    this.empty = h('div', { class: 'tracer-empty' }, 'No events yet. Press Play or Next to start the solver.');
    this.el = h(
      'section',
      { class: 'tracer' },
      h('header', {}, h('h2', {}, 'Step tracer'), this.counter, h('label', { class: 'inline' }, this.follow, 'Follow')),
      h('div', { class: 'tracer-body' }, this.scroller, this.empty),
    );

    this.scroller.addEventListener('scroll', () => this.schedule());
    // Manual navigation switches Follow off; otherwise the next frame would snap back to the active row.
    const manual = () => { this.follow.checked = false; };
    this.scroller.addEventListener('wheel', manual, { passive: true });
    this.scroller.addEventListener('touchmove', manual, { passive: true });
    this.scroller.addEventListener('pointerdown', manual, { passive: true });
    new ResizeObserver(() => this.schedule()).observe(this.scroller);
  }

  /** Called by the app once per painted frame. */
  update(view: ControllerView): void {
    this.view = view;
    this.render();
  }

  private schedule(): void {
    if (this.raf) return;
    this.raf = requestAnimationFrame(() => {
      this.raf = 0;
      this.render();
    });
  }

  private render(): void {
    const v = this.view;
    if (!v) return;
    const count = v.length - v.firstIndex;
    this.empty.hidden = count > 0;
    this.counter.textContent = count > 0 ? `${v.length.toLocaleString('en-US')} events` : '';

    const viewH = this.scroller.clientHeight;
    if (viewH === 0) return;
    const viewRows = Math.max(1, Math.floor(viewH / ROW_HEIGHT));
    const maxFirst = Math.max(0, count - viewRows);
    const total = count * ROW_HEIGHT;
    const scaled = total > MAX_SPACER_PX;
    const spacerH = Math.max(viewH, scaled ? MAX_SPACER_PX : total);
    const range = Math.max(1, spacerH - viewH);
    this.spacer.style.height = `${spacerH}px`;
    this.layer.style.height = `${viewH}px`;

    const firstAt = (st: number): number =>
      scaled ? Math.round(Math.min(1, st / range) * maxFirst) : Math.min(maxFirst, Math.floor(st / ROW_HEIGHT));
    const scrollAt = (first: number): number =>
      scaled ? (maxFirst === 0 ? 0 : (first / maxFirst) * range) : first * ROW_HEIGHT;

    // Follow: keep the active row (cursor - 1) inside the window, recentering only when it leaves.
    if (this.follow.checked && v.cursor > 0 && v.cursor - 1 >= v.firstIndex) {
      const active = v.cursor - 1 - v.firstIndex;
      const cur = firstAt(this.scroller.scrollTop);
      if (active < cur || active >= cur + viewRows) {
        this.scroller.scrollTop = scrollAt(Math.min(maxFirst, Math.max(0, active - (viewRows >> 1))));
      }
    }

    const st = this.scroller.scrollTop;
    const first = firstAt(st);
    const offset = scaled ? 0 : st - first * ROW_HEIGHT; // sub-row offset keeps scrolling smooth
    const visible = Math.max(0, Math.min(count - first, viewRows + EXTRA_ROWS));
    while (this.rows.length < visible) {
      const row = h('div', { class: 'tracer-row' });
      this.layer.append(row);
      this.rows.push(row);
    }

    const active = v.cursor - 1;
    for (let i = 0; i < this.rows.length; i++) {
      const row = this.rows[i]!;
      if (i >= visible) {
        row.hidden = true;
        continue;
      }
      const idx = v.firstIndex + first + i;
      const ev = this.getEvent(idx);
      row.hidden = false;
      row.style.transform = `translateY(${i * ROW_HEIGHT - offset}px)`;
      row.textContent = ev ? describeEvent(idx, ev) : '';
      row.className = idx === active ? 'tracer-row active' : idx >= v.cursor ? 'tracer-row ahead' : 'tracer-row';
    }
  }
}
