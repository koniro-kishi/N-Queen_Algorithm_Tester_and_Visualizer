export interface TesterConfig {
  toleranceFactor: number;
  minTimeoutSeconds: number;
  lookaheadEvents: number;
  maxRetainedEvents: number;
  defaultStepDelayMs: number;
  solverMaxMemoryMB: number;
}

export function validateConfig(raw: unknown): TesterConfig {
  const c = raw as Record<string, unknown>;
  const num = (k: keyof TesterConfig): number => {
    const v = c?.[k];
    if (typeof v !== 'number' || !Number.isFinite(v)) throw new Error(`config.${k} must be a finite number`);
    return v;
  };
  const cfg: TesterConfig = {
    toleranceFactor: num('toleranceFactor'),
    minTimeoutSeconds: num('minTimeoutSeconds'),
    lookaheadEvents: num('lookaheadEvents'),
    maxRetainedEvents: num('maxRetainedEvents'),
    defaultStepDelayMs: num('defaultStepDelayMs'),
    solverMaxMemoryMB: num('solverMaxMemoryMB'),
  };
  if (cfg.toleranceFactor < 1 || cfg.toleranceFactor > 100) throw new Error('config.toleranceFactor must be in [1, 100]');
  if (cfg.minTimeoutSeconds <= 0) throw new Error('config.minTimeoutSeconds must be > 0');
  if (cfg.lookaheadEvents < 1) throw new Error('config.lookaheadEvents must be >= 1');
  return cfg;
}
