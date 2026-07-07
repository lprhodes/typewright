/**
 * Typewright AST — the offset-exact node model the parser produces and the
 * renderer / unified-mode / fold services consume.
 *
 * Every node carries `from`/`to`: UTF-16 offsets into the source string. This
 * is the contract that makes non-destructive rendering, source-revealing, and
 * folding possible — a node always knows exactly which slice of the string it
 * owns. Marker offsets (e.g. a heading's `### `, an emphasis delimiter) are
 * exposed where a consumer needs to hide/reveal them.
 */

export interface Pos {
  /** Inclusive start offset into the source string. */
  from: number;
  /** Exclusive end offset into the source string. */
  to: number;
}

/* ------------------------------------------------------------------ *
 * Inline nodes
 * ------------------------------------------------------------------ */

export interface TextNode extends Pos {
  type: 'text';
  value: string;
}

export interface Emphasis extends Pos {
  type: 'emphasis';
  /** The delimiter used (`*` or `_`). */
  marker: string;
  children: Inline[];
}

export interface Strong extends Pos {
  type: 'strong';
  marker: string;
  children: Inline[];
}

export interface Strikethrough extends Pos {
  type: 'strikethrough';
  children: Inline[];
}

export interface InlineCode extends Pos {
  type: 'inlineCode';
  value: string;
  /** Number of backticks in the fence. */
  ticks: number;
}

export interface Link extends Pos {
  type: 'link';
  url: string;
  title?: string;
  children: Inline[];
}

export interface Image extends Pos {
  type: 'image';
  url: string;
  alt: string;
  title?: string;
}

export interface Autolink extends Pos {
  type: 'autolink';
  url: string;
}

export interface LineBreak extends Pos {
  type: 'break';
  /** A hard break (two trailing spaces or backslash) vs a soft newline. */
  hard: boolean;
}

/** Inline math (`$…$` inline, `$$…$$` inline-display). Opt-in via {@link ParseOptions.math}. */
export interface Math extends Pos {
  type: 'math';
  /** The TeX source between the delimiters (delimiters excluded). */
  value: string;
  /** `true` for a `$$…$$` display span, `false` for a `$…$` inline span. */
  display: boolean;
}

/** A footnote reference `[^id]`. Opt-in via {@link ParseOptions.footnotes}. */
export interface FootnoteRef extends Pos {
  type: 'footnoteRef';
  /** The referenced footnote label (between `[^` and `]`). */
  id: string;
}

export type Inline =
  | TextNode
  | Emphasis
  | Strong
  | Strikethrough
  | InlineCode
  | Link
  | Image
  | Autolink
  | LineBreak
  | Math
  | FootnoteRef;

/* ------------------------------------------------------------------ *
 * Block nodes
 * ------------------------------------------------------------------ */

export interface Heading extends Pos {
  type: 'heading';
  level: 1 | 2 | 3 | 4 | 5 | 6;
  /** Offset just past the `#`… marker + following space (start of content). */
  contentFrom: number;
  children: Inline[];
}

export interface Paragraph extends Pos {
  type: 'paragraph';
  children: Inline[];
}

export interface Blockquote extends Pos {
  type: 'blockquote';
  children: Block[];
}

export type TaskState = 'checked' | 'unchecked' | null;

export interface ListItem extends Pos {
  type: 'listItem';
  /** Task-list state, or null for a plain item. */
  task: TaskState;
  /** Offset just past the list marker (`- `, `1. `, `- [x] `). */
  contentFrom: number;
  children: Block[];
}

export interface List extends Pos {
  type: 'list';
  ordered: boolean;
  /** Start number for an ordered list. */
  start: number;
  /** Loose lists wrap items in paragraphs; tight lists don't. */
  tight: boolean;
  items: ListItem[];
}

export interface CodeBlock extends Pos {
  type: 'codeBlock';
  /** Info string after the opening fence (may be empty). */
  lang: string;
  value: string;
  fenced: boolean;
}

export interface ThematicBreak extends Pos {
  type: 'thematicBreak';
}

export type CellAlign = 'left' | 'center' | 'right' | null;

export interface TableCell extends Pos {
  type: 'tableCell';
  children: Inline[];
}

export interface Table extends Pos {
  type: 'table';
  align: CellAlign[];
  header: TableCell[];
  rows: TableCell[][];
}

/** Raw HTML or an MDX/JSX/ESM region — kept verbatim (markup only, not evaluated). */
export interface HtmlBlock extends Pos {
  type: 'htmlBlock';
  value: string;
  /** `html` for raw HTML, `mdxFlow` for a JSX element / ESM line at block level. */
  variant: 'html' | 'mdxFlow';
}

/** A `$$…$$` display-math block. Opt-in via {@link ParseOptions.math}. */
export interface MathBlock extends Pos {
  type: 'mathBlock';
  /** The TeX source between the `$$` fences (fences excluded). */
  value: string;
}

/** A footnote definition `[^id]: …`. Opt-in via {@link ParseOptions.footnotes}. */
export interface FootnoteDef extends Pos {
  type: 'footnoteDef';
  /** The footnote label (between `[^` and `]`). */
  id: string;
  children: Block[];
}

/** A single term + one-or-more definitions inside a {@link DefList}. */
export interface DefItem extends Pos {
  type: 'defItem';
  term: Inline[];
  /** Each `: …` definition, parsed as its own block sequence. */
  definitions: Block[][];
}

/** A definition list — terms with `: …` definitions. Opt-in via {@link ParseOptions.defLists}. */
export interface DefList extends Pos {
  type: 'defList';
  items: DefItem[];
}

export type Block =
  | Heading
  | Paragraph
  | Blockquote
  | List
  | CodeBlock
  | ThematicBreak
  | Table
  | HtmlBlock
  | MathBlock
  | FootnoteDef
  | DefList;

export interface Document extends Pos {
  type: 'document';
  children: Block[];
}

export type AstNode = Document | Block | ListItem | TableCell | DefItem | Inline;

/**
 * Opt-in parser extensions. Every flag defaults to `false`, so `parse(src)`
 * behaves exactly as it always has; enabling a flag lights up the matching
 * construct (and nothing else). Kept semver-safe so a later wave can turn these
 * on from configuration without a breaking parser change.
 */
export interface ParseOptions {
  /** Parse `$…$` inline and `$$…$$` block math. */
  math?: boolean;
  /** Parse `[^id]` footnote references and `[^id]: …` definitions. */
  footnotes?: boolean;
  /** Parse `term` / `: definition` definition lists. */
  defLists?: boolean;
}

/* ------------------------------------------------------------------ *
 * Helpers
 * ------------------------------------------------------------------ */

const INLINE_TYPES = new Set([
  'text',
  'emphasis',
  'strong',
  'strikethrough',
  'inlineCode',
  'link',
  'image',
  'autolink',
  'break',
  'math',
  'footnoteRef',
]);

export function isInline(node: AstNode): node is Inline {
  return INLINE_TYPES.has(node.type);
}

/** Depth-first walk over the tree; return false from `visit` to skip children. */
export function walk(node: AstNode, visit: (node: AstNode) => boolean | void): void {
  const go = (n: AstNode): void => {
    if (visit(n) === false) return;
    const kids = childrenOf(n);
    for (const k of kids) go(k);
  };
  go(node);
}

export function childrenOf(node: AstNode): AstNode[] {
  switch (node.type) {
    case 'document':
    case 'blockquote':
      return node.children;
    case 'heading':
    case 'paragraph':
    case 'emphasis':
    case 'strong':
    case 'strikethrough':
    case 'tableCell':
      return node.children;
    case 'link':
      return node.children;
    case 'list':
      return node.items;
    case 'listItem':
      return node.children;
    case 'table':
      return [...node.header, ...node.rows.flat()];
    case 'footnoteDef':
      return node.children;
    case 'defList':
      return node.items;
    case 'defItem':
      return [...node.term, ...node.definitions.flat()];
    default:
      return [];
  }
}
