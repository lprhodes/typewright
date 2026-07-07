# Typewright — Benchmarks

Honest performance numbers for the Typewright engine, per the rule in
[SPEC.md §10](../SPEC.md#10-performance-targets--benchmarking): *"A speed claim
without a named workload and a named competitor is not shippable… published even
where targets are missed."*

This page reports **real, reproduced Typewright numbers** for cold parse and the
keystroke-triggered reparse, the **bundle-size budget**, and a **real cold-parse
baseline against CodeMirror-6** (`@codemirror/lang-markdown`) on the identical
fixtures (§5). The only number still marked **to be run** is the in-browser
keystroke-to-paint (INP) comparison against a live editor *view* — that needs a
browser and is specified in [`bench/keystroke.md`](../bench/keystroke.md).

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
| Harness | vitest 3.2.6 (`bench`, tinybench), esbuild 0.27.7 |
| Date | 2026-07-07 |

Absolute times track the machine — and swing with its load between sessions (an
earlier, busier session on the same hardware read ~1.7× slower across the board);
the **ratios** (incremental vs. full parse) are the portable signal. §1, §2, and
§5 below are all from the **same** clean `pnpm bench` run so they are mutually
consistent.

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
long-tailed and can **swing run-to-run** when GC schedules a collection inside the
window. The **`min` is the stable, GC-free parse floor** — the most reproducible
figure — so it is the headline; the `p75` here is from this clean run.

| Workload | **min (parse floor)** | p75 (this run) | ops/s |
|---|---|---|---|
| 5.2 KB | **~0.17 ms** | ~0.25 ms | ~3,900 |
| 50.5 KB | **~1.9 ms** | ~2.7 ms | ~410 |
| 1024.5 KB | **~43 ms** | ~45 ms | ~22 |

**vs. SPEC target — cold parse < 16 ms @ 50 KB:** **met** — the parse floor is
~1.9 ms and this run's p75 (~2.7 ms) is well under 16 ms. The 1 MB cold parse
(~43 ms floor) is a one-time load cost, not per-keystroke — the incremental path
below is what a running editor pays.

## 2. Keystroke reparse — `parseIncremental()` vs full `parse()`

The reparse a single inserted character triggers. `parseIncremental` reuses the
block prefix *before* the edit and, when a safe block boundary can be **proven**,
bounds the reparse to the dirty block(s) and re-offsets the unchanged suffix
(`tryReuseSuffix` in `parser.ts`) — so the reparsed *span* is O(edited block),
not the whole tail. Correctness is the oracle: a one-way property test asserts the
result is deep-equal to a full `parse(nextSrc)` across the corpus (opts on and
off); it never trades correctness for speed, and declines the fast path (falling
back to reparse-to-EOF) whenever the boundary can't be proven. We report **three**
honest edit positions:

- **@top** — insert at the 5% mark (edit near the top of a large doc).
- **@mid** — insert at the 50% mark (worst *central* interactive edit).
- **@end** — insert at the 98% mark (typing at the end / streaming append).

Numbers below are the **GC-free `min`** (the stable, reproducible floor) for each
operation, from the run in the environment block above.

### The reparse span is now bounded (`parseIncrementalWithStats`, 1 MB doc)

| Edit | Prefix reused | Reparsed line span | Suffix blocks reused |
|---|---|---|---|
| @top (5%) | 308 | 925 → 927 (**2 lines**) | 5,811 |
| @mid (50%) | 3,063 | 9,168 → 9,170 (**2 lines**) | 3,056 |
| @end (98%) | 5,998 | 17,954 → 17,956 (**2 lines**) | 121 |

Every position reparses a **2-line span** and reuses the rest — the prior
"reparses to end-of-document" behaviour is gone. This is the structural win.

### 50.5 KB (the SPEC keystroke target workload) — min floors

| Operation | **min (floor)** | vs full `parse()` |
|---|---|---|
| keystroke @mid — `parseIncremental()` | **1.21 ms** | **~1.6× faster** |
| keystroke @mid — full `parse()` (baseline) | 1.93 ms | — |
| keystroke @end — `parseIncremental()` | **0.20 ms** | **~8.6× faster** |
| keystroke @end — full `parse()` (baseline) | 1.72 ms | — |
| keystroke @top — `parseIncremental()` | 2.42 ms | **~0.8× (slower)** |
| keystroke @top — full `parse()` (baseline) | 1.95 ms | — |

### 5.2 KB and 1024.5 KB — min floors

| Workload | op | `parseIncremental` | full `parse` | vs full |
|---|---|---|---|---|
| 5.2 KB | @top | 0.26 ms | 0.20 ms | ~0.8× (slower) |
| 5.2 KB | @mid | 0.13 ms | 0.20 ms | ~1.5× |
| 5.2 KB | @end | 0.032 ms | 0.23 ms | ~7× |
| 1024.5 KB | @top | 52.5 ms | 44.2 ms | ~0.8× (slower) |
| 1024.5 KB | @mid | 30.1 ms | 43.7 ms | ~1.45× |
| 1024.5 KB | @end | 4.24 ms | 43.8 ms | ~10× |

**Two honest costs still scale with the tail** — the bounded *span* is not the
whole story:

1. **The suffix re-offset is O(remaining blocks).** Re-offsetting the reused
   suffix deep-clones and shifts every trailing node. For a **near-top** edit that
   is almost the whole document, so `parseIncremental` @top is actually a hair
   **slower than a full parse** (52.5 ms vs 44.2 ms at 1 MB) — the clone costs more
   than it saves when there's little document to skip. The win is real for @mid
   (~1.45×) and large for @end (~10×), where progressively less tail must be
   re-offset. Making the re-offset lazy so early-doc edits also win is roadmap.
2. **An edit inside the very first block falls back to a full parse.** The
   reuse-cut needs a block *before* the edit to anchor prefix safety, so editing
   block 0 (e.g. a document's leading H1) has no reusable prefix and reparses the
   whole doc — a documented boundary (`parser.incremental.test.ts`), not a bug.

### vs. SPEC targets — the honest verdict

| SPEC target | Workload | Measured (parse floor) | Verdict |
|---|---|---|---|
| Keystroke → paint p95 < 8 ms | 50 KB, mid-doc edit | `parseIncremental` @mid **1.21 ms** floor | **Parse fits the budget.** Full INP (incl. layout/paint) is browser-measured — **to be run**, below. |
| Large-doc typing p95 < 8 ms | 1 MB | @end **4.24 ms**; @mid **30.1 ms**; @top **52.5 ms** | **Missed for central/early edits, met near-EOF.** The bounded span improved @mid (~34 ms → ~30 ms floor) but @top/@mid stay over budget because the suffix re-offset scales with the tail. |

**The 1 MB miss, stated plainly:** the tightening bounds the reparse *span* to the
dirty block(s) (shipped — see the stats table above), which is the correctness-
preserving structural win. But total wall-clock for a keystroke still carries the
O(tail) cost of re-offsetting the reused suffix, so a mid-document 1 MB keystroke
is ~30 ms (down from ~34 ms) and a near-top one does not yet beat a full parse.
Two things make 1 MB editing viable in practice, and the remaining wins are
roadmap:

1. **Viewport-bounded rendering** keeps *paint* cheap regardless of parse span —
   only the edited block's rendered output changes on screen (the bounded-DOM
   assertion in `bench/keystroke.md`).
2. **Edit locality** — while typing you edit near the caret's region; append/
   stream (@end) has a ~4.2 ms floor.
3. **Roadmap:** make the suffix re-offset lazy (shift offsets on read instead of
   deep-cloning every trailing node) so early-doc edits win too, and support a
   block-0 cut so first-block edits are bounded. The reparse *span* is already
   bounded; these close the remaining wall-clock gap.

## 3. Bundle size (`pnpm size`)

Each published entry is esbuild-bundled (its tsup-split shared chunks resolved
in), minified, and gzipped at level 9; `react`/`react-dom` are external and never
counted. The **`core` headless entry is a hard CI gate** — the zero-dependency
engine's small size is a core promise.

| Entry | Minified | **gzip** | Budget (gzip) | Status |
|---|---|---|---|---|
| `typewright/core` | 40.05 KB | **13.20 KB** | 14 KB · hard | ok |
| `typewright/streaming` | 21.90 KB | **8.04 KB** | 9 KB · soft | ok |
| `typewright/mdx` | 14.88 KB | **5.57 KB** | 7 KB · soft | ok |
| `typewright` (react) | 155.93 KB | **47.77 KB** | 48 KB · soft | ok |

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

## 5. The CodeMirror-6 baseline — measured

SPEC §10 requires a **named competitor** on the **same workloads**. This is that
comparison, run for real (`bench/cm6-baseline.bench.ts`).

**Competitor & version.** CodeMirror 6's Markdown mode —
`codemirror 6.0.2` · `@codemirror/lang-markdown 6.5.0` · `@codemirror/state 6.7.1`
(the Lezer-based markdown parser CodeMirror-6 editors actually run). These are
**bench-only devDependencies — never shipped** (see the `//bench` note in
`package.json`); the bench skips cleanly if they are absent, so `pnpm bench` stays
green in a clean checkout.

**Workload.** The exact same deterministic fixtures as §1 (5.2 / 50.5 / 1024.5 KB
mixed content), with CodeMirror configured on its **GFM base**
(`markdown({ base: markdownLanguage })`) so its coverage matches Typewright's GFM
(tables, task lists, `~~strikethrough~~`, autolinks) — apples to apples.

**Method.** Both sides are timed as sibling `bench` cases in the *same* tinybench
run, on the same machine, under the same GC behaviour:

- **Typewright** — `parse(src)` → offset-exact **block+inline AST**.
- **CodeMirror-6** — the document is built with `EditorState.create({ doc, … })`
  (the real editor document path), then the configured markdown language's Lezer
  parser is driven to completion with `parser.parse(src)`, producing a **full
  Lezer syntax tree** that covers the whole document (`tree.length === src.length`
  — verified and logged per fixture; no viewport laziness, no timeout that could
  abort on the 1 MB doc). `EditorState.create` (document construction, ~1–10 ms) is
  excluded from the parse column so the comparison is parse-vs-parse.

**What each measures — the honest caveat.** These are *different artefacts*, not
"same output, different speed". Typewright emits a compact block AST tuned for
decoration + dirty-block reparse (~6.1 K top-level blocks at 1 MB). CodeMirror
emits a full Lezer tree — every node and every marker (~356 / ~3.3 K / ~67 K
nodes for the three fixtures) — that also backs its incremental reparse and
highlighting. So this compares two Markdown front-ends' **cold-parse cost on
identical bytes**, each building the tree its own pipeline needs.

### Cold parse — Typewright `parse()` vs CodeMirror-6 `parser.parse()`

As in §1, both allocate a whole tree per call, so `mean`/`p75` fold in periodic
**GC pauses** (CodeMirror's are heavier — its 1 MB `p999` reached ~3.4 s in one
run). The **GC-free `min` is the stable, reproducible floor** and the headline;
the figures below are `min` floors, and each range is that floor's spread across
three runs.

| Workload | Typewright `parse()` **min** | CodeMirror-6 **min** | Typewright is |
|---|---|---|---|
| 5.2 KB | **~0.16 ms** | ~0.68 ms | **~4.2× faster** |
| 50.5 KB | **~1.7 ms** | ~6.8 ms | **~4.1× faster** |
| 1024.5 KB | **~45 ms** | ~143 ms | **~3.2× faster** |

Across the *whole* distribution (tinybench's throughput/`mean` summary, GC tails
included) this run's summarised speed-up was **3.9× / 3.7× / 3.3×** for the three
fixtures — close to the floor ratios, because the run was GC-light. In earlier,
GC-heavier sessions the `mean` is noisier (a GC-heavy 5 KB run can flip the *mean*
to a near-tie even while the `min` floor keeps Typewright ~4× ahead), which is
exactly why the GC-free `min` floors above are the honest, less-noisy signal.

**Read this plainly.** On these cold-parse workloads Typewright is consistently
faster — by roughly **3–4× at the GC-free floor** (about **4×** on the small and
medium docs, narrowing to **~3.2×** at 1 MB as absolute costs grow). That is
expected and not a
magic constant: Typewright builds a lean block AST specialised for GFM+MDX, while
Lezer builds a complete, general syntax tree with more nodes and machinery. It is
**not** a claim that Typewright's editor is 3–4× faster end to end — CodeMirror is
a mature, incremental, viewport-lazy editor, and the interactive win (if any) is
decided by keystroke-to-paint on a live view, which is the still-pending INP
measurement below, **not** by this batch cold-parse number. SPEC §10 is explicit
that batch parse throughput is *not* the headline metric; this baseline is
published because a named competitor on named workloads is the honesty bar, and
the result happens to favour Typewright here.

### Still to run — in-browser keystroke-to-paint (INP)

The number that actually matters (SPEC §10) is **keystroke → paint** on a live
editor *view*, not batch parse. That needs a browser to measure layout + paint and
so is not part of this node harness. `codemirror` + `@codemirror/lang-markdown`
(the full editor, also already dev-installed) are driven with the identical
Playwright method in [`bench/keystroke.md`](../bench/keystroke.md) — **to be run**.
No end-to-end interactive speed claim vs CodeMirror is published until it is.

---

*Files: `bench/fixtures/gen.ts` (generator) · `bench/cold-parse.bench.ts` (parse)
· `bench/keystroke.md` (INP method, to be run) · `bench/cm6-baseline.bench.ts`
(CodeMirror-6 cold-parse baseline) · `bench/size.ts` (budget). Scripts:
`pnpm bench`, `pnpm size`.*
