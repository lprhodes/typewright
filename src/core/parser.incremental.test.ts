import { describe, it, expect } from 'vitest';
import { parse, parseIncremental, parseIncrementalWithStats } from './parser';
import type { Change } from './text';
import type { Document, ParseOptions } from './ast';

/**
 * Correctness oracle for {@link parseIncremental}. The contract is total: for
 * ANY (document, single-edit) pair, the incremental result must be structurally
 * identical (deep-equal, exact offsets) to a full `parse(nextSrc, opts)`. The
 * incremental parser is only ever allowed to be FASTER, never different — so a
 * green run here proves the fast path (and its many fall-backs) are sound.
 *
 * Everything is deterministic: a fixed corpus and a seeded mulberry32 PRNG, no
 * `Math.random` / `Date.now`, so a failure always reproduces.
 */

/* ------------------------------------------------------------------ *
 * Deterministic PRNG (mulberry32) — fixed seed, reproducible forever.
 * ------------------------------------------------------------------ */

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/* ------------------------------------------------------------------ *
 * Corpus — every construct the parser knows, in multi-block documents so the
 * incremental path has real prefixes to reuse. Includes headings, paragraphs,
 * tight/loose/task/ordered lists, blockquotes, fenced + indented code, tables,
 * thematic breaks, HTML/MDX-flow, and (for the opt-in run) math, footnotes and
 * definition lists.
 * ------------------------------------------------------------------ */

const CORPUS: string[] = [
  // 0 — headings + paragraphs + soft breaks
  '# Title\n\nFirst paragraph with **bold** and *em* and `code`.\n\n## Section\n\nA second paragraph\nwrapped over two lines.\n',
  // 1 — a fence surrounded by prose (the hard case)
  'Intro text.\n\n```js\nconst x = 1;\nconst y = 2;\n```\n\nOutro text with a [link](http://x.com).\n',
  // 2 — lists of several kinds
  '- a\n- b\n- c\n\n1. one\n2. two\n\n- [ ] todo\n- [x] done\n',
  // 3 — a loose list + nested content
  '- outer\n\n  still outer\n\n  - inner\n\n- second\n',
  // 4 — blockquotes, nested and with a list
  '> quoted line one\n> quoted line two\n\n> > deeply nested\n\n> - q-list a\n> - q-list b\n',
  // 5 — a GFM table between paragraphs
  'Before the table.\n\n| a | b | c |\n| :- | :-: | -: |\n| 1 | 2 | 3 |\n| 4 | 5 | 6 |\n\nAfter the table.\n',
  // 6 — thematic breaks + indented code
  'Para one.\n\n---\n\n    indented code line 1\n    indented code line 2\n\nPara two.\n',
  // 7 — HTML block + MDX-flow + ESM
  '<div class="x">\nraw html\n</div>\n\n<Callout type="info" />\n\nimport X from "y"\n\nTrailing paragraph.\n',
  // 8 — many small blocks (good reuse depth)
  '# H1\n\np1\n\n# H2\n\np2\n\n# H3\n\np3\n\n# H4\n\np4\n\n# H5\n\np5\n',
  // 9 — math (inert unless the flag is on)
  'Energy is $e=mc^2$ inline.\n\n$$\n\\int_0^1 x\\,dx\n$$\n\nDone.\n',
  // 10 — footnotes (inert unless the flag is on)
  'A claim.[^note]\n\nMore prose here.\n\n[^note]: The footnote body.\n\nTail paragraph.\n',
  // 11 — definition lists (inert unless the flag is on)
  'Intro.\n\nTerm one\n: definition of term one\n\nTerm two\n: first definition\n: second definition\n\nEnd.\n',
  // 12 — mixed everything
  '# Doc\n\ntext\n\n> quote\n\n- item\n- item2\n\n```\ncode\n```\n\n| h |\n| - |\n| v |\n\nlast para\n',
  // 13 — adjacent blocks with NO blank separators (stresses boundary detection)
  '# heading\nparagraph right after\n## another\n- list right after\n> quote right after\nplain tail\n',
  // 14 — trailing/leading blank noise + empties
  '\n\n# Spaced\n\n\n\npara after big gap\n\n\n',
];

/* ------------------------------------------------------------------ *
 * Edit generation.
 * ------------------------------------------------------------------ */

/** Fragments that tend to open/close/merge/split blocks — the interesting ones. */
const FRAGMENTS = [
  '',
  'x',
  'word',
  ' more text',
  '\n',
  '\n\n',
  '\n\n\n',
  '```',
  '```ts\n',
  '\n```\n',
  '# ',
  '## ',
  '- ',
  '- [ ] ',
  '1. ',
  '> ',
  '\n---\n',
  '| a | b |\n| - | - |\n',
  '\n| c | d |',
  '*',
  '**',
  '`',
  '~~',
  '$',
  '$$\n',
  '[^id]',
  '[^id]: note\n',
  '\n: def\n',
  '[link](u)',
  '<Comp />',
  '    indented',
  'end.',
];

interface EditCase {
  src: string;
  change: Change;
  nextSrc: string;
  label: string;
}

function makeChange(src: string, from: number, to: number, insert: string): EditCase {
  const f = Math.max(0, Math.min(from, to, src.length));
  const t = Math.max(f, Math.min(Math.max(from, to), src.length));
  const nextSrc = src.slice(0, f) + insert + src.slice(t);
  return { src, change: { from: f, to: t, insert }, nextSrc, label: `[${f},${t})+${JSON.stringify(insert)}` };
}

/** All indices where `needle` occurs in `hay`. */
function allIndicesOf(hay: string, needle: string): number[] {
  const out: number[] = [];
  let i = hay.indexOf(needle);
  while (i !== -1) {
    out.push(i);
    i = hay.indexOf(needle, i + 1);
  }
  return out;
}

/**
 * Hand-picked edits that GUARANTEE the named-in-the-brief categories are present
 * for every document, independent of the random draw:
 *  (a) a within-one-block character insert,
 *  (b) a blank line inserted to split a block,
 *  (c) a blank line deleted to merge blocks,
 *  (d) a fence opened, and a fence toggled/closed.
 */
function targetedEdits(src: string): EditCase[] {
  const cases: EditCase[] = [];
  const mid = Math.floor(src.length / 2);

  // (a) within-block: insert a char mid-document.
  cases.push(makeChange(src, mid, mid, 'Z'));

  // (b) split: insert a paragraph break at a few offsets.
  for (const off of [Math.floor(src.length / 3), mid, Math.floor((2 * src.length) / 3)]) {
    cases.push(makeChange(src, off, off, '\n\n'));
  }

  // (c) merge: delete one newline from every blank-line gap.
  for (const gap of allIndicesOf(src, '\n\n')) {
    cases.push(makeChange(src, gap, gap + 1, '')); // delete a '\n' → collapse the gap
  }

  // (d) fences: open one at a line start, and toggle any existing ``` runs.
  const lineStarts = [0, ...allIndicesOf(src, '\n').map((i) => i + 1)].filter((i) => i < src.length);
  for (const ls of lineStarts.slice(0, 4)) {
    cases.push(makeChange(src, ls, ls, '```\n'));
  }
  for (const fence of allIndicesOf(src, '```')) {
    cases.push(makeChange(src, fence, fence + 3, '')); // remove a fence run → open/close flips
    cases.push(makeChange(src, fence, fence, '~~~\n')); // inject a tilde fence just before it
  }

  return cases;
}

/** A batch of pseudo-random edits for a document, driven by the shared PRNG. */
function randomEdits(src: string, rnd: () => number, count: number): EditCase[] {
  const cases: EditCase[] = [];
  for (let n = 0; n < count; n++) {
    const from = Math.floor(rnd() * (src.length + 1));
    // Bias toward small ranges (mostly inserts / short deletes), occasionally wider.
    const span = rnd() < 0.65 ? 0 : 1 + Math.floor(rnd() * (rnd() < 0.5 ? 3 : 12));
    const to = from + span;
    let insert = FRAGMENTS[Math.floor(rnd() * FRAGMENTS.length)]!;
    if (rnd() < 0.35) insert += FRAGMENTS[Math.floor(rnd() * FRAGMENTS.length)]!;
    cases.push(makeChange(src, from, to, insert));
  }
  return cases;
}

/* ------------------------------------------------------------------ *
 * The property.
 * ------------------------------------------------------------------ */

const OPT_MODES: Array<{ name: string; opts: ParseOptions | undefined }> = [
  { name: 'opts off', opts: undefined },
  { name: 'opts on', opts: { footnotes: true, defLists: true, math: true } },
];

interface RunTotals {
  cases: number;
  fastPath: number;
  fellBack: number;
}

/** Assert incremental == full for one case; return whether it hit the fast path. */
function assertEquivalent(ec: EditCase, options: ParseOptions | undefined, ctx: string): boolean {
  const prev: Document = parse(ec.src, options);
  const { doc: actual, stats } = parseIncrementalWithStats(prev, ec.src, ec.change, ec.nextSrc, options);
  const expected: Document = parse(ec.nextSrc, options);

  // The essential guarantee.
  expect(actual, `${ctx} ${ec.label}`).toEqual(expected);
  // The plain entry point must agree with the instrumented one.
  expect(parseIncremental(prev, ec.src, ec.change, ec.nextSrc, options)).toEqual(expected);

  if (!stats.fellBack) {
    // A fast-path result never reparses more lines than the document has, and it
    // reused at least one leading block.
    expect(stats.reusedBlocks).toBeGreaterThan(0);
    expect(stats.reparsedFromLine).toBeGreaterThan(0);
    expect(stats.reparsedFromLine).toBeLessThan(stats.totalLines);
    // Right-bound instrumentation stays internally consistent: the reparsed region
    // is a non-empty span no wider than the document…
    expect(stats.reparsedToLine).toBeGreaterThan(stats.reparsedFromLine);
    expect(stats.reparsedToLine).toBeLessThanOrEqual(stats.totalLines);
    // …and whenever the suffix was reused, the reparse was genuinely bounded away
    // from end-of-document (the tightening this suite exists to protect).
    if (stats.reusedSuffixBlocks > 0) {
      expect(stats.reparsedToLine).toBeLessThan(stats.totalLines);
    } else {
      expect(stats.reparsedToLine).toBe(stats.totalLines);
    }
  }
  return !stats.fellBack;
}

describe('parseIncremental — deep-equals full parse (property)', () => {
  for (const mode of OPT_MODES) {
    it(`matches parse() over the generated corpus (${mode.name})`, () => {
      const rnd = mulberry32(0x1234_5678);
      const totals: RunTotals = { cases: 0, fastPath: 0, fellBack: 0 };

      for (const src of CORPUS) {
        const edits = [...targetedEdits(src), ...randomEdits(src, rnd, 40)];
        for (const ec of edits) {
          const fast = assertEquivalent(ec, mode.opts, `${mode.name}`);
          totals.cases++;
          if (fast) totals.fastPath++;
          else totals.fellBack++;
        }
      }

      // Well over the 200-case floor the brief asks for (currently 777 per mode).
      expect(totals.cases).toBeGreaterThanOrEqual(200);
      // And the incremental fast path is genuinely exercised (not all fall-backs),
      // so the deep-equal above is actually validating incremental output.
      expect(totals.fastPath).toBeGreaterThan(50);
    });
  }
});

/* ------------------------------------------------------------------ *
 * Second-generation edits: apply an edit, then edit the RESULT. This stresses
 * reusing blocks from a document that was itself produced incrementally-shaped
 * (structurally; here we re-parse to stay honest) — a realistic keystroke stream.
 * ------------------------------------------------------------------ */

describe('parseIncremental — chained edits stay equivalent', () => {
  it('replays a stream of edits and matches a full parse at every step', () => {
    const rnd = mulberry32(0x0bad_c0de);
    let matched = 0;
    for (const mode of OPT_MODES) {
      for (const start of CORPUS) {
        let src = start;
        let prev = parse(src, mode.opts);
        for (let step = 0; step < 25; step++) {
          const from = Math.floor(rnd() * (src.length + 1));
          const span = rnd() < 0.7 ? 0 : 1 + Math.floor(rnd() * 6);
          const insert = FRAGMENTS[Math.floor(rnd() * FRAGMENTS.length)]!;
          const ec = makeChange(src, from, from + span, insert);
          const actual = parseIncremental(prev, src, ec.change, ec.nextSrc, mode.opts);
          const expected = parse(ec.nextSrc, mode.opts);
          expect(actual, `${mode.name} step ${step} ${ec.label}`).toEqual(expected);
          matched++;
          src = ec.nextSrc;
          prev = expected; // next iteration's baseline (a genuine parse of `src`)
        }
      }
    }
    expect(matched).toBeGreaterThanOrEqual(200);
  });
});

/* ------------------------------------------------------------------ *
 * Instrumentation: a simple within-paragraph edit near the bottom of a long
 * document reparses only the tail, not the whole document.
 * ------------------------------------------------------------------ */

describe('parseIncremental — reuses the unchanged prefix', () => {
  it('a within-paragraph edit near the end reparses a small tail only', () => {
    // 30 heading/paragraph pairs; the edit lands in the last paragraph.
    const parts: string[] = [];
    for (let n = 0; n < 30; n++) parts.push(`# Section ${n}\n\nBody paragraph number ${n} here.\n`);
    const src = parts.join('\n');
    const prev = parse(src);

    const marker = 'Body paragraph number 29 here.';
    const at = src.indexOf(marker) + 'Body paragraph number 29'.length;
    const ec = makeChange(src, at, at, ' EDITED');

    const { doc, stats } = parseIncrementalWithStats(prev, src, ec.change, ec.nextSrc);

    expect(doc).toEqual(parse(ec.nextSrc));
    expect(stats.fellBack).toBe(false);
    expect(stats.reusedBlocks).toBeGreaterThan(0);
    // The reparsed region is a small fraction of the document.
    expect(stats.reparsedFromLine).toBeGreaterThan(stats.totalLines - 6);
    expect(prev.children.length - stats.reusedBlocks).toBeLessThanOrEqual(2);
  });

  it('falls back cleanly (still correct) when no safe boundary precedes the edit', () => {
    const src = 'one continuous paragraph with no blank lines at all just words';
    const prev = parse(src);
    const at = 10;
    const ec = makeChange(src, at, at, 'X');
    const { doc, stats } = parseIncrementalWithStats(prev, src, ec.change, ec.nextSrc);
    expect(doc).toEqual(parse(ec.nextSrc));
    expect(stats.fellBack).toBe(true);
  });

  it('handles a pure append at end of document', () => {
    const src = '# A\n\npara a\n\n# B\n\npara b\n';
    const prev = parse(src);
    const ec = makeChange(src, src.length, src.length, '\n# C\n\npara c\n');
    expect(parseIncremental(prev, src, ec.change, ec.nextSrc)).toEqual(parse(ec.nextSrc));
  });

  it('is a no-op-safe identity when the edit changes nothing', () => {
    const src = '# A\n\npara\n';
    const prev = parse(src);
    const ec = makeChange(src, 3, 3, '');
    expect(parseIncremental(prev, src, ec.change, ec.nextSrc)).toEqual(parse(src));
  });
});

/* ------------------------------------------------------------------ *
 * Dirty-block tightening: a small edit near the TOP of a large document must
 * reparse only a BOUNDED region (the dirty block(s) + a safe look-around) and
 * reuse the unchanged suffix blocks re-offset by the edit delta — NOT reparse
 * the whole tail. These assert (a) still deep-equal to a full parse, and (b) via
 * the new stats that the tightening actually fired and the reparse stayed near
 * the top. Fence edits, which open a cross-boundary construct, must decline the
 * suffix reuse and fall back — still correct.
 * ------------------------------------------------------------------ */

/** 40 heading/paragraph pairs — a large multi-block doc with reusable suffix depth. */
function bigDoc(): string {
  const parts: string[] = [];
  for (let n = 0; n < 40; n++) parts.push(`# Section ${n}\n\nBody paragraph number ${n} here.\n`);
  return parts.join('\n');
}

describe('parseIncremental — bounds the reparse for a top-of-doc edit', () => {
  it('a within-paragraph edit at the TOP reparses a bounded region and reuses the suffix', () => {
    const src = bigDoc();
    const prev = parse(src);

    // Edit lands in the FIRST body paragraph — the whole tail is unchanged.
    const at = src.indexOf('Body paragraph number 0 here.') + 'Body paragraph number 0'.length;
    const ec = makeChange(src, at, at, ' EDITED');

    const { doc, stats } = parseIncrementalWithStats(prev, src, ec.change, ec.nextSrc);

    // (a) Correctness: identical to a full parse.
    expect(doc).toEqual(parse(ec.nextSrc));
    expect(stats.fellBack).toBe(false);

    // (b) The tightening fired: the suffix was reused, and the reparsed region is
    // a tiny span near the TOP — it does NOT extend to the last block.
    expect(stats.reusedSuffixBlocks).toBeGreaterThan(0);
    expect(stats.reparsedToLine).toBeLessThan(stats.totalLines);
    // Reparsed only a couple of lines right at the top, far from end-of-document.
    expect(stats.reparsedToLine).toBeLessThanOrEqual(8);
    expect(stats.reparsedToLine - stats.reparsedFromLine).toBeLessThanOrEqual(4);
    // Almost every block was reused (both the prefix and the shifted suffix).
    expect(stats.reusedBlocks + stats.reusedSuffixBlocks).toBeGreaterThanOrEqual(
      prev.children.length - 2,
    );
  });

  it('a deletion at the TOP (negative delta) still bounds and re-offsets correctly', () => {
    const src = bigDoc();
    const prev = parse(src);

    const base = src.indexOf('Body paragraph number 0 here.') + 'Body paragraph number 0'.length;
    const ec = makeChange(src, base, base + ' here'.length, ''); // delete " here"

    const { doc, stats } = parseIncrementalWithStats(prev, src, ec.change, ec.nextSrc);

    expect(doc).toEqual(parse(ec.nextSrc));
    expect(stats.fellBack).toBe(false);
    expect(stats.reusedSuffixBlocks).toBeGreaterThan(0);
    expect(stats.reparsedToLine).toBeLessThanOrEqual(8);
  });

  it('a fence opened at the TOP declines suffix reuse but stays correct', () => {
    const src = bigDoc();
    const prev = parse(src);

    // Opening a fence is a cross-boundary construct: it would swallow the tail, so
    // the join boundary cannot be proven and suffix reuse must be declined.
    const at = src.indexOf('Body paragraph number 0 here.');
    const ec = makeChange(src, at, at, '```\n');

    const { doc, stats } = parseIncrementalWithStats(prev, src, ec.change, ec.nextSrc);

    expect(doc).toEqual(parse(ec.nextSrc));
    // Prefix reuse still applies (not a full fall-back), but the suffix tightening
    // correctly stood down and the reparse ran to end-of-document.
    expect(stats.reusedSuffixBlocks).toBe(0);
    expect(stats.reparsedToLine).toBe(stats.totalLines);
  });

  it('a stream of keystrokes at the TOP stays deep-equal at every step', () => {
    let src = bigDoc();
    let prev = parse(src);
    const rnd = mulberry32(0xfeed_face);
    let boundedHits = 0;

    for (let step = 0; step < 20; step++) {
      // Type at the start of the first body paragraph (block 1) each step — a
      // stable anchor that keeps the leading heading reusable as the prefix.
      const at = src.indexOf('\n\n') + 2;
      const insert = FRAGMENTS[Math.floor(rnd() * FRAGMENTS.length)]!;
      const ec = makeChange(src, at, at, insert);
      const { doc, stats } = parseIncrementalWithStats(prev, src, ec.change, ec.nextSrc);
      expect(doc, `step ${step} ${ec.label}`).toEqual(parse(ec.nextSrc));
      if (!stats.fellBack && stats.reusedSuffixBlocks > 0) boundedHits++;
      src = ec.nextSrc;
      prev = doc;
    }

    // The tightening fired for a healthy share of the top-of-doc keystrokes.
    expect(boundedHits).toBeGreaterThan(5);
  });
});
