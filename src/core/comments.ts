/**
 * Comment-anchor maintenance (plan-TW-0002 Phase A2).
 *
 * A comment thread is anchored to a text range `{from, to}`. Every time the
 * document is edited we must move that range so the highlight keeps covering
 * the same words — or drop the anchor (return `null`) when the words it pointed
 * at have been deleted. This is the first real consumer of `TextDoc.mapOffset`
 * (previously dead code) — it is built directly on top of that primitive rather
 * than re-deriving the position math here.
 */
import { TextDoc, type Change } from './text';

/**
 * `mapOffset` is a pure function of `(offset, change, assoc)` — it never reads
 * the document text (it normalizes changes against `Number.MAX_SAFE_INTEGER`,
 * see text.ts:122-143), so a single shared empty doc is a valid host for the
 * call and we avoid allocating a `TextDoc` per invocation.
 */
const MAPPER = new TextDoc();

/**
 * Association for the two anchor ends, in `mapOffset`'s convention
 * (text.ts:117-121): `assoc = -1` keeps the mapped offset *before* text
 * inserted exactly at it (the offset value is unchanged); `assoc = +1` pushes
 * it to *after* the inserted text (offset value += inserted length).
 *
 * We want a comment highlight to behave like a mark with a NON-inclusive start
 * and an INCLUSIVE end. Working that through the semantics above (verified
 * against the mapOffset branches):
 *
 *   • `from` → +1: text typed exactly at the anchor start maps the start
 *     *past* that insert, so the inserted text lands OUTSIDE the highlight —
 *     "insert exactly at 'from' stays outside".
 *   • `to`   → +1: text typed exactly at the anchor end maps the end *past*
 *     that insert, so the inserted text lands INSIDE the highlight —
 *     "insert exactly at 'to' extends the anchor".
 *
 * Note the convention subtlety: under text.ts's semantics it is the +1
 * ("after") association — not -1 — that makes a boundary insert at `from` stay
 * *outside* the range (with -1 the start would sit before the insert and
 * swallow it). Both ends therefore map with +1: the start slides off a
 * boundary insert while the end absorbs it.
 */
const ASSOC_FROM: -1 | 1 = 1;
const ASSOC_TO: -1 | 1 = 1;

/**
 * Re-anchor a comment range across a single document `change`.
 *
 * @returns the mapped `{from, to}` (always `from <= to`), or `null` when the
 * change deleted the entire anchored range.
 */
export function mapAnchor(
  anchor: { from: number; to: number },
  change: Change,
): { from: number; to: number } | null {
  const from = MAPPER.mapOffset(anchor.from, change, ASSOC_FROM);
  const to = MAPPER.mapOffset(anchor.to, change, ASSOC_TO);

  // The anchored text is gone when the ends collapsed onto a single point AND
  // the change's deleted span `[change.from, change.to)` covered the whole
  // original anchor. The coverage guard keeps a plain boundary insert (which
  // can also make the ends equal for a zero-length anchor) from nulling out.
  const collapsed = from === to;
  const deletedWholeRange =
    change.to > change.from && change.from <= anchor.from && change.to >= anchor.to;
  if (collapsed && deletedWholeRange) return null;

  // mapOffset is monotonic for a fixed change/assoc, so from <= to already;
  // min/max is a cheap defensive guard.
  return { from: Math.min(from, to), to: Math.max(from, to) };
}
