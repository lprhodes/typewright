# Keystroke-to-paint methodology (INP)

SPEC.md §10 names **keystroke-to-paint latency (INP)** — not Markdown-to-HTML
throughput — as the metric that matters. This file documents how that number is
measured, because it cannot be measured honestly in Node: it requires a real
browser layout + paint, which is why it lives in the Playwright harness (the e2e
phase), not in `vitest bench`.

## What `pnpm bench` covers vs. what it does not

`pnpm bench` (`bench/cold-parse.bench.ts`) measures the **parse component** of a
keystroke on the real fixtures — `parse()` cold and `parseIncremental()` for the
reparse a single inserted character triggers. That is the largest *engine-side*
cost, but it is **not** the full INP: it excludes style recalc, layout, and
paint, which happen in the browser and are dominated by how much DOM the edit
dirties — the exact thing the virtualized view is designed to bound.

So: parse numbers are published from `pnpm bench`; the end-to-end keystroke-to-
paint p95 is published from the browser harness below.

## Browser harness (Playwright)

Method — measure from the input event to the next paint that reflects it:

```ts
// e2e/keystroke.perf.spec.ts (harness — run against the demo at :5178)
const samples: number[] = await page.evaluate(async () => {
  const el = document.querySelector('[data-testid="editor"] textarea, [contenteditable]')!;
  const out: number[] = [];
  for (let i = 0; i < 200; i++) {
    const t0 = performance.now();
    // dispatch a single-character insertion the way the browser would
    document.execCommand?.('insertText', false, 'x');
    // resolve on the paint that includes the change
    await new Promise<void>((r) =>
      requestAnimationFrame(() => requestAnimationFrame(() => r())),
    );
    out.push(performance.now() - t0);
  }
  return out;
});
// report p50 / p95 / p99 of `samples`
```

Notes that keep it honest (SPEC §10):

- **Named workloads.** Drive the three committed fixtures (`bench/fixtures/*.md`,
  5 KB / 50 KB / 1 MB), and edit **mid-document** for the 50 KB case — the exact
  SPEC target row ("50 KB doc, mixed content, mid-document edit", p95 < 8 ms).
- **Double-rAF** is the standard "next paint" proxy; for stricter numbers use the
  Event Timing API (`PerformanceObserver`, `type: 'event'`, `interactionId`) to
  read the browser's own INP attribution instead of a rAF proxy.
- **Bounded DOM assertion** for the 1 MB doc: assert the rendered row count stays
  under a fixed cap while scrolled to mid-document — this is the virtualization
  claim, and it is what makes 1 MB typing viable even though a full reparse of a
  1 MB tail is tens of ms (see the parse table in `docs/BENCHMARKS.md`).
- **Named competitor.** Run the *identical* harness against a CodeMirror-6 +
  `@codemirror/lang-markdown` editor on the same fixtures and the same edit
  script. A speed claim without both a named workload and a named competitor is
  not shippable.

## Status

- Parse component: **measured and published** (`pnpm bench` → `docs/BENCHMARKS.md`).
- End-to-end INP + the CM6 view baseline: **harness specified here, to be run in
  the e2e phase.** Numbers are not asserted until that harness runs in CI against
  both editors, per the honesty rule.
