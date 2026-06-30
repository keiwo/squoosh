#!/usr/bin/env node

globalThis.fetch = undefined;

(async () => {
  await import('@squoosh/cli/src/index.js');
})();