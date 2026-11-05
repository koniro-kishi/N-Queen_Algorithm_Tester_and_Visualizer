import { describe, expect, it } from "vitest";
import { DEFAULT_MAX_WALL_FRACTION, validateConfig } from "../Tester/Configuration/config";
import {
  effectiveWalledTimeout,
  parseWalledTimelimitCsv,
  walledWallsFor,
} from "../Tester/Configuration/timelimit";
import { maxWallsByFraction, maxWallsForN, WALLED_MAX_P } from "../Tester/Board/walled";

const base = {
  toleranceFactor: 3, minTimeoutSeconds: 0.25, lookaheadEvents: 4096, maxRetainedEvents: 1,
  defaultStepDelayMs: 0, solverMaxMemoryMB: 512, benchCapSeconds: 10, cutoffSeconds: 60,
};

describe("maxWallFraction", () => {
  it("is optional (default) and validated when present", () => {
    expect(validateConfig(base).maxWallFraction).toBe(DEFAULT_MAX_WALL_FRACTION);
    expect(validateConfig({ ...base, maxWallFraction: 0.4 }).maxWallFraction).toBe(0.4);
    for (const v of [0, -1, 1.5]) expect(() => validateConfig({ ...base, maxWallFraction: v })).toThrow(/maxWallFraction/);
    expect(() => validateConfig({ ...base, maxWallFraction: "x" })).toThrow(/finite number/);
  });
  it("maxWallsByFraction floors and never exceeds the hard limit", () => {
    expect(maxWallsByFraction(8, 0.25)).toBe(16);
    expect(maxWallsByFraction(5, 0.25)).toBe(6);
    expect(maxWallsByFraction(4, 1)).toBe(maxWallsForN(4));
  });
});

describe("timelimit-walled.csv", () => {
  const cfg = validateConfig(base);
  it("parses an empty file (header only) and valid rows", () => {
    expect(parseWalledTimelimitCsv("N,P,W,limit\n").size).toBe(0);
    const t = parseWalledTimelimitCsv("N,P,W,limit\n8,0,4,0.01\n12,3,20,2\n");
    expect(effectiveWalledTimeout(t, 8, 0, 4, cfg)).toBe(0.25); // floor
    expect(effectiveWalledTimeout(t, 12, 3, 20, cfg)).toBe(6);
    expect(effectiveWalledTimeout(t, 12, 3, 21, cfg)).toBeUndefined();
    expect(effectiveWalledTimeout(t, 8, 1, 4, cfg)).toBeUndefined();
  });
  it("rejects bad input", () => {
    expect(() => parseWalledTimelimitCsv("N,P,limit\n")).toThrow(/header/);
    expect(() => parseWalledTimelimitCsv("N,P,W,limit\n3,0,1,1\n")).toThrow(/N out of range/);
    expect(() => parseWalledTimelimitCsv(`N,P,W,limit\n8,${WALLED_MAX_P + 1},4,1\n`)).toThrow(/P out of range/);
    expect(() => parseWalledTimelimitCsv("N,P,W,limit\n8,0,0,1\n")).toThrow(/W out of range/);
    expect(() => parseWalledTimelimitCsv("N,P,W,limit\n8,0,56,1\n")).toThrow(/W out of range/);
    expect(() => parseWalledTimelimitCsv("N,P,W,limit\n8,0,4,0\n")).toThrow(/limit/);
    expect(() => parseWalledTimelimitCsv("N,P,W,limit\n8,0,4\n")).toThrow(/4 fields/);
    expect(() => parseWalledTimelimitCsv("N,P,W,limit\n8,0,4,1\n8,0,4,2\n")).toThrow(/duplicate/);
  });
});

describe("walledWallsFor", () => {
  const t = parseWalledTimelimitCsv(
    "N,P,W,limit\n8,0,16,1\n8,0,3,1\n8,0,10,1\n8,1,6,1\n12,2,20,1\n",
  );

  it("returns only the walls benchmarked for exactly (n, p), sorted, without classic 0", () => {
    expect(walledWallsFor(t, 8, 0)).toEqual([3, 10, 16]);
    expect(walledWallsFor(t, 8, 1)).toEqual([6]);
    expect(walledWallsFor(t, 12, 2)).toEqual([20]);
  });

  it("returns an empty list for an unbenchmarked pair or P beyond the walled range", () => {
    expect(walledWallsFor(t, 8, 2)).toEqual([]);
    expect(walledWallsFor(t, 9, 0)).toEqual([]);
    expect(walledWallsFor(t, 8, WALLED_MAX_P + 1)).toEqual([]);
  });
});
