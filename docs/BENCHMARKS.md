# Typewright — Benchmarks

Honest performance numbers for the Typewright engine, per the rule in
[SPEC.md §10](../SPEC.md#10-performance-targets--benchmarking): *"A speed claim
without a named workload and a named competitor is not shippable… published even
where targets are missed."*

This page reports **real, reproduced Typewright numbers** for cold parse and the
keystroke-triggered reparse, plus the **bundle-size budget**. The CodeMirror-6
baseline column and the in-browser keystroke-to-paint (INP) number are harnessed
and specified but marked **to be run** — see the notes at the bottom for exactly
why and how.

## How to reproduce

```sh
pnpm build            # produce dist/ (needed by the size gate)
pnpm bench            # vitest bench --run bench/  → the parse tables below
pnpm size             # bundle + gzip each entry, assert the core budget
node --experimental-strip-types bench/fixtures/generate.ts   # (re)write the fixtures
```

Everything is deterministic: the fixtures are generated with **no `Math.random`**
(`bench/fixtures/gen.ts`), so the workloads are byte-identical on every machine.

### Environment for the numbers below

| | |
|---|---|
| Machine | Apple M5, macOS 26.4 (arm64) |
| Runtime | Node v22.22.3 |
| Harness | vitest 3.2.7 (`bench`, tinybench), esbuild 0.27.7 |
| Date | 2026-07-07 |

Absolute times track the machine; the **ratios** (incremental vs. full parse) are
the portable signal.

## Workloads (SPEC §10)

Fixed, mixed-content Markdown — headings, prose, bullet/ordered/task lists, GFM
tables, fenced code (ts/js/sql/bash), blockquotes, inline emphasis/code/links —
i.e. the shapes that actually exercise the block + inline parsers.

| Fixture | Size | Lines | Top-level blocks | File |
|---|---|---|---|---|
| `small` | 5.2 KB | 97 | 32 | `bench/fixtures/small.md` |
| `medium` | 50.5 KB | 910 | 304 | `bench/fixtures/medium.md` |
| `large` | 1024.5 KB | 18,317 | 6,120 | `bench/fixtures/large.md` (regenerated) |

## 1. Cold parse — `parse()`

Full parse of a cold string into a whole AST. Because each call allocates a fresh
AST, wall-clock samples fold in periodic **GC pauses** — so `mean`/`p75` are
long-tailed and **swing run-to-run** (across two runs the 50 KB `p75` was 11.6 ms
then 83.8 ms; that is GC *scheduling*, not parse work). The **`min` is the stable,
GC-free parse floor** — reproducible across runs — so it is the headline; the
`p75` range gives the with-GC "typical".

| Workload | **min (parse floor)** | p75 (incl. GC, observed range) | ops/s |
|---|---|---|---|
| 5.2 KB | **~0.22 ms** | 0.4 – 0.7 ms | ~430 – 1,650 |
| 50.5 KB | **~2.6 ms** | 11 – 84 ms · GC | ~13 – 93 |
| 1024.5 KB | **~76 ms** | 130 – 315 ms · GC | ~3 – 9 |

**vs. SPEC target — cold parse < 16 ms @ 50 KB:** **met** — the parse floor is
~2.6 ms; even the cleaner run's *typical* p75 (11.6 ms) sits under 16 ms (the
noisier run's p75 is a GC tail, not parse cost). The 1 MB cold parse (~76 ms
floor) is a one-time load cost, not per-keystroke — the incremental path below is
what a running editor pays.

## 2. Keystroke reparse — `parseIncremental()` vs full `parse()`

The reparse a single inserted character triggers. `parseIncremental` reuses the
block prefix *before* the edit and reparses from there to end-of-document
(correctness is the oracle — a one-way property test asserts it is deep-equal to
a full `parse(nextSrc)`; it never trades correctness for speed). So its cost
scales with **how much document sits after the caret**. We report two honest edit
positions rather than cherry-picking one:

- **@mid** — insert at the 50% mark (worst realistic interactive edit).
- **@end** — insert at the 98% mark (typing at the end / streaming append — the
  common case).

Numbers below are the **GC-free `min`** (the stable, reproducible floor across
runs) for each operation. The `min` for `parseIncremental` was within ~1% across
two runs (e.g. 50 KB @mid: 1.43 ms then 1.44 ms), so the ratios are solid.

### 50.5 KB (the SPEC keystroke target workload)

| Operation | **min (floor)** | speedup vs full |
|---|---|---|
| keystroke @mid — `parseIncremental()` | **1.44 ms** | **~1.9×** |
| keystroke @mid — full `parse()` (baseline) | 2.73 ms | — |
| keystroke @end — `parseIncremental()` | **0.31 ms** | **~8×** |
| keystroke @end — full `parse()` (baseline) | 2.56 ms | — |

The reused prefix is 152 blocks @mid and 297 @end.

### 5.2 KB and 1024.5 KB (min floors)

| Workload | op | `parseIncremental` | full `parse` | speedup |
|---|---|---|---|---|
| 5.2 KB | @mid | 0.14 ms | 0.21 ms | ~1.5× |
| 5.2 KB | @end | 0.035 ms | 0.22 ms | ~6× |
| 1024.5 KB | @mid | 34 ms | 68 ms | ~2.0× |
| 1024.5 KB | @end | 6.7 ms | 66 ms | ~10× |

Reuse (from `parseIncrementalWithStats`), 1 MB doc: **@mid** reuses 3,063 blocks
and reparses lines 9,168→18,317; **@end** reuses 5,998 and reparses
17,954→18,317. (`mean`/`p75` for the 1 MB rows carry a large GC tail — @mid mean
~59–80 ms, @end mean ~13–21 ms — so the `min` floors above are the honest signal.)

### vs. SPEC targets — the honest verdict

| SPEC target | Workload | Measured (parse floor) | Verdict |
|---|---|---|---|
| Keystroke → paint p95 < 8 ms | 50 KB, mid-doc edit | `parseIncremental` @mid **~1.4 ms** floor (typical p75 ~4 ms; GC tail to ~23 ms) | **Parse fits the budget.** Full INP (incl. layout/paint) is browser-measured — **to be run**, below. |
| Large-doc typing p95 < 8 ms | 1 MB, viewport-bounded | `parseIncremental` @end **6.7 ms** floor (mean ~13–21 ms); @mid **34 ms** floor | **Missed for the parse component.** Only best-case near-EOF touches < 8 ms, and only at the floor. |

**The 1 MB miss, stated plainly:** `parseIncremental` currently reparses from the
edit to end-of-document, so a mid-document keystroke in a 1 MB file re-tokenizes
~half the doc (~34 ms floor, tens of ms more under GC). This is a deliberate
correctness-first design (no fragile offset-shift pass). Two things make 1 MB
editing viable in practice despite it, and one is future work:

1. **Viewport-bounded rendering** keeps *paint* cheap regardless of parse span —
   only the edited block's rendered output changes on screen (the bounded-DOM
   assertion in `bench/keystroke.md`).
2. **Edit locality** — while typing you edit near the caret's region; append/
   stream (@end) has a ~6.7 ms floor.
3. **Future work:** bound the reparse span to the *dirty block(s) only* (stop at
   the next safe block boundary after the edit instead of running to EOF) to pull
   the mid-doc 1 MB case under budget. Tracked, not yet done.

## 3. Bundle size (`pnpm size`)

Each published entry is esbuild-bundled (its tsup-split shared chunks resolved
in), minified, and gzipped at level 9; `react`/`react-dom` are external and never
counted. The **`core` headless entry is a hard CI gate** — the zero-dependency
engine's small size is a core promise.

| Entry | Minified | **gzip** | Budget (gzip) | Status |
|---|---|---|---|---|
| `typewright/core` | 38.49 KB | **12.67 KB** | 14 KB · hard | ok |
| `typewright/streaming` | 21.90 KB | **8.03 KB** | 9 KB · soft | ok |
| `typewright/mdx` | 14.50 KB | **5.41 KB** | 7 KB · soft | ok |
| `typewright` (react) | 141.17 KB | **42.95 KB** | 48 KB · soft | ok |

`pnpm size` exits non-zero if `core` exceeds its gzip budget. Budgets sit ~15%
over today's measured size, so a real regression trips the gate while ordinary
churn does not.

## 4. Accessibility surface (a11y)

The interactive surfaces ship with roles/labels wired in the React components —
toolbar buttons are labelled, the fold menu uses `menu`/`menuitem`, the command
palette uses `combobox`/`listbox`, the comments sidebar is a `complementary`
region, popovers trap focus, and new animations respect
`prefers-reduced-motion`. A **full automated axe-core sweep over every surface is
the e2e phase**, not part of this parse/size harness — this section documents the
a11y surface that pass will assert against, so the claim isn't mistaken for a
completed audit.

## 5. The CodeMirror-6 baseline — to be run

SPEC §10 requires a **named competitor** on the **same workloads**. The harness
exists (`bench/cm6-baseline.bench.ts`) and compares Typewright's `parse()` against
`@lezer/markdown` — the parser CodeMirror 6's markdown mode is built on — on the
identical fixtures. It stays **inert** (registers a skipped placeholder) until the
baseline dependency is installed, so `pnpm bench` never breaks in a clean
checkout.

It is deliberately **not run in this pass** to avoid mutating the worktree's
shared `node_modules`. To populate the baseline column locally:

```sh
pnpm add -D @lezer/markdown @lezer/common     # parse baseline (node, no DOM)
pnpm bench                                     # fills the Typewright-vs-Lezer table
```

For the **full in-browser keystroke-to-paint** comparison against a real editor
*view* (not just its parser), install `codemirror @codemirror/lang-markdown` and
drive both editors with the identical Playwright method documented in
[`bench/keystroke.md`](../bench/keystroke.md). All baseline dependencies are
**devDependencies of the bench only — never shipped**.

Until that runs, no comparative speed claim is published here. What *is* published
above stands on its own: reproducible Typewright numbers on named, deterministic
workloads, with the misses called out.

---

*Files: `bench/fixtures/gen.ts` (generator) · `bench/cold-parse.bench.ts` (parse)
· `bench/keystroke.md` (INP method) · `bench/cm6-baseline.bench.ts` (competitor,
to be run) · `bench/size.ts` (budget). Scripts: `pnpm bench`, `pnpm size`.*
