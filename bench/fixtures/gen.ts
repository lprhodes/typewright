/**
 * Deterministic Markdown fixture generator for the Typewright benchmark harness.
 *
 * NO `Math.random` — every byte is a pure function of the section index, so the
 * 5 KB / 50 KB / 1 MB fixtures are byte-identical on every machine and every run.
 * That reproducibility is what makes the published numbers in
 * `docs/BENCHMARKS.md` honest and re-checkable (SPEC.md §10).
 *
 * The corpus is "mixed content" per SPEC §10: headings, prose paragraphs,
 * bullet + ordered lists, GFM tables, fenced code (js/ts/sql/bash), blockquotes,
 * task lists and the occasional inline emphasis/link/code — i.e. the shapes that
 * actually exercise the block + inline parsers, not a wall of plain text.
 */

const WORDS = [
  'markdown', 'parser', 'incremental', 'offset', 'exact', 'render', 'unified',
  'caret', 'token', 'stream', 'anticipate', 'block', 'inline', 'fenced', 'code',
  'table', 'heading', 'fold', 'sandbox', 'iframe', 'opaque', 'origin', 'escape',
  'latency', 'keystroke', 'paint', 'viewport', 'virtualize', 'decoration',
  'grapheme', 'composition', 'selection', 'anchor', 'reactive', 'headless',
  'zero', 'dependency', 'gzip', 'budget', 'benchmark', 'workload', 'threshold',
];

/** Deterministic pseudo-word pick — pure function of two indices, no RNG. */
function word(a: number, b: number): string {
  return WORDS[(a * 31 + b * 17 + 7) % WORDS.length]!;
}

/** A deterministic sentence of `n` words seeded by `(s, line)`. */
function sentence(s: number, line: number, n: number): string {
  const out: string[] = [];
  for (let i = 0; i < n; i++) out.push(word(s + line, i));
  const text = out.join(' ');
  return text.charAt(0).toUpperCase() + text.slice(1) + '.';
}

/** A paragraph with some inline emphasis, code and a link — exercises inline parse. */
function paragraph(s: number): string {
  const a = sentence(s, 1, 9);
  const b = sentence(s, 2, 11).replace(/(\w+)\.$/, '**$1**.');
  const c = sentence(s, 3, 8).replace(/^(\w+)/, '`$1`');
  const link = `[${word(s, 4)}](https://example.com/${word(s, 5)}#${s})`;
  return `${a} ${b} See ${link}. ${c}`;
}

function table(s: number): string {
  const rows: string[] = [];
  rows.push(`| ${word(s, 0)} | ${word(s, 1)} | ${word(s, 2)} |`);
  rows.push('| :--- | :---: | ---: |');
  for (let r = 0; r < 4; r++) {
    rows.push(`| ${word(s, r + 3)} ${r} | ${(r + s) * 7} | \`${word(s, r)}\` |`);
  }
  return rows.join('\n');
}

function codeBlock(s: number): string {
  const langs = ['ts', 'js', 'sql', 'bash'];
  const lang = langs[s % langs.length]!;
  const body =
    lang === 'sql'
      ? `SELECT ${word(s, 1)}, ${word(s, 2)} FROM ${word(s, 3)}\nWHERE id = ${s} ORDER BY ${word(s, 4)};`
      : lang === 'bash'
        ? `#!/usr/bin/env bash\nfor f in ./${word(s, 1)}/*; do echo "${word(s, 2)} $f"; done`
        : `export function ${word(s, 1)}${s}(x: number): string {\n  const ${word(s, 2)} = x * ${s + 1};\n  return \`<\${${word(s, 2)}}>\`; // ${word(s, 3)}\n}`;
  return '```' + lang + '\n' + body + '\n```';
}

/** One self-contained section (~500–900 bytes), deterministic in `s`. */
function section(s: number): string {
  const level = (s % 3) + 1; // h1..h3
  const parts: string[] = [];
  parts.push(`${'#'.repeat(level)} Section ${s}: ${word(s, 0)} ${word(s, 1)}`);
  parts.push(paragraph(s));
  // bullet / ordered / task list, rotating
  if (s % 3 === 0) {
    parts.push(
      [0, 1, 2].map((i) => `- ${sentence(s, 10 + i, 6)}`).join('\n'),
    );
  } else if (s % 3 === 1) {
    parts.push(
      [0, 1, 2].map((i) => `${i + 1}. ${sentence(s, 20 + i, 6)}`).join('\n'),
    );
  } else {
    parts.push(
      `- [ ] ${sentence(s, 30, 5)}\n- [x] ${sentence(s, 31, 5)}`,
    );
  }
  if (s % 2 === 0) parts.push(codeBlock(s));
  if (s % 4 === 1) parts.push(table(s));
  if (s % 5 === 2) parts.push(`> ${sentence(s, 40, 12)}`);
  parts.push(paragraph(s + 1000));
  return parts.join('\n\n');
}

/**
 * Build a deterministic Markdown document of at least `targetBytes` bytes.
 * Grows by whole sections, so the output is a superset-consistent doc: the 50 KB
 * fixture's first 5 KB is *not* identical to the 5 KB fixture (sizes differ by a
 * partial trailing section), but any given `targetBytes` always yields the exact
 * same string.
 */
export function makeDoc(targetBytes: number): string {
  const chunks: string[] = [
    '# Typewright benchmark fixture\n\nDeterministically generated mixed-content Markdown (headings, prose, lists, GFM tables, fenced code, blockquotes, task lists). No randomness — reproducible across runs.',
  ];
  let size = chunks[0]!.length;
  let s = 0;
  while (size < targetBytes) {
    const sec = '\n\n' + section(s++);
    chunks.push(sec);
    size += sec.length;
  }
  return chunks.join('') + '\n';
}

/** Named workloads matching SPEC §10 (5 KB / 50 KB mixed, 1 MB large). */
export const WORKLOADS = {
  small: 5 * 1024,
  medium: 50 * 1024,
  large: 1024 * 1024,
} as const;

export type WorkloadName = keyof typeof WORKLOADS;
