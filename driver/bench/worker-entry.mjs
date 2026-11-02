// Worker bootstrap: Worker() needs a .js/.mjs path; the actual code lives in benchmark.ts
// (its isMainThread === false branch). tsx's loader is inherited from the parent via execArgv.
await import('./benchmark.ts');
