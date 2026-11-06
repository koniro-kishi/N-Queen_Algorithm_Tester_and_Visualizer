export interface TesterConfig {
  toleranceFactor: number;
  minTimeoutSeconds: number;
  lookaheadEvents: number;
  maxRetainedEvents: number;
  defaultStepDelayMs: number;
  solverMaxMemoryMB: number;
  benchCapSeconds: number;
  cutoffSeconds: number;
  /** Walled N-Queen: the UI accepts W <= floor(N^2 * maxWallFraction). Optional in the file, default below. */
  maxWallFraction: number;
}

export const DEFAULT_MAX_WALL_FRACTION = 0.25;

export function validateConfig(raw: unknown): TesterConfig {
  const c = raw as Record<string, unknown>;
  const num = (k: keyof TesterConfig): number => {
    const v = c?.[k];
    if (typeof v !== "number" || !Number.isFinite(v))
      throw new Error(`config.${k} must be a finite number`);
    return v;
  };
  const cfg: TesterConfig = {
    toleranceFactor: num("toleranceFactor"),
    minTimeoutSeconds: num("minTimeoutSeconds"),
    lookaheadEvents: num("lookaheadEvents"),
    maxRetainedEvents: num("maxRetainedEvents"),
    defaultStepDelayMs: num("defaultStepDelayMs"),
    solverMaxMemoryMB: num("solverMaxMemoryMB"),
    benchCapSeconds: num("benchCapSeconds"),
    cutoffSeconds: num("cutoffSeconds"),
    maxWallFraction:
      c?.maxWallFraction === undefined
        ? DEFAULT_MAX_WALL_FRACTION
        : num("maxWallFraction"),
  };
  if (cfg.toleranceFactor < 1 || cfg.toleranceFactor > 100)
    throw new Error("config.toleranceFactor must be in [1, 100]");
  if (cfg.minTimeoutSeconds <= 0)
    throw new Error("config.minTimeoutSeconds must be > 0");
  if (cfg.lookaheadEvents < 1)
    throw new Error("config.lookaheadEvents must be >= 1");
  if (cfg.benchCapSeconds <= 0)
    throw new Error("config.benchCapSeconds must be > 0");
  if (cfg.cutoffSeconds <= cfg.minTimeoutSeconds)
    throw new Error("config.cutoffSeconds must be > minTimeoutSeconds");
  if (cfg.maxWallFraction <= 0 || cfg.maxWallFraction > 1)
    throw new Error("config.maxWallFraction must be in (0, 1]");
  return cfg;
}
