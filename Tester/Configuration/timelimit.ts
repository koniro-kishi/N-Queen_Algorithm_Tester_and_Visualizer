import { MAX_N, MIN_N } from "../Board/preplaced";
import { maxWallsForN, WALLED_MAX_P } from "../Board/walled";
import type { TesterConfig } from "./config";

export type TimeLimits = Map<string, number>; // key "N,P" -> seconds

export function parseTimelimitCsv(text: string): TimeLimits {
  const lines = text.replace(/^\uFEFF/, "").split(/\r?\n/);
  while (lines.length && lines[lines.length - 1]!.trim() === "") lines.pop();
  if (lines[0]?.trim() !== "N,P,limit")
    throw new Error('timelimit.csv: header must be exactly "N,P,limit"');
  const out: TimeLimits = new Map();
  lines.slice(1).forEach((line, idx) => {
    const ln = idx + 2;
    const f = line.split(",").map((s) => s.trim());
    if (f.length !== 3)
      throw new Error(`timelimit.csv line ${ln}: expected 3 fields`);
    const [n, p, limit] = [Number(f[0]), Number(f[1]), Number(f[2])];
    if (!Number.isInteger(n) || n < MIN_N || n > MAX_N)
      throw new Error(
        `timelimit.csv line ${ln}: N out of range [${MIN_N}, ${MAX_N}]`,
      );
    if (!Number.isInteger(p) || p < 0 || p > n - 1)
      throw new Error(`timelimit.csv line ${ln}: P out of range [0, ${n - 1}]`);
    if (!Number.isFinite(limit) || limit <= 0)
      throw new Error(`timelimit.csv line ${ln}: limit must be > 0`);
    const key = `${n},${p}`;
    if (out.has(key))
      throw new Error(`timelimit.csv line ${ln}: duplicate (N=${n}, P=${p})`);
    out.set(key, limit);
  });
  return out;
}

/** Returns undefined when no benchmark exists for (n, p). */
export function effectiveTimeout(
  limits: TimeLimits,
  n: number,
  p: number,
  cfg: TesterConfig,
): number | undefined {
  const limit = limits.get(`${n},${p}`);
  return limit === undefined
    ? undefined
    : Math.max(limit * cfg.toleranceFactor, cfg.minTimeoutSeconds);
}

/** Up to 3 decimals, trailing zeros trimmed (design 6.5). */
export const formatTimeout = (s: number): string =>
  String(Number(s.toFixed(3)));

/** m:ss.fffff. Fraction of a second with 5 digits (10 µs resolution). */
export function formatDuration(ms: number): string {
  const units = Math.max(0, Math.round(ms * 100)); // 1 unit = 10 µs
  const min = Math.floor(units / 6_000_000);
  const rest = units % 6_000_000;
  const sec = Math.floor(rest / 100_000);
  const frac = rest % 100_000;
  return `${min}:${String(sec).padStart(2, "0")}.${String(frac).padStart(5, "0")}`;
}

// ---- Walled N-Queen: separate file, key (N, P, W) ----------------------------------------------
export type WalledTimeLimits = Map<string, number>; // key "N,P,W" -> seconds

/** timelimit-walled.csv: header "N,P,W,limit"; P in [0, WALLED_MAX_P], W in [1, maxWallsForN(N)]. */
export function parseWalledTimelimitCsv(text: string): WalledTimeLimits {
  const lines = text.replace(/^\uFEFF/, "").split(/\r?\n/);
  while (lines.length && lines[lines.length - 1]!.trim() === "") lines.pop();
  if (lines[0]?.trim() !== "N,P,W,limit")
    throw new Error(
      'timelimit-walled.csv: header must be exactly "N,P,W,limit"',
    );
  const out: WalledTimeLimits = new Map();
  lines.slice(1).forEach((line, idx) => {
    const ln = idx + 2;
    const f = line.split(",").map((s) => s.trim());
    if (f.length !== 4)
      throw new Error(`timelimit-walled.csv line ${ln}: expected 4 fields`);
    const [n, p, w, limit] = f.map(Number) as [number, number, number, number];
    if (!Number.isInteger(n) || n < MIN_N || n > MAX_N)
      throw new Error(
        `timelimit-walled.csv line ${ln}: N out of range [${MIN_N}, ${MAX_N}]`,
      );
    if (!Number.isInteger(p) || p < 0 || p > WALLED_MAX_P)
      throw new Error(
        `timelimit-walled.csv line ${ln}: P out of range [0, ${WALLED_MAX_P}]`,
      );
    if (!Number.isInteger(w) || w < 1 || w > maxWallsForN(n))
      throw new Error(
        `timelimit-walled.csv line ${ln}: W out of range [1, ${maxWallsForN(n)}]`,
      );
    if (!Number.isFinite(limit) || limit <= 0)
      throw new Error(`timelimit-walled.csv line ${ln}: limit must be > 0`);
    const key = `${n},${p},${w}`;
    if (out.has(key))
      throw new Error(
        `timelimit-walled.csv line ${ln}: duplicate (N=${n}, P=${p}, W=${w})`,
      );
    out.set(key, limit);
  });
  return out;
}

/** Returns undefined when no walled benchmark exists for (n, p, w). */
export function effectiveWalledTimeout(
  limits: WalledTimeLimits,
  n: number,
  p: number,
  w: number,
  cfg: TesterConfig,
): number | undefined {
  const limit = limits.get(`${n},${p},${w}`);
  return limit === undefined
    ? undefined
    : Math.max(limit * cfg.toleranceFactor, cfg.minTimeoutSeconds);
}
