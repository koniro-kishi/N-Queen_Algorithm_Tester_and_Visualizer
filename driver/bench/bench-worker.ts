import { parentPort, workerData } from "node:worker_threads";
import { runSolver } from "../../Tester/Execution/core/run-solver";
import { createControlBlock } from "../../Tester/Execution/protocol";

const { n, preplaced, moduleUrl } = workerData as {
  n: number;
  preplaced: Array<[number, number]>;
  moduleUrl: string;
};

const outcome = await runSolver({
  n,
  preplaced,
  recordEvents: false, // sama dengan mode Only Show Result: tanpa back-pressure
  control: createControlBlock(),
  emit: () => {},
  loadModule: async () => {
    const { default: createSolver } = await import(moduleUrl);
    return createSolver();
  },
});
parentPort!.postMessage(outcome);
