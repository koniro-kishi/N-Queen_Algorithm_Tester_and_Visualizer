// Emscripten --js-library: forwards C imports to globalThis.__nqHost,
// which the worker sets before instantiating the module.
mergeInto(LibraryManager.library, {
  nq_put: function (x, y) {
    return globalThis.__nqHost.put(x, y) ? 1 : 0;
  },
  nq_remove: function (x, y) {
    globalThis.__nqHost.remove(x, y);
  },
  nq_check: function (x, y) {
    return globalThis.__nqHost.check(x, y) ? 1 : 0;
  },
  nq_view: function (ptr, n) {
    const bytes = globalThis.__nqHost.view(); // Uint8Array of n*n chars
    HEAPU8.set(bytes, ptr);
  },
});
