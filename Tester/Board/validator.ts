// Independent validator (design section 9). Shares NO code with Board: it re-derives everything
// from a plain string[] snapshot with a naive pairwise scan.
export type Rule = 'size' | 'queen-count' | 'row' | 'column' | 'diagonal' | 'preplaced';
export type ValidationResult = { ok: true } | { ok: false; rule: Rule; message: string };

export function validateBoard(
  snapshot: string[],
  n: number,
  preplaced: ReadonlyArray<readonly [number, number]> = [],
): ValidationResult {
  if (snapshot.length !== n || snapshot.some((r) => r.length !== n)) {
    return { ok: false, rule: 'size', message: `Board snapshot is not ${n}x${n}` };
  }
  const queens: Array<[number, number]> = [];
  for (let r = 0; r < n; r++)
    for (let c = 0; c < n; c++) if (snapshot[r]![c] === 'Q') queens.push([r, c]);

  if (queens.length !== n) {
    return { ok: false, rule: 'queen-count', message: `Expected ${n} queens, found ${queens.length}` };
  }
  for (let i = 0; i < queens.length; i++) {
    for (let j = i + 1; j < queens.length; j++) {
      const [r1, c1] = queens[i]!, [r2, c2] = queens[j]!;
      if (r1 === r2) return { ok: false, rule: 'row', message: `Queens (${r1},${c1}) and (${r2},${c2}) share row ${r1}` };
      if (c1 === c2) return { ok: false, rule: 'column', message: `Queens (${r1},${c1}) and (${r2},${c2}) share column ${c1}` };
      if (Math.abs(r1 - r2) === Math.abs(c1 - c2))
        return { ok: false, rule: 'diagonal', message: `Queens (${r1},${c1}) and (${r2},${c2}) share a diagonal` };
    }
  }
  for (const [r, c] of preplaced) {
    if (snapshot[r]?.[c] !== 'Q') {
      return { ok: false, rule: 'preplaced', message: `Preplaced queen at (${r},${c}) is missing` };
    }
  }
  return { ok: true };
}
