// Highlight rules (design 6.3). Pure functions of (display board view, event): Back/Next restore them exactly.
// Walled N-Queen: a 'W' cell strictly between two queens on one line cuts the attack, so that queen is not an attacker.
import type { DecodedEvent } from "../Execution/protocol";
import { OP_PUT, OP_CHECK } from "../Execution/protocol";

export const COLORS = {
  light: "#eaedd1",
  dark: "#769556",
  valid: "#f5c839",
  conflict: "#c67863",
} as const;

export type HighlightKind =
  | "none"
  | "checked"
  | "valid" // put, pairs === 0
  | "conflict" // put, the new queen is attacked by at least one queen
  | "conflict-elsewhere" // put, nobody attacks it, but a conflict persists elsewhere (issue I1)
  | "removed"; // remove: outline the vacated cell

export interface HighlightCell {
  x: number;
  y: number;
  fill: "valid" | "conflict" | null;
  outline: boolean;
}

export interface Highlight {
  kind: HighlightKind;
  cells: HighlightCell[];
}

export const NO_HIGHLIGHT: Highlight = { kind: "none", cells: [] };

/** True when a wall lies strictly between (r1,c1) and (r2,c2), which must share a row, column or diagonal. */
function wallBetween(
  view: readonly string[],
  r1: number,
  c1: number,
  r2: number,
  c2: number,
): boolean {
  const dr = Math.sign(r2 - r1);
  const dc = Math.sign(c2 - c1);
  for (let r = r1 + dr, c = c1 + dc; r !== r2 || c !== c2; r += dr, c += dc) {
    if (view[r]?.[c] === "W") return true;
  }
  return false;
}

/**
 * @param view  display board AFTER the event was applied: N strings of 'Q' / 'x' / 'W'.
 * @param event the event at cursor - 1, or null when the cursor is at the start.
 */
export function computeHighlight(
  view: readonly string[],
  event: DecodedEvent | null,
): Highlight {
  if (!event) return NO_HIGHLIGHT;
  const { x, y } = event;

  if (event.op === OP_CHECK)
    return { kind: "checked", cells: [{ x, y, fill: null, outline: true }] };

  if (event.op !== OP_PUT) {
    return { kind: "removed", cells: [{ x, y, fill: null, outline: true }] };
  }
  if (view[x]?.[y] !== "Q") return NO_HIGHLIGHT; // display inconsistent with the event; draw nothing

  if (event.valid) {
    return { kind: "valid", cells: [{ x, y, fill: "valid", outline: false }] };
  }

  const attackers: HighlightCell[] = [];
  for (let r = 0; r < view.length; r++) {
    const row = view[r]!;
    for (let c = 0; c < row.length; c++) {
      if (row[c] !== "Q" || (r === x && c === y)) continue;
      if (
        (r === x || c === y || Math.abs(r - x) === Math.abs(c - y)) &&
        !wallBetween(view, x, y, r, c)
      ) {
        attackers.push({ x: r, y: c, fill: "conflict", outline: false });
      }
    }
  }
  if (attackers.length > 0) {
    return {
      kind: "conflict",
      cells: [{ x, y, fill: "conflict", outline: false }, ...attackers],
    };
  }
  return {
    kind: "conflict-elsewhere",
    cells: [{ x, y, fill: "valid", outline: false }],
  };
}

export function describeEvent(index: number, e: DecodedEvent): string {
  const n = `#${index + 1}`;
  if (e.op === OP_CHECK)
    return `${n}  CHECK (${e.x},${e.y})  ${e.valid ? "safe" : "attacked"}`;
  if (e.op !== OP_PUT) return `${n}  REMOVE (${e.x},${e.y})`;
  return e.valid
    ? `${n}  PUT (${e.x},${e.y})  valid`
    : `${n}  PUT (${e.x},${e.y})  conflict (${e.pairs} ${e.pairs === 1 ? "pair" : "pairs"})`;
}
