/**
 * Bundle-size budget for the published entry points (SPEC.md §10:
 * "Bundle (core, gzip): small, tracked in CI").
 *
 *   pnpm size            # node --experimental-strip-types bench/size.ts
 *
 * Method: for each package export, esbuild-bundle the ALREADY-BUILT `dist`
 * entry into a single minified module (react/react-dom marked external, never
 * counted), then gzip at level 9. This is the real over-the-wire cost a
 * consumer's bundler produces for that entry — including the shared chunks tsup
 * code-splits out (so `dist/core/index.js` alone is 445 B, but its true bundled
 * size is what this reports). Requires `pnpm build` first.
 *
 * The `core` headless entry is a HARD budget gate (exit 1 on breach) — it is the
 * zero-dependency engine whose small size is a core promise. The others carry
 * budgets too, all with headroom over today's measured size.
 */
import { gzipSync } from 'node:zlib';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { build } from 'esbuild';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

type Entry = { name: string; file: string; budgetKB: number; hard: boolean };

// gzip budgets in KB. Set with headroom over the measured baseline; tighten as
// the engine is optimized. `hard: true` fails the build on breach.
// Budgets ≈ measured baseline + ~10-15% headroom, so a real regression trips the
// gate while normal churn does not. Measured (2026-07): core 12.67 · streaming
// 8.03 · mdx 5.41 · react 42.95 KB gzip.
const ENTRIES: Entry[] = [
  { name: 'core', file: 'dist/core/index.js', budgetKB: 14, hard: true },
  { name: 'streaming', file: 'dist/streaming/index.js', budgetKB: 9, hard: false },
  { name: 'mdx', file: 'dist/mdx/index.js', budgetKB: 7, hard: false },
  { name: 'react', file: 'dist/react/index.js', budgetKB: 48, hard: false },
];

const EXTERNAL = ['react', 'react-dom', 'react/*', 'react-dom/*'];

async function measure(e: Entry) {
  const abs = join(root, e.file);
  if (!existsSync(abs)) {
    throw new Error(`missing ${e.file} — run \`pnpm build\` first`);
  }
  const result = await build({
    entryPoints: [abs],
    bundle: true,
    minify: true,
    format: 'esm',
    platform: 'browser',
    legalComments: 'none',
    external: EXTERNAL,
    write: false,
    logLevel: 'silent',
  });
  const out = result.outputFiles[0]!.contents;
  const min = out.byteLength;
  const gz = gzipSync(Buffer.from(out), { level: 9 }).byteLength;
  return { min, gz };
}

function kb(bytes: number): string {
  return (bytes / 1024).toFixed(2) + ' KB';
}

const results = await Promise.all(
  ENTRIES.map(async (e) => ({ e, ...(await measure(e)) })),
);

// eslint-disable-next-line no-console
console.log('\nTypewright bundle sizes (esbuild-bundled, minified, react external)\n');
// eslint-disable-next-line no-console
console.log('  entry      minified     gzip     budget    status');
// eslint-disable-next-line no-console
console.log('  ' + '-'.repeat(56));

let failed = false;
for (const r of results) {
  const overBudget = r.gz > r.e.budgetKB * 1024;
  const status = overBudget ? (r.e.hard ? 'FAIL' : 'over (soft)') : 'ok';
  if (overBudget && r.e.hard) failed = true;
  // eslint-disable-next-line no-console
  console.log(
    '  ' +
      r.e.name.padEnd(10) +
      kb(r.min).padStart(9) +
      kb(r.gz).padStart(11) +
      (r.e.budgetKB + ' KB').padStart(10) +
      '   ' +
      status,
  );
}
// eslint-disable-next-line no-console
console.log('');

if (failed) {
  // eslint-disable-next-line no-console
  console.error('Bundle-size budget exceeded (hard gate).');
  process.exit(1);
}
