import { describe, expect, it } from 'vitest';
import { HistoryStore } from '../Tester/Visualization/history';

const seq = (from: number, count: number) => Uint32Array.from({ length: count }, (_, i) => from + i);

describe('HistoryStore', () => {
  it('keeps global indices across chunk boundaries', () => {
    const h = new HistoryStore(1000, 4);
    h.append(seq(0, 3));
    h.append(seq(3, 7)); // spans chunks 0..2
    expect(h.length).toBe(10);
    for (let i = 0; i < 10; i++) expect(h.get(i)).toBe(i);
    expect(h.firstIndex).toBe(0);
    expect(h.truncated).toBe(false);
  });

  it('drops whole oldest chunks over the cap, indices stay global', () => {
    const h = new HistoryStore(8, 4);
    h.append(seq(0, 20));
    expect(h.length).toBe(20);
    expect(h.firstIndex).toBeGreaterThan(0);
    expect(h.firstIndex % 4).toBe(0);
    expect(h.length - h.firstIndex).toBeLessThanOrEqual(8 + 3); // cap, plus the partially filled last chunk
    expect(h.truncated).toBe(true);
    expect(h.has(h.firstIndex - 1)).toBe(false);
    expect(h.get(19)).toBe(19);
    expect(() => h.get(0)).toThrow(RangeError);
  });

  it('never drops a chunk the cursor still needs (protectFrom)', () => {
    const h = new HistoryStore(8, 4);
    h.append(seq(0, 20), 5); // cursor at 5 -> chunk [4..8) must stay
    expect(h.firstIndex).toBeLessThanOrEqual(4);
    expect(h.get(5)).toBe(5);
  });

  it('accumulates batches across many appends and clears', () => {
    const h = new HistoryStore(1_000_000, 65_536);
    for (let i = 0; i < 300; i++) h.append(seq(i * 512, 512));
    expect(h.length).toBe(153_600);
    expect(h.get(70_000)).toBe(70_000);
    h.clear();
    expect(h.length).toBe(0);
    expect(h.firstIndex).toBe(0);
    h.append(seq(7, 2));
    expect(h.get(1)).toBe(8);
  });

  it('rejects bad construction', () => {
    expect(() => new HistoryStore(0)).toThrow(RangeError);
    expect(() => new HistoryStore(10, 0)).toThrow(RangeError);
  });
});
