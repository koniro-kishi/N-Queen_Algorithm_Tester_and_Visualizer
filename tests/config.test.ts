import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { validateConfig } from '../Tester/Configuration/config';

describe('tester.config.json', () => {
  it('is valid', () => {
    const raw = JSON.parse(readFileSync('Tester/Configuration/tester.config.json', 'utf8'));
    expect(validateConfig(raw).toleranceFactor).toBe(3);
  });
  it('rejects out-of-range tolerance', () => {
    expect(() => validateConfig({ toleranceFactor: 0.5 })).toThrow();
  });
});
