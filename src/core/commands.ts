/**
 * Editing commands — pure transforms over `(text, selection)` used by the
 * formatting toolbar and keyboard shortcuts. Each returns the new text and the
 * new selection, so the caller (edit textarea / unified active block) can apply
 * it and restore the caret. Pure and framework-free — fully unit-testable.
 */

export type Command =
  | 'bold'
  | 'italic'
  | 'strikethrough'
  | 'inlineCode'
  | 'link'
  | 'heading1'
  | 'heading2'
  | 'heading3'
  | 'heading4'
  | 'heading5'
  | 'heading6'
  | 'bulletList'
  | 'orderedList'
  | 'taskList'
  | 'quote'
  | 'horizontalRule'
  | 'codeBlock'
  | 'table';

/** Metadata describing a command for enumerable surfaces (toolbar, palette, keymap). */
export interface CommandMeta {
  id: Command;
  label: string;
  /** Display shortcut (e.g. `⌘B`) when one is bound; omitted otherwise. */
  kbd?: string;
  group: 'inline' | 'block' | 'insert';
}

/**
 * The single source of truth enumerating every command — consumed by the
 * formatting toolbar, the command palette, and the keymap. Plain data, no side
 * effects; one entry per `Command` id (kept exhaustive by the `applyCommand`
 * `never` guard, which forces new ids to exist before they can be listed here).
 */
export const COMMANDS: readonly CommandMeta[] = [
  { id: 'bold', label: 'Bold', kbd: '⌘B', group: 'inline' },
  { id: 'italic', label: 'Italic', kbd: '⌘I', group: 'inline' },
  { id: 'strikethrough', label: 'Strikethrough', group: 'inline' },
  { id: 'inlineCode', label: 'Inline Code', kbd: '⌘E', group: 'inline' },
  { id: 'link', label: 'Link', kbd: '⌘K', group: 'inline' },
  { id: 'heading1', label: 'Heading 1', group: 'block' },
  { id: 'heading2', label: 'Heading 2', group: 'block' },
  { id: 'heading3', label: 'Heading 3', group: 'block' },
  { id: 'heading4', label: 'Heading 4', group: 'block' },
  { id: 'heading5', label: 'Heading 5', group: 'block' },
  { id: 'heading6', label: 'Heading 6', group: 'block' },
  { id: 'bulletList', label: 'Bullet List', group: 'block' },
  { id: 'orderedList', label: 'Ordered List', group: 'block' },
  { id: 'taskList', label: 'Task List', group: 'block' },
  { id: 'quote', label: 'Quote', group: 'block' },
  { id: 'horizontalRule', label: 'Horizontal Rule', group: 'insert' },
  { id: 'codeBlock', label: 'Code Block', group: 'insert' },
  { id: 'table', label: 'Table', group: 'insert' },
];

export interface Sel {
  from: number;
  to: number;
}

export interface CommandResult {
  text: string;
  selection: Sel;
}

function norm(sel: Sel): Sel {
  return { from: Math.min(sel.from, sel.to), to: Math.max(sel.from, sel.to) };
}

/** Toggle-wrap the selection in a symmetric inline marker (e.g. `**`). */
function toggleWrap(text: string, sel: Sel, marker: string): CommandResult {
  const len = marker.length;
  const { from, to } = norm(sel);

  // already wrapped just OUTSIDE the selection → unwrap
  if (from >= len && text.slice(from - len, from) === marker && text.slice(to, to + len) === marker) {
    const t = text.slice(0, from - len) + text.slice(from, to) + text.slice(to + len);
    return { text: t, selection: { from: from - len, to: to - len } };
  }

  const selected = text.slice(from, to);

  // already wrapped INSIDE the selection → unwrap
  if (selected.length >= 2 * len && selected.startsWith(marker) && selected.endsWith(marker)) {
    const inner = selected.slice(len, selected.length - len);
    const t = text.slice(0, from) + inner + text.slice(to);
    return { text: t, selection: { from, to: from + inner.length } };
  }

  // wrap
  const t = text.slice(0, from) + marker + selected + marker + text.slice(to);
  if (from === to) return { text: t, selection: { from: from + len, to: from + len } };
  return { text: t, selection: { from: from + len, to: to + len } };
}

function insertLink(text: string, sel: Sel): CommandResult {
  const { from, to } = norm(sel);
  // A link needs text to wrap. With no selection there is nothing to turn into a
  // link, so this is a no-op — inserting a `[text](https://)` placeholder here
  // just litters the document with an orphaned link (it renders as a stray word).
  if (from === to) return { text, selection: sel };
  const label = text.slice(from, to);
  const url = 'https://';
  const inserted = `[${label}](${url})`;
  const t = text.slice(0, from) + inserted + text.slice(to);
  const urlStart = from + label.length + 3; // '[' + label + '](' = len + 3
  return { text: t, selection: { from: urlStart, to: urlStart + url.length } };
}

const HEADING_RE = /^ {0,3}#{1,6}\s+/;
const LIST_RE = /^ {0,3}(?:[-*+]\s(?:\[[ xX]\]\s)?|\d+[.)]\s)/;
const QUOTE_RE = /^ {0,3}>\s?/;

interface LinePrefix {
  has: (line: string) => boolean;
  strip: (line: string) => string;
  add: (line: string, index: number) => string;
}

function applyLinePrefix(text: string, sel: Sel, p: LinePrefix): CommandResult {
  const { from, to } = norm(sel);
  const start = text.lastIndexOf('\n', from - 1) + 1;
  const searchFrom = to > from ? to - 1 : to;
  let end = text.indexOf('\n', searchFrom);
  if (end === -1) end = text.length;

  const lines = text.slice(start, end).split('\n');
  const allHave = lines.every((l) => l.trim() === '' || p.has(l));
  const out = lines
    .map((l, i) => (l.trim() === '' ? l : allHave ? p.strip(l) : p.add(p.strip(l), i)))
    .join('\n');

  const t = text.slice(0, start) + out + text.slice(end);
  return { text: t, selection: { from: start, to: start + out.length } };
}

function stripAllPrefixes(line: string): string {
  return line.replace(HEADING_RE, '').replace(LIST_RE, '').replace(QUOTE_RE, '');
}

function insertBlock(text: string, sel: Sel, block: string, selectInner?: [number, number]): CommandResult {
  const { from, to } = norm(sel);
  const before = text.slice(0, from);
  const after = text.slice(to);
  const lead = before === '' || before.endsWith('\n\n') ? '' : before.endsWith('\n') ? '\n' : '\n\n';
  const trail = after === '' || after.startsWith('\n\n') ? '' : after.startsWith('\n') ? '\n' : '\n\n';
  const insertedAt = from + lead.length;
  const t = before + lead + block + trail + after;
  const selection: Sel = selectInner
    ? { from: insertedAt + selectInner[0], to: insertedAt + selectInner[1] }
    : { from: insertedAt, to: insertedAt + block.length };
  return { text: t, selection };
}

export function applyCommand(text: string, sel: Sel, cmd: Command): CommandResult {
  switch (cmd) {
    case 'bold':
      return toggleWrap(text, sel, '**');
    case 'italic':
      return toggleWrap(text, sel, '*');
    case 'strikethrough':
      return toggleWrap(text, sel, '~~');
    case 'inlineCode':
      return toggleWrap(text, sel, '`');
    case 'link':
      return insertLink(text, sel);
    case 'heading1':
    case 'heading2':
    case 'heading3':
    case 'heading4':
    case 'heading5':
    case 'heading6': {
      const level =
        cmd === 'heading1'
          ? 1
          : cmd === 'heading2'
            ? 2
            : cmd === 'heading3'
              ? 3
              : cmd === 'heading4'
                ? 4
                : cmd === 'heading5'
                  ? 5
                  : 6;
      const marker = '#'.repeat(level) + ' ';
      return applyLinePrefix(text, sel, {
        has: (l) => new RegExp(`^ {0,3}#{${level}}\\s`).test(l),
        strip: (l) => l.replace(HEADING_RE, ''),
        add: (l) => marker + l,
      });
    }
    case 'bulletList':
      return applyLinePrefix(text, sel, {
        has: (l) => /^ {0,3}[-*+]\s/.test(l),
        strip: stripAllPrefixes,
        add: (l) => '- ' + l,
      });
    case 'orderedList':
      return applyLinePrefix(text, sel, {
        has: (l) => /^ {0,3}\d+[.)]\s/.test(l),
        strip: stripAllPrefixes,
        add: (l, i) => `${i + 1}. ` + l,
      });
    case 'taskList':
      return applyLinePrefix(text, sel, {
        has: (l) => /^ {0,3}[-*+]\s\[[ xX]\]\s/.test(l),
        strip: stripAllPrefixes,
        add: (l) => '- [ ] ' + l,
      });
    case 'quote':
      return applyLinePrefix(text, sel, {
        has: (l) => QUOTE_RE.test(l),
        strip: (l) => l.replace(QUOTE_RE, ''),
        add: (l) => '> ' + l,
      });
    case 'horizontalRule':
      return insertBlock(text, sel, '---');
    case 'codeBlock': {
      const selected = text.slice(norm(sel).from, norm(sel).to);
      const block = '```\n' + selected + '\n```';
      // place caret after the opening fence when empty
      return insertBlock(text, sel, block, selected ? undefined : [4, 4]);
    }
    case 'table': {
      const block = '| Column | Column |\n| --- | --- |\n| Cell | Cell |';
      return insertBlock(text, sel, block, [2, 8]); // select first header word
    }
    default: {
      const _exhaustive: never = cmd;
      return { text, selection: norm(sel) };
    }
  }
}
