// One entry point for the UI: classic (W = 0) or Walled N-Queen (W > 0) instance for (N, P, W, seed).
// Pure and cached, so the config panel can ask "is this feasible?" on every keystroke without regenerating.
import { generatePreplaced } from "./preplaced";
import { generateWalled } from "./walled";

export type BuiltInstance =
  | {
      ok: true;
      n: number;
      preplaced: Array<[number, number]>;
      walls: Array<[number, number]>;
      /** Target queen count q for solve(n, q): n in classic mode, the generator's Q in Walled mode. */
      target: number;
    }
  | { ok: false; reason: string };

export function buildInstance(
  n: number,
  p: number,
  w: number,
  seed: number,
): BuiltInstance {
  try {
    if (w === 0) {
      return {
        ok: true,
        n,
        preplaced: generatePreplaced(n, p, seed).queens,
        walls: [],
        target: n,
      };
    }
    const i = generateWalled(n, p, w, seed);
    return { ok: true, n, preplaced: i.queens, walls: i.walls, target: i.q };
  } catch (e) {
    return { ok: false, reason: (e as Error).message };
  }
}

export class InstanceCache {
  private readonly map = new Map<string, BuiltInstance>();
  constructor(private readonly limit = 64) {}

  get(n: number, p: number, w: number, seed: number): BuiltInstance {
    const key = `${n},${p},${w},${seed}`;
    let b = this.map.get(key);
    if (!b) {
      if (this.map.size >= this.limit) this.map.clear();
      b = buildInstance(n, p, w, seed);
      this.map.set(key, b);
    }
    return b;
  }
}
