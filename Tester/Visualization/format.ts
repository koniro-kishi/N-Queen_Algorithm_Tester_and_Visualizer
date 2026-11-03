import { OP_PUT, OP_CHECK, type DecodedEvent } from "../Execution/protocol";

/** Step Tracer row text (design 6.4). `index` is the global 0-based event index; the row shows it 1-based. */
export function describeEvent(index: number, e: DecodedEvent): string {
  if (e.op === OP_CHECK)
    return `#${index + 1}  CHECK (${e.x},${e.y})  ${e.valid ? "safe" : "attacked"}`;
  const head = `#${index + 1}  ${e.op === OP_PUT ? "PUT" : "REMOVE"} (${e.x},${e.y})`;
  if (e.op !== OP_PUT) return head;
  return e.valid
    ? `${head}  valid`
    : `${head}  conflict (${e.pairs} ${e.pairs === 1 ? "pair" : "pairs"})`;
}
