# TW-0003: Close remaining v0.2 deferred items (caret reveal, CM6 bench, a11y, reparse)

**ID:** TW-0003
**Status:** In Progress
**Created:** 2026-07-08
**Last updated:** 2026-07-08
**Depends on:** TW-0002 (`ai/tw-0002`, unmerged) — builds on that branch.

## Feature description

# Feature brief: TW-0003 — close the remaining TW-0002 deferred items (v1)

## Context

TW-0002 (branch `ai/tw-0002`, unmerged, In Review) shipped the v0.2 gap-closure
featureset but deliberately deferred one coupled slice and left three items
partial. This feature closes them so `docs/FEATURES.md` reaches full ✅ and the
SPEC.md §10/§15 targets are met or honestly documented. **This work builds on
`ai/tw-0002`** (its code strictly depends on TW-0002) and lands on that same
branch — one branch, one review.

## The deferred/partial items to close

1. **Caret-level per-marker inline reveal (C-11 / SPEC §5.2, IJ5)** — the "true C1"
   Obsidian idiom: in unified mode, formatting renders inline and the raw markers
   (`**`, `*`, `` ` ``, `#`, `[]()`) reveal only around the caret/selection, hiding
   elsewhere — rather than swapping the whole block into a raw textarea on click.
   The headless logic (`hiddenMarkers(doc, sel)` in `core/unified.ts`) already
   exists and is tested; this wires it to a live editing surface.

   **Approach (decided): gated + non-regressing.** Ship as an **opt-in** mode
   (e.g. `unifiedReveal: 'caret'` config, default `'block'`). The current
   block-level click-to-reveal stays the **default** and the fallback — it is
   proven and IME-correct, and must not regress. The caret-level surface is a
   **managed `contentEditable`** block: markers render as hide/reveal spans keyed
   to the DOM selection; a short click-settle debounce (~40ms) defers the
   render→raw transition so click caret placement is stable (SPEC §5.2 step 4).
   IME/composition is handled by the platform via `contentEditable` (compose
   events commit to the model on `compositionend`) — **no bespoke hidden input
   sink is built**; that architectural item (IJ2 as literally specified) is
   satisfied at the user-facing level (working IME + caret reveal) via
   contentEditable, and any divergence from the SPEC's exact hidden-sink
   architecture is documented honestly.

2. **CM6 benchmark baseline (C-14 / SPEC §10)** — install `codemirror` +
   `@codemirror/lang-markdown` (+ `@codemirror/state`/`view` as needed) as
   **bench-only devDependencies** (never shipped runtime deps), run the existing
   `bench/cm6-baseline.bench.ts` harness on the same fixtures, and publish the
   real Typewright-vs-CodeMirror-6 comparison numbers in `docs/BENCHMARKS.md`.

3. **Accessibility sweep (C-15 / SPEC §15 Phase 6)** — run `axe-core` (as a
   bench/e2e devDep) across every surface (editor modes, toolbar, comments
   sidebar, settings panel, ⌘K palette, fold menu, table grid) in the Playwright
   suite; fix the violations it surfaces (roles, labels, focus order, contrast
   where in our control). The caret-reveal contentEditable surface must expose
   its content to assistive tech.

4. **Incremental-reparse tightening (SPEC §10, FEATURES roadmap)** — `parseIncremental`
   currently reuses the unchanged block prefix but reparses to end-of-doc; bound
   the reparsed region to the **dirty block(s) + look-around** so a keystroke in a
   1MB doc reparses O(edited block), not O(tail). Keep the property-test oracle
   (deep-equal to full `parse`) green — correctness first; the tighter path only
   ever narrows what is reparsed, never changes the result. Improves the missed
   large-doc keystroke target; re-measure and publish.

## Constraints & invariants (unchanged from TW-0002)

- **Zero runtime dependencies** in the engine; CM6/axe are **bench/test-only
  devDependencies**, never runtime deps or shipped peers.
- **The string is the source of truth**; every mutation a `{from,to,insert}`
  transaction (the contentEditable surface maps DOM edits → source splices).
- **No regression to working editing**: block-level unified mode stays the default
  and remains fully functional; caret-level is additive and opt-in.
- **Sanitizer boundary holds**: the caret-reveal surface renders through the same
  sanitizing path; no `dangerouslySetInnerHTML` of untrusted content; markers are
  the only thing toggled.
- **Public API `src/types.ts` is semver** — extend only (add the reveal option).
- **Honesty**: IME correctness on the new surface is verified as far as e2e can
  drive (caret placement, marker reveal, round-trip typing, basic composition);
  the deep CJK/dead-key/soft-keyboard tail is documented as the coverage boundary,
  not claimed as exhaustively proven.

## Success criteria

- A host can enable `unifiedReveal: 'caret'`; with the caret inside `**bold**` the
  `**` markers show and hide when the caret leaves — per marker, not per block;
  clicking rendered text places the caret at the right spot without a jump; typing
  round-trips to canonical Markdown; the default (block-level) mode is unchanged.
- `docs/BENCHMARKS.md` publishes real Typewright-vs-CM6 numbers on the fixtures.
- axe-core passes (or documented, in-our-control violations fixed) across the
  surfaces in the e2e suite.
- `parseIncremental` reparses only the dirty region (asserted via instrumentation)
  while staying deep-equal to full parse (property test); large-doc keystroke
  re-measured.
- `docs/FEATURES.md` caret-reveal row → ✅ (with the honest IME-architecture note);
  all gates green; the whole thing rides `ai/tw-0002`.

## Out of scope

- The literal SPEC §4.4 hidden-input-sink engine as a separate `src/core/view/`
  module (the user-facing goal is met via contentEditable; a full custom-caret
  rewrite is not warranted and risks the working surface).
- Making caret-level the default (it stays opt-in this release).
- bidi/RTL deep hardening beyond what contentEditable provides.

---

## Triage — 2026-07-08

**Ready for Implementation Plan**

**Sentinel review:** S1 — Approve with assumptions

**UI & logic preview** *(rough sanity check — is this the surface area you expected?)*

- **Where it shows up:** the editor's live-preview mode *(customer-facing — existing surface gains an opt-in behaviour)*; the published performance/benchmark notes and the accessibility of every existing panel *(behind the scenes — nothing new appears, existing surfaces get more correct)*.
- **What users will see — per surface:**
  - Live-preview editing (opt-in): instead of a click turning a whole paragraph into raw text, the raw formatting marks (the `**`, `` ` ``, `#`, link brackets) appear only right around where the cursor is and stay hidden everywhere else — the "reveal as you go" feel. This is off by default; today's click-to-edit-the-block behaviour stays exactly as-is unless a host turns the new mode on.
  - Every existing panel (toolbar, comments, settings, command palette, fold menu, table grid): no visible change, but keyboard/screen-reader access is checked and any gaps fixed.
- **Behaviour changes:** typing in the new reveal mode keeps the document as plain Markdown throughout (same as today); it handles international/compose input through the browser's native text input, so accented and CJK typing work. Large documents stay responsive because a keystroke only re-reads the part of the document that changed.
- **Design reference:** `demo/design-prototype.html` (the unified per-line reveal idiom) is the canonical visual reference for the reveal behaviour.

**Assumptions**

- `[Experience]` Caret-level reveal is opt-in; the current block-level behaviour stays the default. *(user-decided; protects a working surface)*
- `[Experience]` International/compose (IME) input is handled by the browser's native editable surface, not a bespoke input layer. *(gets composition correct for free; avoids reimplementing it)*
- `[Data & scope]` The comparison editor used for the speed benchmark and the accessibility checker are development-time-only tools, never shipped to end users. *(keeps the zero-dependency promise)*
- `[Operations]` Deep edge-case international input (dead keys, some Android keyboards) is validated as far as automated browser tests reach; the remaining tail is documented as the coverage boundary, not claimed as exhaustively proven. *(honesty rule)*
- `[Experience]` Accessibility fixes are limited to what the library itself controls (its own roles/labels/focus order); host-page contrast/theme choices are the host's responsibility. *(scope boundary)*
- `[Data & scope]` This ships on the existing in-review branch as a continuation, reviewed and merged as one unit. *(the code depends on the unmerged predecessor)*

*If any of these are wrong, edit the answer inline (or correct an assumption) in this file and re-run `/triage TW-0003` before the planner picks this up.*

## Plan — 2026-07-08

Implementation plan: `docs/plans/plan-TW-0003.md` (Plan size: Standard).

<!-- Progress sections are appended below. -->
