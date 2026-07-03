# Contributing to Typewright

Thanks for your interest! Typewright is being built **spec-first** — read [SPEC.md](./SPEC.md) before proposing engine changes, and open an issue to discuss design before large PRs.

## Development

```sh
pnpm install
pnpm typecheck   # tsc --noEmit
pnpm build       # tsup → ESM + CJS + d.ts
pnpm dev         # watch build
```

- **Node ≥ 18, pnpm.**
- **TypeScript strict**, `noUncheckedIndexedAccess`, no `any` (use `unknown` + narrowing).
- **Zero runtime dependencies in the engine.** The only conceded dependency boundary is the MDX JSX/TS→JS transform (see [SPEC.md §7](./SPEC.md#7-mdx-the-markupexecution-split)); do not add others to the core.
- **React stays out of the per-keystroke hot path** — it is a peer, used only for widget islands.
- Keep the public type surface (`src/types.ts`) the source of truth for the API; it is versioned semver.

## Where things are going

The engine is landing in phases (see [SPEC.md §15](./SPEC.md#15-roadmap)). The current tree is the spec, the API contract, and a scaffold; the `<textarea>` placeholder is replaced as phases land. Good first areas once Phase 0/1 exist: parser conformance cases (GFM/MDX), benchmark workloads, and anticipation-policy tuning.

## Conduct

Be kind and constructive. Assume good faith.
