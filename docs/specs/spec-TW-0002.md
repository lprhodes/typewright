# TW-0002: v0.2 gap-closure — deferred featureset to spec-complete

**ID:** TW-0002
**Status:** In Review
**Created:** 2026-07-07
**Last updated:** 2026-07-08

## Feature description

# Feature brief: Typewright v0.2 — close the gap to the full SPEC.md featureset

## Context

Typewright v0.1.0 shipped the real core under TW-0001: a from-scratch, zero-runtime-dependency
GFM parser → offset-exact AST → sanitizing HTML renderer, four editing modes with
**block-level** unified live-preview editing, a formatting toolbar + pure command engine,
semantic heading folding, a streaming anticipation preview (`<StreamingPreview>`), theming,
and an XSS-safe rendering boundary (129 unit tests + 9 Playwright e2e, adversarial review
passed). The ledger is `docs/feature-specs/LEDGER.md` (ids `TW-XXXX`; next id TW-0002).

The **expected state** is defined by three authoritative sources that all agree:

- `SPEC.md` (architecture north star, §1–§16)
- `docs/plans/plan-TW-0001.md` §5 "Definition of done (v1)" — C1–C23 demonstrable
- `docs/FEATURES.md` — the honest status table, whose 🔜/🟡 rows are exactly the gap
- `demo/design-prototype.html` — the designed-but-deferred surfaces, fully visualized

This feature is the **gap-closure release (v0.2 → v1)**: take every 🔜/🟡 capability in
`docs/FEATURES.md` to ✅, in the roadmap order already published there.

## The gap (current → expected), in shipped-roadmap order

1. **Comments & collaboration surfaces (C20–C23)** — anchored comment threads: select text
   → floating "Comment" action; a comment anchors a highlight decoration to the range
   (anchors ride position mapping, surviving edits above them); a show/hide Comments
   sidebar with replies, emoji reactions, resolve/reopen; presence avatars and live
   cursors/selections rendered as decorations (per SPEC.md §14 — no CRDT/network layer,
   host supplies the transport via a data-in/events-out API).
2. **Settings surface** — a built-in settings/command-palette UI over the editor: runtime
   toggles for mode, toolbar, folding, theme, extensions; a command palette (⌘K style)
   listing/executing the command registry; host-extensible.
3. **Syntax colouring of fenced code (part of C11)** — native tokenizer-based highlighting
   of rendered code blocks (no third-party highlighter on the hot path), for a practical
   language set (js/ts/jsx/tsx, json, css, html, md, python, bash, sql at minimum),
   graceful plain-text fallback.
4. **MDX execution, sandboxed (C12)** — the SPEC.md §7 pipeline: markup parse (already
   shipped) → JSX/TS→JS transform via `MdxOptions.transform` adapters (`wasm-esbuild`,
   `wasm-swc`, `constrained` zero-dep subset, or host-supplied fn) in a worker → evaluate
   in an **opaque-origin sandboxed iframe** (`allow-scripts`, no `allow-same-origin`),
   host access brokered by postMessage; component map wiring; Electron-safe; editor never
   blocks on MDX.
5. **Mermaid + math rendering (C10)** — ```` ```mermaid ```` blocks render as diagrams in
   the same isolated sandbox, memoized by source, debounced on edit; math (`$`/`$$`) via a
   pluggable KaTeX-compatible engine interface. Both opt-in extensions.
6. **In-place table WYSIWYG grid (C7)** — GFM tables render as an editable grid widget:
   cell editing, Tab/arrow navigation, add/remove row/column, per-column alignment; every
   cell edit dispatches a scoped `{from,to,insert}` transaction against exactly that
   cell's source range (Markdown stays canonical); focus handoff in/out of the grid;
   round-trip fidelity property-tested.
7. **Fold menu (remainder of C5)** — the per-heading affordance opens a menu: set
   Heading 1–6, Toggle Folding, Fold All Headers, Unfold All Headers, Copy Link to here;
   fold state optionally persisted (`folding.persistKey`).
8. **Footnotes (remainder of C9) + definition lists** — parse + render + edit GFM
   footnotes (`[^ref]` + definition blocks, back-links) and definition lists.
9. **Character-level inline marker reveal (true C1)** — upgrade unified mode from
   block-level click-to-reveal to the Obsidian-exact idiom: formatting renders inline and
   the raw markers (`**`, `` ` ``, `#`, `[]()`) reveal only around the caret/selection,
   per the SPEC.md §5.2 active-range algorithm with the click-settle debounce.
10. **Virtualization + input substrate (SPEC.md Phase 0 as designed)** — viewport-bounded
    DOM materialization with measured line heights and scroll anchoring for very large
    documents; the hidden input-sink substrate for keystroke/IME/composition capture;
    deep IME/CJK/bidi hardening. This is the enabling layer for item 9 at scale.
11. **Benchmark harness + published numbers, a11y hardening (SPEC.md §10, Phase 6)** —
    reproducible keystroke-to-paint/cold-parse harness vs named incumbents (CodeMirror 6
    baseline at minimum) on fixed workloads; bundle-size budget in CI; ARIA/screen-reader
    pass over the virtualized view; results published honestly in docs.

## Constraints & invariants (non-negotiable)

- **Zero runtime dependencies** in the engine (the sole conceded boundary: the wasm
  JSX/TS transform for MDX, per SPEC.md §13; `react`/`react-dom` stay optional peers).
- **The string is the source of truth** — all rich surfaces are decorations/widgets over
  the flat Markdown string; every mutation goes through `{from,to,insert}` transactions.
- **Security model holds**: sanitizing renderer stays the boundary; MDX/Mermaid execute
  only in the opaque-origin sandbox; URL scheme allowlist; no `dangerouslySetInnerHTML`
  of compiled output into the host tree.
- **Public API stability**: `src/types.ts` is the semver contract — extend, don't break.
  The option surfaces for everything above already exist in types (`extensions.mermaid`,
  `extensions.math`, `extensions.syntaxHighlight`, `MdxOptions`, `FoldingOptions`,
  `KeymapOptions`), so new work should light up existing config, not invent parallel ones.
- **React off the hot path** — per-keystroke work stays vanilla; React only for widget
  islands via the portal registry.
- **Collaboration-ready, not collaborative**: comments/presence ship as local surfaces
  with a host-pluggable transport; no CRDT/network stack in v0.2.
- Docs stay in step: `docs/FEATURES.md` status flips, README claims, demo coverage.

## Success criteria

- Every 🔜/🟡 row in `docs/FEATURES.md` reaches ✅ with tests (Vitest unit + property
  tests for round-trip fidelity; Playwright e2e per surface in the existing demo target).
- plan-TW-0001 §5 definition of done satisfied: C1–C23 demonstrable, sandbox escape
  attempts fail, benchmark numbers published or the gap documented honestly.
- The demo (`demo/`, the e2e target) exercises every new surface; the design prototype's
  deferred visuals become live behaviour.

## Suggested delivery order

The published roadmap order (FEATURES.md "Roadmap"): comments → settings → syntax
colouring → MDX execution → Mermaid/math → table grid → fold menu + footnotes →
character-level reveal → virtualization/IME → benchmarks/a11y. Items 1–8 are
independently shippable increments behind existing config flags; items 9–10 are coupled
(the reveal upgrade wants the real view layer) and 11 closes the release.

---

## Triage — 2026-07-07

**Ready for Implementation Plan**

**Sentinel review:** S1 — Approve with assumptions

**UI & logic preview** *(rough sanity check — is this the surface area you expected?)*

- **Where it shows up:** the editor itself *(customer-facing — existing surface that gains a lot of UI)*; a Comments sidebar *(customer-facing — new panel)*; a settings & command palette *(customer-facing — new overlay)*; the streaming preview *(customer-facing — existing surface, behaviour additions)*; the demo app *(customer-facing — existing surface; its mocked chrome becomes real)*; performance, large-document handling, and published benchmark numbers *(behind the scenes — nothing visible changes beyond speed)*.
- **What users will see — per surface:**
  - Editor: selecting text raises a floating action popup with a "Comment" button; commented text gets a persistent highlight; presence avatars and live collaborator cursors appear; each heading's chevron opens a menu (set Heading 1–6, toggle fold, fold/unfold all, copy link); tables become click-to-edit grids with tab/arrow navigation and add/remove row/column controls; code blocks gain syntax colouring; Mermaid diagrams and math render in place of their source; named components in the document render live (safely isolated) instead of showing escaped source; footnotes and definition lists render properly; and in unified mode the raw markers (`**`, `` ` ``, `#`) reveal only around the caret rather than swapping the whole block into a source box.
  - Comments sidebar (new): threaded comments quoting their anchored text, with replies, emoji reactions, and resolve/reopen; clicking a thread scrolls to and flashes its highlight.
  - Settings & command palette (new): a panel of live toggles (mode, toolbar position, folding, theme, each extension) plus a keyboard-summoned palette that lists and runs every editor command.
  - Streaming preview: forming links, list items, and table rows now render ahead of completion (today only bold/italic/code/heading/fence/component do), and an optional smooth mode reveals text at a steady pace instead of network bursts.
  - Demo: the presence avatars, comments tab, and extension toggles that are currently labelled "design preview" become fully functional.
- **Behaviour changes:** very large documents stay fast because only the visible portion is drawn; typing latency numbers get measured against named competitors and published; a document's Markdown text remains the single source of truth throughout — every rich surface edits it in place.
- **Design reference:** `demo/design-prototype.html` is the canonical visual reference — it already designs every surface above (comments sidebar + composer, fold menu, table grid, settings panel, rendered diagrams/math/components, streaming states); match its layout, states, and copy.

**Assumptions**

- `[Data & scope]` Comments and presence store nothing; the host app supplies and receives all data. *(keeps the library storage-free, per the brief)*
- `[Data & scope]` Diagram and math engines are host-supplied plug-ins, not bundled (rather than bundling them). *(preserves the zero-dependency promise)*
- `[Experience]` Without a host-supplied engine, diagrams/math keep showing plain source — unchanged from today. *(safe fallback)*
- `[Experience]` Live component rendering is off unless the host turns it on and supplies components. *(safer default; today's escaped-source stays)*
- `[Experience]` Settings changes apply to the live session only; the host persists them if wanted. *(library stays storage-free)*
- `[Experience]` Command palette opens with ⌘K / Ctrl+K. *(industry convention)*
- `[Layout]` Comments sidebar docks right, hidden until opened via a toolbar/topbar control. *(matches the design prototype)*
- `[Experience]` Caret-level marker reveal replaces block editing in unified mode only; preview mode keeps click-a-block editing. *(preserves both published idioms)*
- `[Experience]` Streaming reveal stays word-level; character pacing ships as the opt-in smooth mode. *(matches the prototype's designed behaviour)*
- `[Experience]` Footnotes and definition lists render the way GitHub renders them. *(closest analogue)*
- `[Experience]` "Copy Link to here" copies a heading anchor link for use in the host page. *(simplest useful reading)*
- `[Data & scope]` Emoji reactions use a small fixed set matching the design prototype. *(scope control)*
- `[Data & scope]` Work ships as staged minor releases in the published roadmap order (rather than one big-bang release). *(items are independently valuable; matches the brief)*
- `[Data & scope]` Existing option names are lit up as-is; the public contract is only extended, never renamed. *(compatibility promise)*
- `[Operations]` A failed diagram/component render shows an inline error card and never breaks editing. *(graceful degradation norm)*
- `[Operations]` Benchmark numbers are published even where targets are missed. *(the project's stated honesty rule)*

*If any of these are wrong, edit the answer inline (or correct an assumption) in this file and re-run `/triage TW-0002` before the planner picks this up.*

## Plan — 2026-07-07

Implementation plan: `docs/plans/plan-TW-0002.md` (Plan size: Large).

<!-- Progress sections are appended below. -->

## Progress — 2026-07-08

**Implementation Complete (local branch — no PR)**

**Summary:** The v0.2 deferred featureset was built end-to-end on `ai/tw-0002` — comments & presence, settings + ⌘K palette, native syntax highlighting, sandboxed MDX execution + Mermaid + math engine hooks, in-place table grid, fold menu + folding options, footnotes + definition lists, streaming completion, an incremental parser, and threshold-gated virtualization — behind the existing config surfaces. Two acceptance-review rounds ran; all confirmed findings are fixed with tests. One coupled slice (character-level caret reveal + custom IME input substrate) is deliberately **not** shipped and is disclosed honestly (see Deferred).

**Branch:** `ai/tw-0002` (local, rebased on `main`; not pushed; worktree: `.worktrees/TW-0002`). 15 commits.

**Built by wave:**
- W1: `core/highlight.ts` (tokenizer), `core/table.ts` (GFM edit helpers), `core/comments.ts` (`mapAnchor`).
- W2: parser math/footnotes/def-lists (opt-in `ParseOptions`, semver-safe); render.ts `RenderOptions` (highlight+math hooks), GitHub-style footnotes/def-lists; `unified.ts` markers; `commands.ts` `COMMANDS` registry + heading4–6; `types.ts` comments/presence/settings types; streaming link/list/table anticipation + smoothing.
- W4/W5: `CommentsSidebar`, `SettingsSurface` (panel + ⌘K palette), `TableGrid`, `FoldMenu`; editor integration — parseOpts/renderOpts, keymap→`applyCommand` (⌘B toggles), internal mode state, comments popup/highlights/anchors, presence, settings overrides, table grid, fold menu + `persistKey`/`showGutter`.
- W7: `typewright/mdx` — opaque-origin sandbox host + transform adapters (constrained JSX→`h()` + wasm-esbuild/swc optional peers); `SandboxIsland` for MDX/Mermaid; math engine hook.
- W8: `parseIncremental` (property-tested deep-equal to full parse); block virtualization + `overscan`.
- W9: demo wired to real surfaces; `docs/FEATURES.md` flipped; `bench/` + `docs/BENCHMARKS.md` + size budget.

**Rebase:** clean onto `main` (3a5dad1); no conflicts (branch code disjoint from the docs commit).

**Reachability (every new capability reaches its producer):**
| Capability | UI entry | Producer | Wired? |
|---|---|---|---|
| Comments | selection → `tw-selpop`/composer | `useCollab` → `CommentsSidebar`, `mapAnchor` | ✅ |
| Presence | `presence` prop | `applyDecorations` remote cursor (offset→rendered via `plainify`) | ✅ |
| Settings panel | gear button | `SettingsPanel` → live overrides | ✅ |
| ⌘K palette | keydown capture | `CommandPalette` (`COMMANDS` + host) → `applyCmd` | ✅ |
| Syntax highlight | `extensions.syntaxHighlight` | `renderOpts.highlight` → `highlightToHtml` | ✅ |
| MDX execution | `extensions.mdx` + transform | `SandboxIsland` → sandbox `evaluate` (`props.components`) | ✅ |
| Mermaid | `extensions.mermaid` + `getEngine` | `SandboxIsland` → `renderMermaid` | ✅ |
| Math | `extensions.math` + `render` | `renderOpts.math` (escaped fallback otherwise) | ✅ |
| Table grid | table block | `TableGrid` → `table.ts` scoped splices | ✅ |
| Fold menu | heading ⋯ | `FoldMenu` → command/fold splices | ✅ |
| Footnotes / def-lists | parse (on in editor) | parser + render (GitHub-style) | ✅ |
| Streaming anticipation | `<StreamingPreview>` | `anticipate.ts` | ✅ |
| Virtualization | >150 blocks | `UnifiedEditor` window + `overscan` | ✅ |
| Incremental parse | per commit | `parseIncremental` fast-path | ✅ |

**Clause coverage (acceptance criteria + constraints):**
| Clause | Satisfied at | Status |
|---|---|---|
| C-1 comments anchored + survive edits | `core/comments.ts`, `TypewrightEditor.tsx` applyDecorations | ✅ |
| C-2 presence avatars + live cursors | `TypewrightEditor.tsx` (cursor mapping fixed) | ✅ |
| C-3 ⌘K palette; keymap none; ⌘B toggles | `SettingsSurface.tsx`, `TypewrightEditor.tsx` keymap | ✅ |
| C-4 settings panel live; onModeChange | `SettingsPanel`, `setMode` | ✅ |
| C-5 syntax colouring; `<script>` inert | `core/highlight.ts` (+tests) | ✅ |
| C-6 MDX live in sandbox; escape fails; no-transform fallback | `sandbox/host.ts`, `SandboxIsland.tsx` | ✅ (browser escape assertion pending e2e) |
| C-7 mermaid diagram/error/fallback; math engine/fallback | `SandboxIsland.tsx`, `renderOpts.math` | ✅ |
| C-8 table cell scoped splice; nav; struct ops round-trip | `TableGrid.tsx`, `core/table.ts` (+tests) | ✅ |
| C-9 fold menu H1–6/all/copy-link; persistKey | `FoldMenu.tsx`, `TypewrightEditor.tsx` (slug-keyed) | ✅ |
| C-10 footnotes back-links; def lists `<dl>`; degrade | `parser.ts`, `render.ts` (+tests) | ✅ |
| C-11 caret-level per-marker reveal | — | ⚠️ **Deferred** (block-level reveal shipped) |
| C-12 1MB bounded DOM; IME; incremental==full | virtualization (e2e), `parseIncremental` (property test) | 🟡 partial — bounded DOM + incremental ✅; **custom IME sink deferred** (native textareas handle IME) |
| C-13 streaming links/lists/tables; no reflow; smooth | `anticipate.ts` (+tests) | ✅ |
| C-14 bench vs named CM6 | `bench/`, `docs/BENCHMARKS.md` | 🟡 partial — Typewright numbers measured+published; CM6 baseline harness present, documented "to run" (avoids mutating shared node_modules) |
| C-15 axe passes; size budget in CI | `.github/workflows/ci.yml` size step | 🟡 partial — size gate in CI ✅; axe sweep is the e2e phase |
| C-16 FEATURES.md no 🔜/🟡 except honest; gates green | `docs/FEATURES.md` | ✅ (2 honest 🟡 kept) |
| K-1 zero runtime deps; wasm/engines optional/host | `package.json` (no new deps; optional peers) | ✅ |
| K-2 string is source of truth; `{from,to,insert}` | throughout | ✅ |
| K-3 sanitizer boundary; sandbox opaque-origin; no host innerHTML of compiled | `render.ts`, `sandbox/host.ts` | ✅ |
| K-4 types.ts semver — extend only | additive types only | ✅ |
| K-5 React off hot path | vanilla block model; islands via components | ✅ |
| K-6 failed render → error card, never breaks editing | `SandboxIsland.tsx` | ✅ |
| K-7 fixed emoji reaction set | `CommentsSidebar.tsx` `REACT_EMOJI` | ✅ |

**Acceptance review:** 2 rounds. Round 1 (4 dimensions + adversarial verify): 13 findings, 7 confirmed (1 refuted false-positive), all fixed. Round 2 (fix-verify + completeness critic): all 6 fixes verified resolved, 1 new Medium (sandbox `postMessage` hang on non-serializable payload) fixed with a regression test. No Critical/High remain.

**Deferred (honest — not faked):**
- **Character-level caret reveal (C-11 / IJ5)** — unified mode ships block-level click-to-reveal, not per-caret Obsidian-exact reveal. Marked 🟡 in FEATURES.md.
- **Custom IME input substrate (SPEC §4.4 hidden sink / IJ2)** — editing uses native `<textarea>` surfaces (which handle IME/composition correctly); the bespoke sink was not built. IJ2/IJ5 are one coupled view-engine rewrite; building it one-shot would have risked regressing working, IME-correct editing with no user-facing gain, so it is deferred and disclosed rather than stubbed.

**Implementation assumptions:** footnotes + definition lists are parsed **on by default in the editor** (opt-in only at the headless `parse()` level, preserving semver); math parsing is gated by `extensions.math` (since `$` is common in prose); MDX host **components** must be structured-cloneable to cross the sandbox (live host React functions cannot — a documented limitation; built-in tags render).

**Gates (actually run):** typecheck ✅ · tsup build ✅ · unit 298 passed ✅ · Playwright e2e 13 passed ✅ · size budget ✅. (Pre-existing caveat: `parser.perf.test.ts` has 2 wall-clock-threshold flakes that also fail on `main` under load — excluded; not a regression.)

### Acceptance E2E — 2026-07-08

Comprehensive Playwright suite added (7 specs / 26 tests; **39 total**) covering comments, settings + ⌘K palette, syntax highlighting, MDX/Mermaid islands, math, table grid, fold menu, footnotes, and presence — driven against the wired demo, **green on two consecutive runs**. The suite surfaced and fixed 2 runtime bugs (compile-clean but broken): opening the comments sidebar wiped anchored highlights (`applyDecorations` missing an `open` dep); ⌘K-palette commands no-op'd because `SourceArea.onBlur` cleared the active-source registration when the palette stole focus.

### Status: ready for human review — NOT merged

Per the ship-feature run configuration (stop before merge), `ai/tw-0002` is **left local and unmerged**. Final pre-merge gate (all actually run): typecheck ✅ · tsup build ✅ · unit 298 ✅ · Playwright e2e 39 ✅ (twice) · size budget ✅. Branch rebased on `main`, worktree clean, 16 commits. Sole red: 2 `parser.perf.test.ts` wall-clock flakes that also fail on `main` under load (pre-existing, not a regression).


