/**
 * CodeMirror-6 cold-parse baseline — the "named competitor" half of SPEC.md §10's
 * honesty rule ("a speed claim without a named workload and a named competitor is
 * not shippable"). Run with:
 *
 *   pnpm bench            # vitest bench --run bench/
 *
 * WHAT THIS MEASURES. For each shared fixture (5 KB / 50 KB / 1 MB mixed content,
 * `bench/fixtures/gen.ts`) it puts two cold full parses side by side, in the SAME
 * tinybench harness, on the SAME machine, under the SAME GC behaviour:
 *
 *   • Typewright `parse(src)`  — string → offset-exact **block+inline AST**.
 *   • CodeMirror-6             — string → complete **Lezer syntax tree**, via the
 *     `@codemirror/lang-markdown` language parser, GFM extensions enabled so the
 *     coverage matches Typewright (tables / task lists / strikethrough / autolinks).
 *
 * WHY THIS IS FAIR — AND WHAT EACH SIDE ACTUALLY BUILDS (SPEC §10 honesty).
 * The two produce *different* artefacts: Typewright yields a compact block AST
 * tuned for decoration + dirty-block reparse; CodeMirror-6 yields a full Lezer
 * tree (every node, every marker) that also backs incremental reparse and
 * highlighting. So this is not "same output, different speed" — it is two markdown
 * front-ends' cold-parse cost on identical bytes. We report it plainly whichever
 * way it falls, and read the GC-free `min` as the stable floor (both allocate a
 * whole tree per call, so `mean`/`p75` fold in periodic GC pauses — same caveat
 * the Typewright numbers carry in `docs/BENCHMARKS.md`).
 *
 * HOW WE FORCE A FULL PARSE. We build the document with `EditorState.create`
 * (the real CodeMirror document-construction path) and drive the configured
 * markdown language's Lezer parser to completion with `parser.parse(src)`, which
 * returns a tree covering the whole document (`tree.length === src.length`) — no
 * viewport laziness, no timeout that could abort on the 1 MB doc. (`ensureSyntaxTree`
 * / `forceParsing` live in `@codemirror/language`, which is only a *transitive*
 * dep here and not resolvable from the worktree root under pnpm; `parser.parse`
 * yields the same complete tree those helpers would, so we use it directly.)
 *
 * GUARDED / OPT-IN. The CodeMirror devDeps (`@codemirror/state`,
 * `@codemirror/lang-markdown`) are bench-only and NEVER shipped. The import is
 * wrapped in try/catch: if they are absent the suite registers a single skipped
 * placeholder so `pnpm bench` stays green in a clean checkout. See the `//bench`
 * note in package.json.
 */
import { bench, describe } from 'vitest';
import { parse } from '../src/core/parser';
import { makeDoc, WORKLOADS } from './fixtures/gen';

/** Minimal surface we need from the optional CodeMirror-6 baseline. */
type CM6Baseline = {
  /** e.g. "@codemirror/lang-markdown 6.5.0" — for the one-shot provenance log. */
  label: string;
  /** Build the CM6 document (EditorState) — the real document-construction path. */
  buildDoc: (src: string) => void;
  /** Force a full parse to completion; returns the tree's covered length. */
  fullParse: (src: string) => number;
};

async function loadCM6(): Promise<CM6Baseline | null> {
  try {
    // Bench-only, opt-in devDeps — see package.json "//bench".
    const [state, md] = await Promise.all([
      import('@codemirror/state'),
      import('@codemirror/lang-markdown'),
    ]);
    // GFM base so CM6's coverage matches Typewright's (tables, task lists, ~~del~~,
    // autolinks) — the honest apples-to-apples for our mixed-content fixtures.
    const support = md.markdown({ base: md.markdownLanguage });
    const parser = support.language.parser;

    let label = '@codemirror/lang-markdown (version unknown)';
    try {
      // These packages don't expose ./package.json in `exports`, so resolve the
      // entry file and walk up to the nearest package.json (fs, not require).
      const { createRequire } = await import('node:module');
      const { readFileSync } = await import('node:fs');
      const path = await import('node:path');
      const require = createRequire(import.meta.url);
      const versionOf = (pkg: string): string => {
        let dir = path.dirname(require.resolve(pkg));
        for (let i = 0; i < 8; i++) {
          try {
            const p = path.join(dir, 'package.json');
            const j = JSON.parse(readFileSync(p, 'utf8')) as { name?: string; version?: string };
            if (j.name === pkg && j.version) return j.version;
          } catch {
            /* keep walking up */
          }
          dir = path.dirname(dir);
        }
        return '?';
      };
      label = `codemirror ${versionOf('codemirror')} · @codemirror/lang-markdown ${versionOf('@codemirror/lang-markdown')} · @codemirror/state ${versionOf('@codemirror/state')}`;
    } catch {
      /* provenance is best-effort; the parse still runs */
    }

    return {
      label,
      buildDoc: (src) => {
        state.EditorState.create({ doc: src, extensions: [support] });
      },
      fullParse: (src) => parser.parse(src).length,
    };
  } catch {
    return null;
  }
}

const cm6 = await loadCM6();

const fixtures = Object.entries(WORKLOADS).map(([name, bytes]) => ({
  name,
  src: makeDoc(bytes),
}));

if (!cm6) {
  // eslint-disable-next-line no-console
  console.log(
    '[cm6-baseline] SKIPPED — CodeMirror-6 devDeps not installed. ' +
      'Run `pnpm add -D codemirror @codemirror/lang-markdown @codemirror/state @codemirror/view` ' +
      'then `pnpm bench` to populate the baseline column.',
  );
  // A skipped placeholder so the file always has a suite and never fails
  // `pnpm bench` ("No test suite found") in a clean checkout.
  describe('CodeMirror-6 baseline — not installed', () => {
    bench.skip('install the opt-in devDeps to populate the baseline', () => {});
  });
} else {
  const baseline = cm6;

  // One-shot provenance + full-coverage verification (printed once at load, off the
  // hot path). Proves CM6 built a complete tree over the whole document — i.e. we
  // are timing a real full parse, not an aborted/lazy one — and records the
  // build-document + parse split with performance.now().
  for (const f of fixtures) {
    const kb = (f.src.length / 1024).toFixed(1);
    const b0 = performance.now();
    baseline.buildDoc(f.src);
    const b1 = performance.now();
    const covered = baseline.fullParse(f.src);
    const b2 = performance.now();
    const full = covered === f.src.length ? 'FULL' : `PARTIAL(${covered}/${f.src.length})`;
    // eslint-disable-next-line no-console
    console.log(
      `[cm6-baseline:${f.name} ${kb}KB] ${baseline.label} | ${full} tree | ` +
        `EditorState.create ${(b1 - b0).toFixed(2)}ms · full parse ${(b2 - b1).toFixed(2)}ms (cold, incl. warmup)`,
    );
  }

  // Same warmup/sampling profile as cold-parse.bench.ts so the two columns are
  // measured under identical conditions. Both allocate a whole tree per call, so
  // read `min` (the GC-free floor) as the stable, reproducible signal.
  function opts(name: string) {
    return name === 'large'
      ? { warmupIterations: 5, warmupTime: 500, time: 3000 }
      : { warmupIterations: 100, warmupTime: 750, time: 2500 };
  }

  for (const f of fixtures) {
    const kb = (f.src.length / 1024).toFixed(1);
    const o = opts(f.name);
    describe(`cold parse — ${f.name} — ${kb} KB mixed`, () => {
      bench(
        'Typewright parse() → block AST',
        () => {
          parse(f.src);
        },
        o,
      );
      bench(
        'CodeMirror-6 parse() → Lezer tree',
        () => {
          baseline.fullParse(f.src);
        },
        o,
      );
    });
  }
}
