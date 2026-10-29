import { describe, expect, it } from "vitest";
import {
  effectiveTimeout,
  formatTimeout,
  parseTimelimitCsv,
} from "../Tester/Configuration/timelimit";
import { validateConfig } from "../Tester/Configuration/config";

const cfg = validateConfig({
  toleranceFactor: 3,
  minTimeoutSeconds: 0.25,
  lookaheadEvents: 4096,
  maxRetainedEvents: 1,
  defaultStepDelayMs: 0,
  solverMaxMemoryMB: 512,
  benchCapSeconds: 10,
});

describe("timelimit.csv", () => {
  it("parses valid rows and applies tolerance/floor", () => {
    const t = parseTimelimitCsv("N,P,limit\n8,0,0.01\n12,3,2\n");
    expect(effectiveTimeout(t, 8, 0, cfg)).toBe(0.25); // floor
    expect(effectiveTimeout(t, 12, 3, cfg)).toBe(6); // 2 * 3
    expect(effectiveTimeout(t, 20, 0, cfg)).toBeUndefined(); // no benchmark
  });
  it("rejects bad input", () => {
    expect(() => parseTimelimitCsv("N,P\n")).toThrow(/header/);
    expect(() => parseTimelimitCsv("N,P,limit\n3,0,1\n")).toThrow(
      /N out of range/,
    );
    expect(() => parseTimelimitCsv("N,P,limit\n8,8,1\n")).toThrow(
      /P out of range/,
    );
    expect(() => parseTimelimitCsv("N,P,limit\n8,0,0\n")).toThrow(/limit/);
    expect(() => parseTimelimitCsv("N,P,limit\n8,0,1\n8,0,2\n")).toThrow(
      /duplicate/,
    );
  });
  it("formats timeouts", () => {
    expect(formatTimeout(6)).toBe("6");
    expect(formatTimeout(0.25)).toBe("0.25");
    expect(formatTimeout(1.23456)).toBe("1.235");
  });
});
