import { build, context } from 'esbuild';
import { readFileSync, statSync } from 'node:fs';
import { gzipSync } from 'node:zlib';

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'));
const outfile = 'dist/mmwave-3d-card.js';

const options = {
  entryPoints: ['src/mmwave-3d-card.js'],
  bundle: true,
  format: 'esm',
  target: 'es2021',
  minify: true,
  outfile,
  define: { __VERSION__: JSON.stringify(pkg.version) },
  banner: { js: `/*! mmwave-3d-card v${pkg.version} | MIT | bundles three.js (MIT) */` },
  legalComments: 'none',
};

if (process.argv.includes('--watch')) {
  const ctx = await context({ ...options, minify: false, sourcemap: 'inline' });
  await ctx.watch();
  console.log(`watching src/ → ${outfile}`);
} else {
  await build(options);
  const kb = (n) => `${(n / 1024).toFixed(0)} KB`;
  console.log(`${outfile}: ${kb(statSync(outfile).size)} (${kb(gzipSync(readFileSync(outfile)).length)} gzip)`);
}
