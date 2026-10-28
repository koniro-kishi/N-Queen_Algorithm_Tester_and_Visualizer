import type { WorkerFactory, WorkerLike } from './session';

// The `new Worker(new URL(...))` form must stay inline so Vite bundles the worker.
export const browserWorkerFactory: WorkerFactory = () =>
  new Worker(new URL('./solver-worker.ts', import.meta.url), { type: 'module' }) as unknown as WorkerLike;
