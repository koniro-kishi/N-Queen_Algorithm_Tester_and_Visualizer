import { describe, expect, it } from "vitest";
import {
  createControlBlock,
  decodeEvent,
  encodeEvent,
  OP_PUT,
  OP_REMOVE,
  OP_CHECK,
} from "../Tester/Execution/protocol";

describe("event encoding", () => {
  it("round-trips the full range", () => {
    for (const [x, y, op, valid, pairs] of [
      [0, 0, OP_PUT, true, 0],
      [19, 19, OP_REMOVE, false, 190],
      [7, 12, OP_PUT, false, 3],
      [31, 31, OP_REMOVE, true, 255],
      [3, 4, OP_CHECK, true, 2],
    ] as const) {
      expect(decodeEvent(encodeEvent(x, y, op, valid, pairs))).toEqual({
        x,
        y,
        op,
        valid,
        pairs,
      });
    }
  });
  it("always yields an unsigned 32-bit value", () => {
    expect(encodeEvent(19, 19, OP_REMOVE, true, 255)).toBeGreaterThanOrEqual(0);
  });
  it("saturates pairs at 255 instead of corrupting the op bits", () => {
    for (const pairs of [256, 300, 1000, 100_000]) {
      expect(decodeEvent(encodeEvent(3, 4, OP_PUT, false, pairs))).toEqual({
        x: 3, y: 4, op: OP_PUT, valid: false, pairs: 255,
      });
    }
  });
});

describe("control block", () => {
  it("has aligned views", () => {
    const c = createControlBlock();
    expect(c.f64.byteOffset % 8).toBe(0);
    expect(c.i32.length).toBe(8);
    expect(c.f64.length).toBe(2);
  });
});
