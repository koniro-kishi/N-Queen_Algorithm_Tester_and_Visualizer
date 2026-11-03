// Config + Controls panel (plan item 7).
import { MAX_N, MIN_N } from '../Board/preplaced';
import type { ControllerView } from '../Execution/session-controller';
import { MAX_DELAY_MS, delayMsToSlider, sliderToDelayMs } from '../Visualization/playback';
import { h } from './dom';

export interface SolverEntry {
  name: string;
  kind: string;
  ok: boolean;
  module?: string;
  error?: string;
}

/** Seeds 0..19 are the canonical benchmark seeds (design 8). */
export const CANONICAL_SEEDS = 20;

export const noBenchmarkMessage = (n: number, p: number): string =>
  `No benchmark for N=${n}, P=${p}. Pick a configuration listed in timelimit.csv.`;

export interface ConfigPanelOptions {
  solvers: SolverEntry[];
  initial: { n: number; p: number; seed: number; solver: string; onlyShowResult: boolean; delayMs: number };
  hasBenchmark(n: number, p: number): boolean;
  on: {
    resize(n: number): void;
    place(n: number, p: number, seed: number): void;
    solver(entry: SolverEntry): void;
    onlyShowResult(on: boolean): void;
    delay(ms: number): void;
    back(): void;
    playPause(): void;
    next(): void;
    stop(): void;
  };
}

const num = (s: string): number => (s.trim() === '' ? NaN : Number(s));
const field = (label: string, input: HTMLElement): HTMLElement => h('label', { class: 'field' }, h('span', {}, label), input);

export class ConfigPanel {
  readonly el: HTMLElement;
  private readonly nIn = h('input', { type: 'number', min: String(MIN_N), max: String(MAX_N), step: '1' });
  private readonly pIn = h('input', { type: 'number', min: '0', step: '1' });
  private readonly seedIn = h('input', { type: 'number', min: '0', step: '1' });
  private readonly solverSel = h('select');
  private readonly onlyChk = h('input', { type: 'checkbox' });
  private readonly resizeBtn = h('button', { type: 'button' }, 'Resize');
  private readonly placeBtn = h('button', { type: 'button' }, 'Place');
  private readonly msg = h('p', { class: 'msg', role: 'status' });
  private readonly buildErr = h('pre', { class: 'build-error' });
  private readonly backBtn = h('button', { type: 'button' }, 'Back');
  private readonly ppBtn = h('button', { type: 'button', class: 'primary' }, 'Play');
  private readonly nextBtn = h('button', { type: 'button' }, 'Next');
  private readonly stopBtn = h('button', { type: 'button' }, 'Stop');
  private readonly slider = h('input', { type: 'range', min: '0', max: String(MAX_DELAY_MS), step: '10' });
  private readonly delayLabel = h('span', { class: 'muted' });

  constructor(private readonly o: ConfigPanelOptions) {
    const i = o.initial;
    this.nIn.value = String(i.n);
    this.pIn.value = String(i.p);
    this.seedIn.value = String(i.seed);
    for (const s of o.solvers) {
      const tag = (s.kind === 'custom' ? ' (custom)' : '') + (s.ok ? '' : ' (build failed)');
      this.solverSel.append(h('option', { value: s.name }, s.name + tag));
    }
    this.solverSel.value = i.solver;
    this.onlyChk.checked = i.onlyShowResult;
    this.slider.value = String(delayMsToSlider(i.delayMs));

    const on = o.on;
    for (const el of [this.nIn, this.pIn, this.seedIn]) el.addEventListener('input', () => this.refresh());
    this.resizeBtn.addEventListener('click', () => {
      const r = this.read();
      if (!r.nOk) return;
      this.pIn.value = '0'; // Resize gives an empty board of the new size
      this.refresh();
      on.resize(r.n);
    });
    this.placeBtn.addEventListener('click', () => {
      const r = this.read();
      if (r.nOk && r.pOk && r.seedOk && !this.placeBtn.disabled) on.place(r.n, r.p, r.seed);
    });
    this.solverSel.addEventListener('change', () => {
      this.showSolverError();
      on.solver(this.selected());
    });
    this.onlyChk.addEventListener('change', () => {
      this.syncSlider();
      on.onlyShowResult(this.onlyChk.checked);
    });
    this.slider.addEventListener('input', () => {
      this.syncSlider();
      on.delay(sliderToDelayMs(Number(this.slider.value)));
    });
    this.backBtn.addEventListener('click', () => on.back());
    this.ppBtn.addEventListener('click', () => on.playPause());
    this.nextBtn.addEventListener('click', () => on.next());
    this.stopBtn.addEventListener('click', () => on.stop());

    this.el = h(
      'section',
      { class: 'config' },
      h('h2', {}, 'Configuration'),
      field('Solver', this.solverSel),
      this.buildErr,
      h('div', { class: 'row3' }, field('N', this.nIn), field('P', this.pIn), field('Seed', this.seedIn)),
      h('div', { class: 'row2' }, this.resizeBtn, this.placeBtn),
      this.msg,
      h('label', { class: 'inline' }, this.onlyChk, 'Only show result'),
      h('h2', {}, 'Controls'),
      h('div', { class: 'row4' }, this.backBtn, this.ppBtn, this.nextBtn, this.stopBtn),
      h('div', { class: 'slider' }, h('span', { class: 'muted' }, 'Step delay'), this.delayLabel),
      this.slider,
      h('div', { class: 'slider-ends muted' }, h('span', {}, `Slow ${MAX_DELAY_MS} ms`), h('span', {}, 'Fast 0 ms')),
    );
    this.refresh();
    this.showSolverError();
    this.syncSlider();
  }

  selected(): SolverEntry {
    return this.o.solvers.find((s) => s.name === this.solverSel.value)!;
  }

  /** Enables or disables Back / Play-Pause / Next / Stop from the controller view. */
  setControls(v: ControllerView, canRun: boolean): void {
    const c = v.controls;
    const idle = v.state === 'Idle';
    this.backBtn.disabled = !c.back;
    this.nextBtn.disabled = !c.next || (idle && !canRun);
    this.stopBtn.disabled = !c.stop;
    this.ppBtn.textContent = c.playPause === 'pause' ? 'Pause' : 'Play';
    this.ppBtn.disabled = c.playPause === 'off' || (idle && !canRun);
  }

  private read() {
    const n = num(this.nIn.value);
    const p = num(this.pIn.value);
    const seed = num(this.seedIn.value);
    const nOk = Number.isInteger(n) && n >= MIN_N && n <= MAX_N;
    const pOk = nOk && Number.isInteger(p) && p >= 0 && p <= n - 1;
    const seedOk = Number.isInteger(seed) && seed >= 0;
    return { n, p, seed, nOk, pOk, seedOk };
  }

  private refresh(): void {
    const r = this.read();
    if (r.nOk) this.pIn.max = String(r.n - 1);
    const notes: string[] = [];
    if (!r.nOk) notes.push(`N must be an integer from ${MIN_N} to ${MAX_N}.`);
    else if (!r.pOk) notes.push(`P must be an integer from 0 to ${r.n - 1}.`);
    if (!r.seedOk) notes.push('Seed must be a non-negative integer.');
    else if (r.seed >= CANONICAL_SEEDS)
      notes.push(`Seed ${r.seed} is outside the benchmark seeds 0 to ${CANONICAL_SEEDS - 1}; the time limit may not apply.`);

    const valid = r.nOk && r.pOk && r.seedOk;
    const bench = valid && this.o.hasBenchmark(r.n, r.p);
    if (valid && !bench) notes.push(noBenchmarkMessage(r.n, r.p));
    this.msg.textContent = notes.join(' ');
    this.resizeBtn.disabled = !r.nOk;
    this.placeBtn.disabled = !bench;
    this.placeBtn.title = valid && !bench ? noBenchmarkMessage(r.n, r.p) : '';
  }

  private showSolverError(): void {
    const s = this.selected();
    this.buildErr.hidden = s.ok;
    this.buildErr.textContent = s.ok ? '' : `Build failed:\n${s.error ?? 'unknown error'}`;
  }

  private syncSlider(): void {
    this.slider.disabled = this.onlyChk.checked; // no playback in Only show result
    this.delayLabel.textContent = `${sliderToDelayMs(Number(this.slider.value))} ms per step`;
  }
}
