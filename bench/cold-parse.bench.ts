/**
 * Typewright cold-parse + keystroke-reparse microbenchmark (SPEC.md §10).
 *
 *   pnpm bench            # vitest bench --run bench/**
 *
 * Measures, on the deterministic fixtures (5 KB / 50 KB / 1 MB mixed content):
 *
 *   1. `parse()`                 — cold full parse of the whole document.
 *   2. `parseIncremental()`      — the reparse a single keystroke triggers, at
 *                                  two edit positions (mid-doc and near-EOF).
 *   3. `parse()` on the edited   — the full-reparse baseline for the same
 *      source (baseline)           keystroke, to quantify the incremental win.
 *
 * This is the PARSE component of keystroke-to-paint. It is not the whole INP
 * number — layout/paint happens in the browser and is measured separately (see
 * `bench/keystroke.md`). vitest prints the hz / mean / p99 table via tinybench.
 *
 * Honesty note (SPEC §10): `parseIncremental` reuses the block prefix *before*
 * the edit and reparses from there to end-of-document (correctness over a
 * fast-but-wrong shift pass — see parser.ts). So its cost scales with how much
 * document sits AFTER the caret: a near-EOF edit is cheap, a mid-doc edit
 * reparses ~half. Both positions are reported rather than cherry-picking.
 */
import { bench, describe } from 'vitest';
import {
  parse,
  parseIncremental,
  parseIncrementalWithStats,
} from '../src/core/parser';
import { makeDoc, WORKLOADS } from './fixtures/gen';

type Fixture = {
  name: string;
  src: string;
  doc: ReturnType<typeof parse>;
  midChange: { from: number; to: number; insert: string };
  midNext: string;
  endChange: { from: number; to: number; insert: string };
  endNext: string;
};

function editAt(src: string, at: number) {
  const change = { from: at, to: at, insert: 'x' };
  const next = src.slice(0, at) + 'x' + src.slice(at);
  return { change, next };
}

const fixtures: Fixture[] = Object.entries(WORKLOADS).map(([name, bytes]) => {
  const src = makeDoc(bytes);
  const doc = parse(src);
  const mid = editAt(src, Math.floor(src.length / 2));
  const end = editAt(src, Math.floor(src.length * 0.98));
  return {
    name,
    src,
    doc,
    midChange: mid.change,
    midNext: mid.next,
    endChange: end.change,
    endNext: end.next,
  };
});

// One-shot correctness + reuse report (printed once at load, not on the hot path).
for (const f of fixtures) {
  const mid = parseIncrementalWithStats(f.doc, f.src, f.midChange, f.midNext);
  const end = parseIncrementalWithStats(f.doc, f.src, f.endChange, f.endNext);
  const kb = (f.src.length / 1024).toFixed(1);
  // eslint-disable-next-line no-console
  console.log(
    `[incremental:${f.name} ${kb}KB] mid: reused=${mid.stats.reusedBlocks} reparseFrom=${mid.stats.reparsedFromLine}/${mid.stats.totalLines} fellBack=${mid.stats.fellBack} | end: reused=${end.stats.reusedBlocks} reparseFrom=${end.stats.reparsedFromLine}/${end.stats.totalLines} fellBack=${end.stats.fellBack}`,
  );
}

// Generous warmup + sampling so the reported mean/p75 reflect steady-state JIT'd
// code, not cold-start or one-off GC pauses. Parsing allocates a whole AST per
// call, so the distribution is long-tailed (periodic GC) — read `min` as the
// best-case steady state and `p75` as the typical keystroke, per SPEC §10.
function opts(name: string) {
  return name === 'large'
    ? { warmupIterations: 5, warmupTime: 500, time: 3000 }
    : { warmupIterations: 100, warmupTime: 750, time: 2500 };
}

for (const f of fixtures) {
  const kb = (f.src.length / 1024).toFixed(1);
  const o = opts(f.name);
  describe(`${f.name} — ${kb} KB mixed`, () => {
    bench('cold parse()', () => {
      parse(f.src);
    }, o);
    bench('keystroke @mid — parseIncremental()', () => {
      parseIncremental(f.doc, f.src, f.midChange, f.midNext);
    }, o);
    bench('keystroke @mid — full parse() [baseline]', () => {
      parse(f.midNext);
    }, o);
    bench('keystroke @end — parseIncremental()', () => {
      parseIncremental(f.doc, f.src, f.endChange, f.endNext);
    }, o);
    bench('keystroke @end — full parse() [baseline]', () => {
      parse(f.endNext);
    }, o);
  });
}
