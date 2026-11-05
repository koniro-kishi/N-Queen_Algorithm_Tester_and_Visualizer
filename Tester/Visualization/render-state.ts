import type { Board } from "../Board/board";
import type { DecodedEvent } from "../Execution/protocol";
import { computeHighlight } from "./highlight";
import type { QueenCell, RenderState, WallCell } from "./renderer";

/** Display board + event pada cursor-1 (ControllerView.currentEvent) -> state untuk renderer. */
export function buildRenderState(
  board: Board,
  event: DecodedEvent | null,
): RenderState {
  const view = board.view();
  const queens: QueenCell[] = [];
  const walls: WallCell[] = [];
  for (let r = 0; r < board.n; r++) {
    const row = view[r]!;
    for (let c = 0; c < board.n; c++) {
      if (row[c] === "Q")
        queens.push({ row: r, col: c, preplaced: board.isLocked(r, c) });
      else if (row[c] === "W") walls.push({ row: r, col: c });
    }
  }
  return { n: board.n, queens, walls, highlight: computeHighlight(view, event) };
}
