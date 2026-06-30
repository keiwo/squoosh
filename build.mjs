import { build } from 'esbuild';

await build({
  entryPoints: ['node_modules/@squoosh/cli/src/index.js'],
  bundle: true,
  external: ['@squoosh/lib'],
  banner: {
    js: "require('events').defaultMaxListeners = 64; globalThis.fetch = undefined;",
  },
  format: 'cjs',
  platform: 'node',
  target: ['node16'],
  outfile: 'dist/bootstrap.cjs',
});
