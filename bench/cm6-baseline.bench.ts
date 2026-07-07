/**
 * CodeMirror-6 / Lezer baseline — the "named competitor" half of SPEC.md §10's
 * honesty rule ("a speed claim without a named workload and a named competitor
 * is not shippable").
 *
 * STATUS: TO BE RUN. This file is a ready harness that stays INERT until the
 * baseline dependency is installed, so `pnpm bench` never breaks in a clean
 * checkout. We deliberately do NOT install it in the docs/bench run because it
 * mutates the shared `node_modules` of the worktree; run it locally with:
 *
 *   pnpm add -D @lezer/markdown @lezer/common     # the parser CM6 markdown is built on
 *   pnpm bench
 *
 * (For the full in-browser keystroke-to-paint comparison against a real editor
 * view — not just the parser — install `codemirror @codemirror/lang-markdown`
 * and drive it with the Playwright method in `bench/keystroke.md`.)
 *
 * Why Lezer specifically: CodeMirror 6's markdown mode is `@lezer/markdown`.
 * Comparing `@lezer/markdown`'s `parser.parse()` against Typewright's `parse()`
 * on the SAME fixtures is the apples-to-apples parse comparison — both pure,
 * node-friendly, no DOM. Lezer is incremental via `TreeFragment`s; the stub
 * measures cold parse here and leaves the fragment-reuse reparse as the wired
 * next step (mirroring our @mid / @end split in cold-parse.bench.ts).
 */
import { bench, describe } from 'vitest';
import { parse } from '../src/core/parser';
import { makeDoc, WORKLOADS } from './fixtures/gen';

type LezerMod = { parser: { parse(input: string): unknown } };

let lezer: LezerMod | null = null;
try {
  // Optional peer — only present after the `pnpm add -D` above.
  lezer = (await import('@lezer/markdown')) as unknown as LezerMod;
} catch {
  lezer = null;
}

const fixtures = Object.entries(WORKLOADS).map(([name, bytes]) => ({
  name,
  src: makeDoc(bytes),
}));

if (!lezer) {
  // eslint-disable-next-line no-console
  console.log(
    '[cm6-baseline] SKIPPED — @lezer/markdown not installed. ' +
      'Run `pnpm add -D @lezer/markdown @lezer/common` then `pnpm bench` to populate the baseline column.',
  );
  // Register a skipped placeholder so the file always has a suite and never
  // fails `pnpm bench` ("No test suite found") in a clean checkout.
  describe('CodeMirror/Lezer baseline — not installed', () => {
    bench.skip('pnpm add -D @lezer/markdown @lezer/common to populate', () => {});
  });
} else {
  const lz = lezer;
  for (const f of fixtures) {
    const kb = (f.src.length / 1024).toFixed(1);
    describe(`baseline — ${f.name} — ${kb} KB mixed`, () => {
      bench('Typewright parse()', () => {
        parse(f.src);
      });
      bench('CodeMirror/Lezer parse()', () => {
        lz.parser.parse(f.src);
      });
    });
  }
}
