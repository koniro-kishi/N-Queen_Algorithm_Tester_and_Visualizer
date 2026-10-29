import { describe, expect, it } from 'vitest';
import { Board } from '../Tester/Board/board';
import { decodeEvent, encodeEvent, OP_PUT, OP_REMOVE } from '../Tester/Execution/protocol';
import { computeHighlight, describeEvent, NO_HIGHLIGHT } from '../Tester/Visualization/highlight';

/** Applies a put on a real Board and returns the (view, event) pair the controller would hand over. */
function put(b: Board, x: number, y: number) {
  b.put(x, y);
  return { view: b.view(), e: decodeEvent(encodeEvent(x, y, OP_PUT, b.pairs === 0, b.pairs)) };
}

describe('computeHighlight', () => {
  it('no event -> nothing', () => {
    expect(computeHighlight(['xxxx', 'xxxx', 'xxxx', 'xxxx'], null)).toBe(NO_HIGHLIGHT);
  });

  it('rule 1: pairs === 0 highlights only the new queen as valid', () => {
    const b = new Board(4);
    const { view, e } = put(b, 0, 1);
    expect(computeHighlight(view, e)).toEqual({ kind: 'valid', cells: [{ x: 0, y: 1, fill: 'valid', outline: false }] });
  });

  it('rule 2: the new queen and every attacker are conflict-coloured', () => {
    const b = new Board(4);
    b.put(0, 0); b.put(0, 3);
    const { view, e } = put(b, 0, 1); // row-attacked by both
    const h = computeHighlight(view, e);
    expect(h.kind).toBe('conflict');
    expect(h.cells[0]).toEqual({ x: 0, y: 1, fill: 'conflict', outline: false });
    expect(h.cells.slice(1).map((c) => [c.x, c.y]).sort()).toEqual([[0, 0], [0, 3]]);
    expect(h.cells.every((c) => c.fill === 'conflict')).toBe(true);
  });

  it('rule 2 covers column and diagonal attackers', () => {
    const b = new Board(5);
    b.put(0, 0); b.put(4, 1); b.put(1, 4);
    const { view, e } = put(b, 2, 2); // diagonal with (0,0); not with the others
    const h = computeHighlight(view, e);
    expect(h.kind).toBe('conflict');
    expect(h.cells.map((c) => [c.x, c.y])).toEqual([[2, 2], [0, 0]]);
  });

  it('rule 3 (I1): non-attacked queen while a conflict persists elsewhere stays yellow, valid=false', () => {
    const b = new Board(4);
    b.put(0, 0); b.put(1, 1);              // existing unresolved conflict
    const { view, e } = put(b, 3, 2);      // attacked by nobody
    expect(e.valid).toBe(false);
    expect(computeHighlight(view, e)).toEqual({ kind: 'conflict-elsewhere', cells: [{ x: 3, y: 2, fill: 'valid', outline: false }] });
  });

  it('remove: outline the vacated cell, no fill', () => {
    const e = decodeEvent(encodeEvent(2, 3, OP_REMOVE, true, 0));
    expect(computeHighlight(['xxxx', 'xxxx', 'xxxx', 'xxxx'], e)).toEqual({ kind: 'removed', cells: [{ x: 2, y: 3, fill: null, outline: true }] });
  });

  it('is pure: same input, same output, input untouched', () => {
    const b = new Board(4);
    b.put(0, 0);
    const { view, e } = put(b, 1, 1);
    const copy = [...view];
    expect(computeHighlight(view, e)).toEqual(computeHighlight(view, e));
    expect(view).toEqual(copy);
  });

  it('draws nothing when the display disagrees with the event', () => {
    const e = decodeEvent(encodeEvent(0, 0, OP_PUT, true, 0));
    expect(computeHighlight(['xxxx', 'xxxx', 'xxxx', 'xxxx'], e)).toBe(NO_HIGHLIGHT);
  });
});

describe('describeEvent', () => {
  it('formats tracer rows like the design', () => {
    expect(describeEvent(1233, decodeEvent(encodeEvent(3, 5, OP_PUT, true, 0)))).toBe('#1234  PUT (3,5)  valid');
    expect(describeEvent(0, decodeEvent(encodeEvent(3, 5, OP_PUT, false, 2)))).toBe('#1  PUT (3,5)  conflict (2 pairs)');
    expect(describeEvent(0, decodeEvent(encodeEvent(3, 5, OP_PUT, false, 1)))).toBe('#1  PUT (3,5)  conflict (1 pair)');
    expect(describeEvent(9, decodeEvent(encodeEvent(3, 5, OP_REMOVE, true, 0)))).toBe('#10  REMOVE (3,5)');
  });
});
