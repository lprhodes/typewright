/**
 * Heading slugs, stable ids, and the document outline.
 *
 * A content site needs two things the renderer alone cannot give it: an `id` on
 * every heading (so `#anchor` links resolve) and a list of those headings (so a
 * table-of-contents rail can be built). Both must agree *exactly* — a TOC that
 * links `#the-basics` while the renderer emitted `#the-basics-2` is a dead link.
 *
 * That agreement is structural here, not coincidental: {@link buildHeadingIds}
 * is the single id allocator, and both {@link outline} and `renderToHtml` read
 * from the map it returns, keyed by heading node identity. Neither re-slugs.
 */

import { inlineText, walk } from './ast';
import type { Document, Heading, Pos } from './ast';

/** Fallback slug for a heading whose text slugs to nothing (e.g. `## ---`). */
const EMPTY_SLUG = 'section';

/**
 * Reduce heading text to a URL-fragment-safe slug, GitHub-style: lowercase,
 * punctuation dropped, whitespace runs collapsed to a single `-`.
 *
 * Letters and digits of ANY script are kept (`\p{L}` / `\p{N}`) — HTML5 ids
 * permit them and stripping them would collapse a whole non-Latin document to
 * `section`, `section-2`, `section-3`. The result is never empty; it is still
 * attribute-escaped at the point of emission.
 */
export function slugify(text: string): string {
  const slug = text
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s-]/gu, '')
    .replace(/\s+/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug === '' ? EMPTY_SLUG : slug;
}

/**
 * A stateful slugger that guarantees uniqueness across one document: the first
 * `Overview` is `overview`, the next is `overview-2`, and so on.
 *
 * The candidate is re-checked against everything already issued rather than
 * trusting a per-base counter, so a literal heading named `Overview 2` cannot
 * collide with the auto-suffixed `overview-2` of a second `Overview`.
 */
export function createSlugger(): (text: string) => string {
  const used = new Set<string>();
  const counts = new Map<string, number>();
  return (text: string): string => {
    const base = slugify(text);
    let n = counts.get(base) ?? 0;
    let candidate = base;
    while (used.has(candidate)) {
      n++;
      candidate = `${base}-${n + 1}`;
    }
    counts.set(base, n);
    used.add(candidate);
    return candidate;
  };
}

/**
 * Every heading in the document, in the order `renderToHtml` emits it.
 *
 * Footnote-definition subtrees are skipped: the renderer hoists definitions out
 * of document flow into a trailing `<section>`, so a heading buried in one has
 * no stable position in the outline. Such headings therefore receive no id —
 * consistently, in both the outline and the rendered HTML.
 */
export function collectHeadings(doc: Document): Heading[] {
  const out: Heading[] = [];
  walk(doc, (node) => {
    if (node.type === 'footnoteDef') return false;
    if (node.type === 'heading') {
      out.push(node);
      return false; // a heading's children are inline — nothing to descend into
    }
    return true;
  });
  return out;
}

/**
 * Allocate one unique id per heading, keyed by node identity.
 *
 * Identity (not text, not offset) is the key so the renderer can look up the id
 * for the exact node it is emitting, with no risk of two same-titled headings
 * resolving to the same entry.
 */
export function buildHeadingIds(doc: Document): Map<Heading, string> {
  const slug = createSlugger();
  const ids = new Map<Heading, string>();
  for (const heading of collectHeadings(doc)) {
    ids.set(heading, slug(inlineText(heading.children)));
  }
  return ids;
}

/** One heading in the {@link outline}, carrying the same offsets as its node. */
export interface HeadingEntry extends Pos {
  level: 1 | 2 | 3 | 4 | 5 | 6;
  /** The id `renderToHtml(doc, { headingIds: true })` emits for this heading. */
  id: string;
  /** The heading's plain text, markers removed. */
  text: string;
}

/**
 * The document's heading outline — the input to a table-of-contents rail.
 *
 * The ids are byte-identical to those `renderToHtml(doc, { headingIds: true })`
 * emits for the same document, so `#${entry.id}` always resolves.
 *
 * ```ts
 * const doc = parse(src);
 * const toc = outline(doc).filter((h) => h.level === 2);
 * const html = renderToHtml(doc, { headingIds: true });
 * ```
 */
export function outline(doc: Document): HeadingEntry[] {
  const ids = buildHeadingIds(doc);
  const entries: HeadingEntry[] = [];
  for (const heading of collectHeadings(doc)) {
    entries.push({
      level: heading.level,
      id: ids.get(heading) ?? EMPTY_SLUG,
      text: inlineText(heading.children).trim(),
      from: heading.from,
      to: heading.to,
    });
  }
  return entries;
}
