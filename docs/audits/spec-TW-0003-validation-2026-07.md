# Spec-validation audit — TW-0003 (2026-07-07)

**Scope:** every claim in `docs/specs/spec-TW-0003.md` (+ `docs/plans/plan-TW-0003.md` acceptance criteria) traced to the code that *produces* it, on branch `ai/tw-0002` @ `5860ad0` (worktree `.worktrees/TW-0002`).
**Method:** REAL / AUTHORED / MOCK rubric — "it renders / types check / a test passes" is never evidence; every verdict cites the producing code. Four parallel investigators (caret reveal, reparse, bench+constraints, a11y) + independent gate runs + an orchestrator probe re-measuring the 1 MB incremental-parse claim. Re-run: repeat the four traces, `pnpm typecheck && pnpm vitest run --exclude '**/parser.perf.test.ts' && pnpm e2e && pnpm bench`, and the probe in this doc's §A2.

## Headline

**The four features are genuinely implemented — no mock/authored producers anywhere.** The failures are documentation-honesty failures around item 4: the spec's own success criterion "large-doc keystroke re-measured and published" was **not done**, leaving `BENCHMARKS.md` §2 publishing pre-tightening numbers and literally calling the shipped optimization "Tracked, not yet done" while `FEATURES.md` says "shipped". One performance claim ("top-of-doc edit reparses O(edited block)") overclaims wall-clock behaviour.

**Systemic pattern:** every *code* producer was built and wired, but the one DoD item that required *re-running a measurement and republishing it* was skipped — and because benchmark docs are hand-authored prose, nothing failed. In a repo whose stated rule is "a speed claim without a named workload is not shippable", stale published numbers are the exact inverted failure mode: a real optimization documented by figures from the implementation it deleted.

## Gates (run fresh during this audit)

| Gate | Result |
|---|---|
| `pnpm typecheck` | ✅ |
| Unit (`vitest`, excl. perf) | ✅ 332/332 (incl. 16 CaretRevealBlock, incremental property oracle 777×2 cases) |
| `pnpm build` (tsup) | ✅ |
| Playwright e2e | Run 1: 57/58 (`caret-reveal.spec.ts:287` block-mode-restore failed under load); rerun: **58/58**; failing test 2/2 green in isolation → load flake, not regression |
| `pnpm bench` (CM6) | ✅ re-run live by investigator; numbers reproduced for small/medium fixtures |
| a11y spec | ✅ re-run live: 9/9 |

## Issue register

| ID | Surface | Issue | Tier | Status |
|---|---|---|---|---|
| A1 | `docs/BENCHMARKS.md` §2, `docs/FEATURES.md` §10 | Incremental-parse numbers never re-measured after tightening; docs self-contradict ("shipped" vs "not yet done"); spec success criterion unmet | **High** | RESOLVED (TW-0004) |
| A2 | `docs/FEATURES.md:240`, spec brief §item-4 | "Top-of-doc edit reparses O(edited block), not the whole tail" — true for *reparsed lines*, false for *wall-clock* (suffix re-offset is O(tail)) | Medium | RESOLVED-scoped (TW-0004) |
| A3 | `src/core/parser.ts:1521` | Edit inside the **first block** of a doc always falls back to full parse (cut loop starts at k≥1); instrumentation test deliberately edits block 1, not block 0 | Medium | RESOLVED-scoped (TW-0004) |
| A4 | `docs/FEATURES.md:242` | "Zero serious/critical violations" omits the (legitimately scoped, in-file-documented) `color-contrast` rule exclusion | Low | RESOLVED (TW-0004) |
| A5 | `src/core/unified.ts:120`, `TypewrightEditor.tsx:145` | Fence markers computed + tested but unreachable in UI — `isCaretEligible` excludes `codeBlock`, and CaretRevealBlock is their only consumer | Low | RESOLVED-scoped (TW-0004) |
| A6 | `TypewrightEditor.tsx:1303` | "Byte-for-byte unchanged default path" comment is only *behaviourally* true — TW-0003 a11y fixes modified the default block branch (asserted unchanged by e2e) | Low | RESOLVED (TW-0004) |
| A7 | `docs/BENCHMARKS.md:33` | Environment says vitest 3.2.7; repo runs 3.2.6 (all other env details match this machine) — transcription slip | Low | RESOLVED (TW-0004) |
| A8 | `src/core/parser.ts:1479` | `delta === 0` suffix reuse aliases nodes between old/new trees (safe today — trees treated immutable; latent footgun) | Low | RESOLVED (TW-0004) |

## Issue detail

### A1 — Stale benchmark publication contradicts shipped code (High)
Spec success criterion (`spec-TW-0003.md:92-94`): reparse bounded **and** "large-doc keystroke re-measured"; plan AC (`plan-TW-0003.md:106`): "@mid number is re-measured and improved."
The tightening is REAL: `tryReuseSuffix` (`parser.ts:1439-1483`) bounds the reparse, proves the join at a blank-line boundary, re-offsets the suffix (`shiftBlock`, `parser.ts:1364-1373`), falls back safely on open constructs (`:1557-1569`), is unconditionally invoked (`:1541`), instrumented (`reparsedToLine`/`reusedSuffixBlocks`, `:1279-1281`), oracle-tested deep-equal (`parser.incremental.test.ts:194-260`), and wired to real keystrokes (`TypewrightEditor.tsx:1533`).
But `BENCHMARKS.md` §2 (last touched pre-tightening at `c0095e9`) still publishes: `@mid reparses lines 9,168→18,317` (`:110-111`), "34 ms floor … reparses from the edit to end-of-document" (`:121-124`), and "Future work: bound the reparse span … Tracked, not yet done" (`:130-134`). Current code on the same workload reparses `9,168→9,170` (probe, §A2 below). `FEATURES.md:120` repeats the stale "reparses to end-of-document … tracked roadmap work" while `FEATURES.md:240` says "Reparse-span tightening — **shipped** … See BENCHMARKS.md" — pointing at a doc that denies it.
**Resolution shape:** re-run the incremental bench on the branch, rewrite `BENCHMARKS.md` §2 + verdict table + "1 MB miss" narrative and `FEATURES.md` §10 with the new numbers (including the honest A2/A3 caveats below).

### A2 — "O(edited block)" wall-clock overclaim (Medium)
Reparsed *lines* are bounded (3 lines for a 1-char edit), but `shiftBlock` `structuredClone`s + offset-walks every reused suffix block, so total work scales with the tail. Orchestrator probe (tsx, best-of-7, 1 MB fixture, current branch): full parse 268.6 ms; edit @5% → 182.0 ms (reparsed 925→927, 5,811 suffix blocks re-offset); @50% → 83.7 ms; @95% → 12.8 ms. So a near-top edit is faster than full parse (an investigator's stricter probe measured it at ~parity under different conditions) but only ~1.5× — nowhere near "O(edited block)". Ratios, not absolute ms, are the signal (tsx overhead inflates both sides).
**Resolution shape:** either reword `FEATURES.md:240` to "reparse span is O(edited block); suffix re-offset still scales with the tail", or make the re-offset lazy/in-place to earn the claim.

### A3 — First-block edits get no benefit (Medium)
`runIncremental`'s reuse-cut loop starts at `k >= 1` (`parser.ts:1521`) because `headSafety` needs a preceding block, so any edit inside block 0 (e.g. the doc's H1) returns a full parse — empirically confirmed (`fellBack:true`, 160/160 lines). The "top-of-doc edit reparses ≤4 lines" test places the edit in block 1 (`parser.incremental.test.ts:369,432`). Correct, just weaker than the prose implies.
**Resolution shape:** either support cut=0 (reuse nothing left, prove the join right of block 0), or state the boundary honestly in FEATURES/BENCHMARKS.

### A4–A8 — Low items
- **A4:** the `color-contrast` exclusion is legitimate (spec assumption `spec-TW-0003.md:129`, plan step 7, documented in `e2e/a11y.spec.ts:11-19`) — but `FEATURES.md:242`'s "zero serious/critical violations" should carry the one-clause caveat.
- **A5:** fence marker ranges (`unified.ts:120-143`, offset-exact tests) never reach a user: code blocks are not caret-eligible. Blockquote markers ARE live. The W1 claim is true of the core function; note the UI boundary or make fences eligible later.
- **A6:** default block path was touched by TW-0003's own a11y fixes (`withA11yHints`, conditional `role="button"`, widened comment selectors); e2e `caret-reveal.spec.ts:287-306` asserts the behaviour survived. Soften the comment to "behaviourally unchanged".
- **A7:** fix the vitest version string when A1's rewrite happens.
- **A8:** clone the suffix on `delta === 0` too, or comment the aliasing invariant.

## What's genuinely REAL (confirmed producers)

- **Caret-level reveal (spec item 1) — fully real, 0 mock/authored across all 7 claim areas.** `unifiedReveal` additive in `types.ts:287` (git-diff verified: 14 insertions, 0 deletions); gate at `TypewrightEditor.tsx:1306` → `CaretRevealBlock` (`:1935-1940`); per-marker hide/reveal via `hiddenMarkers` (`CaretRevealBlock.tsx:194`, class toggles `:346-352` — not a block flip); DOM edits → `{from,to,insert}` splices through the same `commitValue`/`DocChange` path as TableGrid (`TypewrightEditor.tsx:1615-1625`), so folds/comments/incremental parse ride along; composition suppress/commit (`:613-627`) + blur flush; 40 ms click-settle (`:369,:565-574`); no `innerHTML` — DOM built from text nodes (`:307-339`), `safeUrl` links, images text-only; `role="textbox"`/`aria-multiline`/`aria-label` (`:678-681`); offset mapping walks hidden marker text nodes with source widths (`:200-274`). 16 behavioural unit tests; **10** e2e (claim said 8 — undercount), incl. CDP IME (`Input.imeSetComposition`→`insertText` round-trip), click-caret-no-corruption, per-marker visible/hidden, default-mode restore. All 7 acceptance-review fixes located in code (commits `14845ba`, `47bbf50`). Reachable from public API and the demo toggle (`demo/main.tsx:273,316`).
- **CM6 baseline (item 2) — real and reproduced.** `bench/cm6-baseline.bench.ts:56-176`: genuine `@codemirror/lang-markdown` 6.5.0 / codemirror 6.0.2 parse over the identical fixtures; clean-skip guard when devDeps absent; deps in `devDependencies` only, `dependencies` key absent, peers untouched (git-diff verified). `BENCHMARKS.md` §5 numbers reproduced live for small/medium (0.237 vs 0.827 ms; 2.41 vs 10.53 ms); 1 MB row direction confirmed (plausible-but-GC-fragile magnitude); batch-not-INP caveat present.
- **a11y sweep (item 3) — real, re-run 9/9.** `e2e/a11y.spec.ts` uses `@axe-core/playwright`; every surface genuinely driven open before its scan (mode buttons clicked, caret toggle checked + surface awaited, palette keyboard-opened, settings/fold/comments opened with visibility assertions); hard `expect([]).toEqual` on serious/critical; single documented exclusion. Both claimed fixes are component-side (`TypewrightEditor.tsx:156-158,172,1940-1945`) and exercised by the sweep (demo doc contains task items + links).
- **Reparse tightening (item 4) — code real** (see A1 detail; only the *publication* is the gap).
- **Constraints:** zero runtime deps in `src/` (only `react` peer + test-file `vitest`); `types.ts` semver-additive; v0.2.1 bump consistent; FEATURES/README caret+CM6+a11y flips accurate with honest IME-boundary notes.

## Scope honesty

- Deep-IME (CJK candidate window, dead keys, soft keyboards) not manually exercised — the spec itself scopes this as the documented coverage boundary; e2e CDP composition is the verified extent.
- Bench absolute numbers were reproduced on this machine under noise; 1 MB CM6 ratio magnitude not tightly reproduced (direction confirmed).
- The `pnpm size` gate and demo manual pass were not re-run in this audit (build + all tests were).

## Changelog

- 2026-07-07 — Initial audit (4 investigators + orchestrator probe + fresh gates). A1–A8 OPEN.
- 2026-07-07 — **A1–A8 closed via TW-0004** (spec/plan `docs/{specs,plans}/*-TW-0004.md`), on branch `ai/tw-0002` (local, unmerged). Commits: A8 clone-fix + tests in `parser.ts`/`parser.incremental.test.ts`; A6 comment in `TypewrightEditor.tsx`; bench `@top` workload + honest header in `cold-parse.bench.ts`; docs rewrite in `BENCHMARKS.md`/`FEATURES.md`.
  - **A1 (RESOLVED):** re-ran `pnpm bench` on the branch and rewrote `BENCHMARKS.md` §1/§2/§5 + §3 size table from one consistent run; deleted the "Future work / not yet done" contradiction. The stale "reparses to end-of-document / 9,168→18,317" text is gone — the stats table now shows the **2-line** bounded span (1 MB @mid `9,168→9,170`, @top `925→927`, @end `17,954→17,956`). `FEATURES.md` §10 + Progress item 2 now agree with it.
  - **A2 (RESOLVED-scoped):** the "O(edited block)" claim is reworded to the reparse **span**; the O(tail) suffix-re-offset wall-clock cost is published honestly, including the measured finding that a **near-top edit is ~0.8× (slower) than a full parse** at all sizes (1 MB @top 52.5 ms vs 44.2 ms). @mid is a genuine ~1.45× (1 MB) / ~1.6× (50 KB) win. Making the re-offset lazy remains roadmap (net-new perf work, not a provenance gap).
  - **A3 (RESOLVED-scoped):** the block-0 full-parse boundary is now pinned by a test (`parser.incremental.test.ts` — asserts `fellBack:true`, `reparsedFromLine:0`) and documented in `BENCHMARKS.md` §2 / `FEATURES.md` §10. Supporting a block-0 cut is roadmap.
  - **A4 (RESOLVED):** `FEATURES.md` item 4 now carries the colour-contrast host-scope caveat.
  - **A5 (RESOLVED-scoped):** the fence-marker UI boundary (computed + tested in core, not caret-eligible) is documented in `FEATURES.md` coverage boundaries. Surfacing fences in the caret view is a net-new feature, out of scope.
  - **A6 (RESOLVED):** the "byte-for-byte" comment is softened to "behaviourally unchanged" and now names the a11y touch to the block branch.
  - **A7 (RESOLVED):** `BENCHMARKS.md` environment block reads vitest **3.2.6** (verified `vitest/3.2.6` on the wire).
  - **A8 (RESOLVED):** `tryReuseSuffix` always clones the reused suffix (removed the `delta === 0 ? rest` alias); a new test asserts no reparsed suffix node shares object identity with `prev`, even at delta 0.
  - **Verification:** typecheck ✓ · unit 334 (incl. +2 new) ✓ · build ✓ · size ✓ (core 13.20 KB < 14 KB) · e2e 58 green twice. Numbers reproducible via `pnpm bench` on `ai/tw-0002`.
