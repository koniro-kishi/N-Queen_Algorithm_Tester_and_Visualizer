import type { Board } from "../Board/board";
import type { DecodedEvent } from "../Execution/protocol";
import { computeHighlight } from "./highlight";
import type { QueenCell, RenderState } from "./renderer";

/** Display board + event pada cursor-1 (ControllerView.currentEvent) -> state untuk renderer. */
export function buildRenderState(
  board: Board,
  event: DecodedEvent | null,
): RenderState {
  const view = board.view();
  const queens: QueenCell[] = [];
  for (let r = 0; r < board.n; r++) {
    const row = view[r]!;
    for (let c = 0; c < board.n; c++) {
      if (row[c] === "Q")
        queens.push({ row: r, col: c, preplaced: board.isLocked(r, c) });
    }
  }
  return { n: board.n, queens, highlight: computeHighlight(view, event) };
}
