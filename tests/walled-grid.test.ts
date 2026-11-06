import { describe, expect, it } from "vitest";
import {
  WALL_FRACTIONS,
  walledGridForN,
} from "../driver/bench/walled-grid";
import { maxWallsByFraction } from "../Tester/Board/walled";

describe("walledGridForN", () => {
  it("is sorted, unique and never below 1 or above the UI limit", () => {
    for (let n = 4; n <= 20; n++) {
      const cap = maxWallsByFraction(n, 0.25);
      const grid = walledGridForN(n, 0.25);
      expect(grid.length).toBeGreaterThan(0);
      expect(grid).toEqual([...grid].sort((a, b) => a - b));
      expect(new Set(grid).size).toBe(grid.length);
      for (const w of grid) {
        expect(w).toBeGreaterThanOrEqual(1);
        expect(w).toBeLessThanOrEqual(cap);
      }
    }
  });

  it("matches the sampling for the small and the largest board", () => {
    expect(walledGridForN(4, 0.25)).toEqual([1, 2, 3, 4]);
    expect(walledGridForN(20, 0.25)).toEqual([20, 40, 60, 80, 100]);
  });

  it("never exceeds floor(N^2 * maxWallFraction)", () => {
    for (const f of [0.1, 0.25, 0.5]) {
      for (const n of [5, 8, 12, 20]) {
        for (const w of walledGridForN(n, f)) {
          expect(w).toBeLessThanOrEqual(Math.floor(n * n * f));
        }
      }
    }
  });

  it("a smaller maxWallFraction shrinks or keeps the grid", () => {
    const wide = walledGridForN(12, 0.25);
    const narrow = walledGridForN(12, 0.1);
    for (const w of narrow) expect(wide).toContain(w);
    expect(Math.max(...narrow)).toBeLessThanOrEqual(Math.max(...wide));
  });

  it("returns an empty grid when even the smallest W does not fit", () => {
    expect(walledGridForN(4, 0.01)).toEqual([]);
  });

  it("samples every fraction that stays inside the cap", () => {
    // N = 20, f = 0.25 -> cap 100; each rounded fraction is distinct and inside the cap.
    expect(walledGridForN(20, 0.25)).toHaveLength(WALL_FRACTIONS.length);
  });
});
