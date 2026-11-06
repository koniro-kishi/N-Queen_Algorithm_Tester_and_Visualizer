// Independent validator (design section 9). Shares NO code with Board: it re-derives everything
// from a plain string[] snapshot with a naive pairwise scan. Walled N-Queen: two queens on one line
// attack each other unless a 'W' cell lies strictly between them.
export type Rule =
  | "size"
  | "queen-count"
  | "row"
  | "column"
  | "diagonal"
  | "preplaced"
  | "wall";
export type ValidationResult =
  | { ok: true }
  | { ok: false; rule: Rule; message: string };

export interface ValidateOptions {
  /** Walls the instance was created with. When given, the snapshot must contain exactly these 'W' cells. */
  walls?: ReadonlyArray<readonly [number, number]>;
  /** Minimum number of queens (target Q). Default: n, the classic N-Queen target. */
  target?: number;
}

export function validateBoard(
  snapshot: string[],
  n: number,
  preplaced: ReadonlyArray<readonly [number, number]> = [],
  opts: ValidateOptions = {},
): ValidationResult {
  if (snapshot.length !== n || snapshot.some((r) => r.length !== n)) {
    return {
      ok: false,
      rule: "size",
      message: `Board snapshot is not ${n}x${n}`,
    };
  }
  if (snapshot.some((r) => /[^QxW]/.test(r))) {
    return {
      ok: false,
      rule: "size",
      message: "Board snapshot contains a symbol other than 'Q', 'x' or 'W'",
    };
  }

  if (opts.walls) {
    const missing = opts.walls.find(([r, c]) => snapshot[r]?.[c] !== "W");
    const found = snapshot.reduce(
      (s, row) => s + [...row].filter((ch) => ch === "W").length,
      0,
    );
    const expected = new Set(opts.walls.map(([r, c]) => r * n + c)).size;
    if (missing) {
      return {
        ok: false,
        rule: "wall",
        message: `Wall at (${missing[0]},${missing[1]}) is missing`,
      };
    }
    if (found !== expected) {
      return {
        ok: false,
        rule: "wall",
        message: `Expected ${expected} walls, found ${found}`,
      };
    }
  }

  const queens: Array<[number, number]> = [];
  for (let r = 0; r < n; r++)
    for (let c = 0; c < n; c++)
      if (snapshot[r]![c] === "Q") queens.push([r, c]);

  const target = opts.target ?? n;
  if (queens.length < target) {
    return {
      ok: false,
      rule: "queen-count",
      message: `Expected at least ${target} queens, found ${queens.length}`,
    };
  }

  // A wall strictly between two queens on one line cuts the attack.
  const cut = (r1: number, c1: number, r2: number, c2: number): boolean => {
    const dr = Math.sign(r2 - r1),
      dc = Math.sign(c2 - c1);
    for (let r = r1 + dr, c = c1 + dc; r !== r2 || c !== c2; r += dr, c += dc) {
      if (snapshot[r]![c] === "W") return true;
    }
    return false;
  };

  for (let i = 0; i < queens.length; i++) {
    for (let j = i + 1; j < queens.length; j++) {
      const [r1, c1] = queens[i]!,
        [r2, c2] = queens[j]!;
      const sameRow = r1 === r2,
        sameCol = c1 === c2,
        sameDiag = Math.abs(r1 - r2) === Math.abs(c1 - c2);
      if (!(sameRow || sameCol || sameDiag) || cut(r1, c1, r2, c2)) continue;
      if (sameRow)
        return {
          ok: false,
          rule: "row",
          message: `Queens (${r1},${c1}) and (${r2},${c2}) share row ${r1}`,
        };
      if (sameCol)
        return {
          ok: false,
          rule: "column",
          message: `Queens (${r1},${c1}) and (${r2},${c2}) share column ${c1}`,
        };
      return {
        ok: false,
        rule: "diagonal",
        message: `Queens (${r1},${c1}) and (${r2},${c2}) share a diagonal`,
      };
    }
  }
  for (const [r, c] of preplaced) {
    if (snapshot[r]?.[c] !== "Q") {
      return {
        ok: false,
        rule: "preplaced",
        message: `Preplaced queen at (${r},${c}) is missing`,
      };
    }
  }
  return { ok: true };
}
