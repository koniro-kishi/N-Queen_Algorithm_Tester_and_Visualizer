// Highlight rules (design 6.3). Pure functions of (display board view, event): Back/Next restore them exactly.
import type { DecodedEvent } from '../Execution/protocol';
import { OP_PUT } from '../Execution/protocol';

export const COLORS = {
  light: '#eaedd1',
  dark: '#769556',
  valid: '#f5c839',
  conflict: '#c67863',
} as const;

export type HighlightKind =
  | 'none'
  | 'valid'              // put, pairs === 0
  | 'conflict'           // put, the new queen is attacked by at least one queen
  | 'conflict-elsewhere' // put, nobody attacks it, but a conflict persists elsewhere (issue I1)
  | 'removed';           // remove: outline the vacated cell

export interface HighlightCell {
  x: number;
  y: number;
  fill: 'valid' | 'conflict' | null;
  outline: boolean;
}

export interface Highlight {
  kind: HighlightKind;
  cells: HighlightCell[];
}

export const NO_HIGHLIGHT: Highlight = { kind: 'none', cells: [] };

/**
 * @param view  display board AFTER the event was applied: N strings of 'Q' / 'x'.
 * @param event the event at cursor - 1, or null when the cursor is at the start.
 */
export function computeHighlight(view: readonly string[], event: DecodedEvent | null): Highlight {
  if (!event) return NO_HIGHLIGHT;
  const { x, y } = event;

  if (event.op !== OP_PUT) {
    return { kind: 'removed', cells: [{ x, y, fill: null, outline: true }] };
  }
  if (view[x]?.[y] !== 'Q') return NO_HIGHLIGHT; // display inconsistent with the event; draw nothing

  if (event.valid) {
    return { kind: 'valid', cells: [{ x, y, fill: 'valid', outline: false }] };
  }

  const attackers: HighlightCell[] = [];
  for (let r = 0; r < view.length; r++) {
    const row = view[r]!;
    for (let c = 0; c < row.length; c++) {
      if (row[c] !== 'Q' || (r === x && c === y)) continue;
      if (r === x || c === y || Math.abs(r - x) === Math.abs(c - y)) {
        attackers.push({ x: r, y: c, fill: 'conflict', outline: false });
      }
    }
  }
  if (attackers.length > 0) {
    return { kind: 'conflict', cells: [{ x, y, fill: 'conflict', outline: false }, ...attackers] };
  }
  return { kind: 'conflict-elsewhere', cells: [{ x, y, fill: 'valid', outline: false }] };
}

/** Step Tracer row text (design 6.4). `index` is the global 0-based event index; rows are numbered from 1. */
export function describeEvent(index: number, e: DecodedEvent): string {
  const n = `#${index + 1}`;
  if (e.op !== OP_PUT) return `${n}  REMOVE (${e.x},${e.y})`;
  return e.valid
    ? `${n}  PUT (${e.x},${e.y})  valid`
    : `${n}  PUT (${e.x},${e.y})  conflict (${e.pairs} ${e.pairs === 1 ? 'pair' : 'pairs'})`;
}
