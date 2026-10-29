import { describe, expect, it } from "vitest";
import { Board } from "../Tester/Board/board";
import { decodeEvent, encodeEvent, OP_PUT } from "../Tester/Execution/protocol";
import { buildRenderState } from "../Tester/Visualization/render-state";
import { computeLayout } from "../Tester/Visualization/renderer";

describe("buildRenderState", () => {
  it("memetakan ratu, flag preplaced, dan highlight valid", () => {
    const b = new Board(4);
    b.put(0, 1);
    b.lock(0, 1);
    const ok = b.put(1, 3);
    const s = buildRenderState(
      b,
      decodeEvent(encodeEvent(1, 3, OP_PUT, ok, b.pairs)),
    );
    expect(s.n).toBe(4);
    expect(s.queens).toEqual([
      { row: 0, col: 1, preplaced: true },
      { row: 1, col: 3, preplaced: false },
    ]);
    expect(s.highlight.kind).toBe("valid");
  });

  it("highlight konflik menyertakan ratu penyerang", () => {
    const b = new Board(4);
    b.put(0, 1);
    const ok = b.put(1, 2); // diagonal
    const s = buildRenderState(
      b,
      decodeEvent(encodeEvent(1, 2, OP_PUT, ok, b.pairs)),
    );
    expect(s.highlight.kind).toBe("conflict");
    expect(s.highlight.cells).toHaveLength(2);
  });

  it("tanpa event -> tanpa highlight", () => {
    expect(buildRenderState(new Board(4), null).highlight.kind).toBe("none");
  });
});

describe("computeLayout", () => {
  it("memakai sisi terpendek, fallback ke lebar jika tinggi 0", () => {
    expect(computeLayout(600, 400, 8)).toEqual({ side: 400, cell: 50 });
    expect(computeLayout(300, 0, 4)).toEqual({ side: 300, cell: 75 });
    expect(computeLayout(300, 300, 0).cell).toBe(0);
  });
});
