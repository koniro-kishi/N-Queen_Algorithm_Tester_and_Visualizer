// Browser worker adapter: a thin shell over the environment-neutral runSolver().
import { runSolver, type SolverModule } from './core/run-solver';
import { createControlBlock, type FromWorker, type ToWorker } from './protocol';

const ctx = self as unknown as { postMessage(msg: FromWorker, transfer?: Transferable[]): void };

self.onmessage = async (e: MessageEvent<ToWorker>) => {
  const msg = e.data;
  if (msg.type !== 'start') return;
  const { sessionId, moduleUrl } = msg;
  try {
    const outcome = await runSolver({
      n: msg.n,
      preplaced: msg.preplaced,
      recordEvents: msg.recordEvents,
      control: createControlBlock(msg.control),
      loadModule: async (): Promise<SolverModule> => {
        const { default: createSolver } = await import(/* @vite-ignore */ moduleUrl);
        return createSolver({ locateFile: (f: string) => new URL(f, moduleUrl).href });
      },
      emit: (events) => ctx.postMessage({ type: 'events', sessionId, events }, [events.buffer]),
    });
    ctx.postMessage({ type: 'outcome', sessionId, outcome });
  } catch (err) {
    // runSolver reports solver failures as outcomes; anything reaching here is a host bug.
    ctx.postMessage({
      type: 'outcome',
      sessionId,
      outcome: { status: 'error', kind: 'trap', message: String((err as Error)?.message ?? err), computeMs: 0, eventCount: 0 },
    });
  }
};
