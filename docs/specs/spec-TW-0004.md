# TW-0004: Close TW-0003 audit gaps (benchmarks honesty + low fixes)

**ID:** TW-0004
**Status:** In Review
**Created:** 2026-07-07
**Last updated:** 2026-07-07
**Depends on:** TW-0003 (`ai/tw-0002`, unmerged) — builds on that branch.

## Feature description

Close the TW-0003 spec-validation audit gaps (all 8: A1 High, A2–A3 Medium, A4–A8 Low) from docs/audits/spec-TW-0003-validation-2026-07.md — re-measure and republish the incremental-reparse benchmarks (BENCHMARKS.md §2 + FEATURES.md §10), correct the O(edited block) wall-clock overclaim, handle/document the block-0 full-parse fallback, add the color-contrast caveat to FEATURES.md:242, resolve unreachable fence markers, soften the byte-for-byte comment, fix the vitest version typo, and remove the delta===0 suffix aliasing footgun. Work continues on branch ai/tw-0002 (worktree .worktrees/TW-0002).

---

<!-- Triage, plan link, and progress sections are appended below. -->

## Triage — 2026-07-07

**Ready for Implementation Plan**

**Sentinel review:** S1 — Approve with assumptions

**UI & logic preview** *(rough sanity check — is this the surface area you expected?)*

- **Where it shows up:** **Nothing customer-facing changes.** The published performance write-up and the feature checklist *(developer-facing docs — existing pages get corrected)*; the editing engine internals *(behind the scenes — one small safety hardening, no visible change)*.
- **What users will see — per surface:**
  - Performance write-up: fresh, re-measured speed numbers for typing in very large documents, replacing figures from the older engine; the "still to do" note that contradicts the shipped work is removed; honest boundary notes added (editing the very first paragraph of a huge document is the one slow case; total work for edits near the top still grows with document size; one measurement-environment typo fixed).
  - Feature checklist: the accessibility claim gains its one-line caveat (colour-contrast is the host app's theme choice); the large-document speed claim is reworded to match what was actually measured; the raw-marker reveal entry notes that code-block fences are covered by the underlying logic but not yet surfaced in the editing view.
- **Behaviour changes:** none visible. One internal hardening removes a latent risk where two document versions could silently share pieces after a same-length edit.

**Assumptions**

- `[Data & scope]` Speed docs are corrected to measured reality; making top-of-document edits faster is roadmap work, not this fix. *(honesty gap, not a speed regression; rework is risky mid-review)*
- `[Data & scope]` First-paragraph slow case is documented as a known boundary (rather than engineering it away now). *(rare case; safer on an in-review branch)*
- `[Experience]` Code-block fence reveal stays off in the editing view; docs state the boundary (rather than enabling editable code blocks). *(enabling it is a real feature with new risks)*
- `[Data & scope]` Fresh measurements are taken on the same machine class as the existing published numbers, method stated alongside. *(comparable like-for-like figures)*
- `[Operations]` The latent same-length-edit sharing risk is fixed in code, not just documented. *(cheap, invisible, removes a footgun)*
- `[Data & scope]` All work lands on the existing in-review branch as a continuation — one branch, one review. *(same convention as TW-0003)*

*If any of these are wrong, edit the answer inline (or correct an assumption) in this file and re-run `/triage TW-0004` before the planner picks this up.*

## Plan — 2026-07-07

Implementation plan: `docs/plans/plan-TW-0004.md` (Plan size: Standard).

## Progress — 2026-07-07

**Implementation Complete (local branch — no PR)**

**Summary:** All eight TW-0003 audit findings (A1 High, A2–A3 Medium, A4–A8 Low from `docs/audits/spec-TW-0003-validation-2026-07.md`) closed on `ai/tw-0002`. The reparse tightening code was already real; this pass re-measured it and made every published claim match reality, fixed one latent code footgun, and pinned two boundaries with tests. No customer-facing change.

**Branch:** `ai/tw-0002` (local, worktree `.worktrees/TW-0002`; **not pushed, not merged** — continues the TW-0002/TW-0003 "one branch, one review" line). 2 TW-0004 commits (`d26bdea` code, `fb50813` docs) on top of TW-0003's.

**What changed:**
- **A8 (code):** `tryReuseSuffix` always clones the reused suffix (dropped the `delta === 0` alias) so a reparsed tree never shares node identity with `prev`; test asserts zero shared nodes at delta 0.
- **A3 (test):** block-0 edits fall back to full parse — pinned by a test (`fellBack:true`, `reparsedFromLine:0`), documented as a boundary.
- **A6 (comment):** "byte-for-byte" default-path comment → "behaviourally unchanged" (a11y fixes touched the block branch).
- **A1/A2/A7 (docs):** re-ran `pnpm bench`; rewrote `BENCHMARKS.md` §1/§2/§3/§5 from one consistent run. §2 now shows the **2-line bounded reparse span** (1 MB @mid `9168→9170`) replacing the stale reparse-to-EOF text; the "not yet done" contradiction is deleted; the honest O(tail) suffix-re-offset cost is published (near-top edit ~0.8× — slower than full parse; @mid ~1.45×@1MB win); vitest version corrected to 3.2.6.
- **A4/A5 (docs):** colour-contrast host-scope caveat added to the a11y claim; fence-marker UI boundary documented.

**Reachability:** every fix traces to code/producer — the bench numbers come from `bench/cold-parse.bench.ts` (runnable via `pnpm bench`), the boundary claims from `parser.incremental.test.ts` tests, the code fix from `parser.ts:tryReuseSuffix`.

**Known boundaries (roadmap, not gaps):** making the suffix re-offset lazy so early-doc edits beat a full parse, and supporting a block-0 cut, are net-new perf work — the reparse *span* is already bounded; these close the remaining wall-clock gap. Surfacing fence markers in the caret view is a net-new feature.

**Gates (actually run):** typecheck ✅ · tsup build ✅ · unit 334 ✅ (incl. +2 new: block-0 boundary, suffix-clone isolation) · Playwright e2e 58 ✅ **twice** · size ✅ (core 13.20 KB < 14 KB) · `pnpm bench` ✅ (numbers published are reproducible on the branch).

**Audit register:** A1–A8 flipped to RESOLVED / RESOLVED-scoped in `docs/audits/spec-TW-0003-validation-2026-07.md` with a dated changelog.

### Status: ready for human review — NOT merged

Per the stop-before-merge convention, `ai/tw-0002` (now carrying TW-0002 + TW-0003 + TW-0004) is left local and unmerged. No push.
