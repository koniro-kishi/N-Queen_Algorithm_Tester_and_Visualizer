import { MAX_N, MIN_N } from '../Board/preplaced';
import type { TesterConfig } from './config';

export type TimeLimits = Map<string, number>; // key "N,P" -> seconds

export function parseTimelimitCsv(text: string): TimeLimits {
  const lines = text.replace(/^\uFEFF/, '').split(/\r?\n/);
  while (lines.length && lines[lines.length - 1]!.trim() === '') lines.pop();
  if (lines[0]?.trim() !== 'N,P,limit') throw new Error('timelimit.csv: header must be exactly "N,P,limit"');
  const out: TimeLimits = new Map();
  lines.slice(1).forEach((line, idx) => {
    const ln = idx + 2;
    const f = line.split(',').map((s) => s.trim());
    if (f.length !== 3) throw new Error(`timelimit.csv line ${ln}: expected 3 fields`);
    const [n, p, limit] = [Number(f[0]), Number(f[1]), Number(f[2])];
    if (!Number.isInteger(n) || n < MIN_N || n > MAX_N) throw new Error(`timelimit.csv line ${ln}: N out of range [${MIN_N}, ${MAX_N}]`);
    if (!Number.isInteger(p) || p < 0 || p > n - 1) throw new Error(`timelimit.csv line ${ln}: P out of range [0, ${n - 1}]`);
    if (!Number.isFinite(limit) || limit <= 0) throw new Error(`timelimit.csv line ${ln}: limit must be > 0`);
    const key = `${n},${p}`;
    if (out.has(key)) throw new Error(`timelimit.csv line ${ln}: duplicate (N=${n}, P=${p})`);
    out.set(key, limit);
  });
  return out;
}

/** Returns undefined when no benchmark exists for (n, p). */
export function effectiveTimeout(limits: TimeLimits, n: number, p: number, cfg: TesterConfig): number | undefined {
  const limit = limits.get(`${n},${p}`);
  return limit === undefined ? undefined : Math.max(limit * cfg.toleranceFactor, cfg.minTimeoutSeconds);
}

/** Up to 3 decimals, trailing zeros trimmed (design 6.5). */
export const formatTimeout = (s: number): string => String(Number(s.toFixed(3)));
