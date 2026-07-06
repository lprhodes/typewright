/**
 * Native, zero-dependency syntax highlighter.
 *
 * {@link highlightToHtml} turns a fenced code block's source into an HTML
 * string with tokens wrapped in `<span class="tw-tok-KIND">…</span>`. The
 * tokenizers are small, hand-written, single-pass line/char scanners — NOT
 * full grammars. They recognise the shapes that carry the most colour signal:
 * keywords, strings (including template literals), line + block comments,
 * numbers, punctuation, and a light dusting of function / type / property
 * classification.
 *
 * Safety is the load-bearing invariant: **every** character that reaches the
 * output — token content and the gaps between tokens alike — is HTML-escaped
 * through the local {@link escapeHtml}. A `<script>` (or `<img onerror=…>`)
 * embedded in the code therefore always appears inert/escaped, never as live
 * markup. This mirrors the sanitizing contract of `render.ts` so the
 * highlighter can be handed straight to the renderer without widening the
 * attack surface.
 *
 * Complexity is O(n) in the source length. There are no unbounded-backtracking
 * regexes; scanning advances the cursor monotonically, so pathological input
 * (huge whitespace runs, unterminated strings/comments) is safe.
 */

/** The token classes we emit. `KIND` in `tw-tok-KIND`. */
type TokenKind =
  | 'keyword'
  | 'string'
  | 'comment'
  | 'number'
  | 'punct'
  | 'fn'
  | 'type'
  | 'prop';

/* ------------------------------------------------------------------ *
 * Escaping + span emission
 * ------------------------------------------------------------------ */

/**
 * Escape the four characters that matter in HTML text / double-quoted attrs
 * (`&`, `<`, `>`, `"`). This is the security boundary: nothing leaves this
 * module without passing through here.
 */
function escapeHtml(value: string): string {
  let out = '';
  for (let i = 0; i < value.length; i++) {
    const ch = value.charCodeAt(i);
    switch (ch) {
      case 38 /* & */:
        out += '&amp;';
        break;
      case 60 /* < */:
        out += '&lt;';
        break;
      case 62 /* > */:
        out += '&gt;';
        break;
      case 34 /* " */:
        out += '&quot;';
        break;
      default:
        out += value.charAt(i);
    }
  }
  return out;
}

/** Wrap escaped `text` in a token span. */
function span(kind: TokenKind, text: string): string {
  return `<span class="tw-tok-${kind}">${escapeHtml(text)}</span>`;
}

/* ------------------------------------------------------------------ *
 * Character predicates (charCode based, O(1))
 * ------------------------------------------------------------------ */

function isDigit(ch: number): boolean {
  return ch >= 48 && ch <= 57;
}

function isIdentStart(ch: number): boolean {
  return (
    (ch >= 65 && ch <= 90) || // A-Z
    (ch >= 97 && ch <= 122) || // a-z
    ch === 95 || // _
    ch === 36 // $
  );
}

function isIdentPart(ch: number): boolean {
  return isIdentStart(ch) || isDigit(ch);
}

/** Chars that may appear inside a numeric literal (hex/oct/bin/float/sep). */
function isNumberPart(ch: number): boolean {
  return (
    isDigit(ch) ||
    ch === 46 || // .
    ch === 95 || // _ separator
    ch === 120 || // x
    ch === 88 || // X
    ch === 111 || // o
    ch === 79 || // O
    ch === 98 || // b
    ch === 66 || // B
    (ch >= 97 && ch <= 102) || // a-f (hex + exponent 'e')
    (ch >= 65 && ch <= 70) // A-F (hex + exponent 'E')
  );
}

/** Punctuation we colour in C-like languages. */
function isPunct(ch: number): boolean {
  switch (ch) {
    case 123: // {
    case 125: // }
    case 40: // (
    case 41: // )
    case 91: // [
    case 93: // ]
    case 60: // <
    case 62: // >
    case 61: // =
    case 43: // +
    case 45: // -
    case 42: // *
    case 47: // /
    case 37: // %
    case 33: // !
    case 63: // ?
    case 58: // :
    case 59: // ;
    case 44: // ,
    case 46: // .
    case 38: // &
    case 124: // |
    case 94: // ^
    case 126: // ~
    case 64: // @
      return true;
    default:
      return false;
  }
}

/**
 * Scan back from `i-1` to the first non-whitespace char code (0 if none).
 * Amortised O(n) across a scan because each gap is walked at most once.
 */
function prevNonSpace(code: string, i: number): number {
  let k = i - 1;
  while (k >= 0) {
    const c = code.charCodeAt(k);
    if (c === 32 || c === 9 || c === 10 || c === 13) {
      k--;
      continue;
    }
    return c;
  }
  return 0;
}

/**
 * Consume a quoted string starting at `start` (the opening quote). Backslash
 * escapes are skipped. Non-template strings terminate at an unescaped newline
 * (so an unterminated `"` can't swallow the rest of the file). Returns the
 * exclusive end index.
 */
function consumeString(code: string, start: number, quote: number): number {
  const n = code.length;
  let j = start + 1;
  while (j < n) {
    const c = code.charCodeAt(j);
    if (c === 92 /* \ */) {
      j += 2;
      continue;
    }
    if (c === quote) {
      return j + 1;
    }
    if (quote !== 96 /* ` */ && c === 10 /* \n */) {
      return j; // unterminated: stop before the newline
    }
    j++;
  }
  return n;
}

/* ------------------------------------------------------------------ *
 * Keyword / type tables
 * ------------------------------------------------------------------ */

// prettier-ignore
const JS_KEYWORDS = new Set([
  'abstract', 'any', 'as', 'asserts', 'async', 'await', 'break', 'case',
  'catch', 'class', 'const', 'continue', 'debugger', 'declare', 'default',
  'delete', 'do', 'else', 'enum', 'export', 'extends', 'false', 'finally',
  'for', 'from', 'function', 'get', 'if', 'implements', 'import', 'in',
  'infer', 'instanceof', 'interface', 'is', 'keyof', 'let', 'namespace',
  'new', 'null', 'of', 'override', 'package', 'private', 'protected',
  'public', 'readonly', 'return', 'satisfies', 'set', 'static', 'super',
  'switch', 'this', 'throw', 'true', 'try', 'type', 'typeof', 'undefined',
  'var', 'void', 'while', 'with', 'yield',
]);

// prettier-ignore
const TS_TYPES = new Set([
  'string', 'number', 'boolean', 'object', 'symbol', 'bigint', 'unknown',
  'never', 'Array', 'Record', 'Promise', 'Partial', 'Required', 'Readonly',
  'Pick', 'Omit', 'Map', 'Set', 'WeakMap', 'WeakSet', 'Date', 'RegExp',
  'Error',
]);

// prettier-ignore
const PY_KEYWORDS = new Set([
  'and', 'as', 'assert', 'async', 'await', 'break', 'case', 'class',
  'continue', 'def', 'del', 'elif', 'else', 'except', 'False', 'finally',
  'for', 'from', 'global', 'if', 'import', 'in', 'is', 'lambda', 'match',
  'None', 'nonlocal', 'not', 'or', 'pass', 'raise', 'return', 'True', 'try',
  'while', 'with', 'yield',
]);

// prettier-ignore
const BASH_KEYWORDS = new Set([
  'if', 'then', 'else', 'elif', 'fi', 'for', 'while', 'until', 'do', 'done',
  'case', 'esac', 'in', 'function', 'select', 'time', 'return', 'break',
  'continue', 'echo', 'cd', 'export', 'local', 'read', 'printf', 'source',
  'exit', 'set', 'unset', 'test', 'eval', 'exec', 'trap', 'shift',
]);

// prettier-ignore
const SQL_KEYWORDS = new Set([
  'add', 'all', 'alter', 'and', 'as', 'asc', 'auto_increment', 'begin',
  'between', 'by', 'case', 'column', 'commit', 'constraint', 'create',
  'cross', 'default', 'delete', 'desc', 'distinct', 'drop', 'else', 'end',
  'exists', 'foreign', 'from', 'full', 'group', 'having', 'if', 'in',
  'index', 'inner', 'insert', 'into', 'is', 'join', 'key', 'left', 'like',
  'limit', 'not', 'null', 'offset', 'on', 'or', 'order', 'outer', 'primary',
  'references', 'right', 'rollback', 'select', 'set', 'table', 'then',
  'union', 'unique', 'update', 'values', 'view', 'when', 'where', 'with',
  // common types / functions
  'int', 'integer', 'bigint', 'smallint', 'decimal', 'numeric', 'float',
  'real', 'double', 'char', 'varchar', 'text', 'boolean', 'bool', 'date',
  'datetime', 'timestamp', 'count', 'sum', 'avg', 'min', 'max', 'coalesce',
]);

/* ------------------------------------------------------------------ *
 * C-like (javascript / typescript / jsx / tsx)
 * ------------------------------------------------------------------ */

function highlightCLike(code: string): string {
  const n = code.length;
  let out = '';
  let i = 0;
  let prevWord = '';

  while (i < n) {
    const ch = code.charCodeAt(i);

    // line comment //
    if (ch === 47 /* / */ && code.charCodeAt(i + 1) === 47) {
      let j = i + 2;
      while (j < n && code.charCodeAt(j) !== 10) j++;
      out += span('comment', code.slice(i, j));
      i = j;
      continue;
    }

    // block comment /* */
    if (ch === 47 && code.charCodeAt(i + 1) === 42 /* * */) {
      let j = i + 2;
      while (
        j < n &&
        !(code.charCodeAt(j) === 42 && code.charCodeAt(j + 1) === 47)
      ) {
        j++;
      }
      j = Math.min(n, j + 2);
      out += span('comment', code.slice(i, j));
      i = j;
      continue;
    }

    // strings: " ' `
    if (ch === 34 || ch === 39 || ch === 96) {
      const end = consumeString(code, i, ch);
      out += span('string', code.slice(i, end));
      i = end;
      continue;
    }

    // number
    if (isDigit(ch) || (ch === 46 && isDigit(code.charCodeAt(i + 1)))) {
      let j = i + 1;
      while (j < n && isNumberPart(code.charCodeAt(j))) j++;
      out += span('number', code.slice(i, j));
      i = j;
      prevWord = '';
      continue;
    }

    // identifier / keyword / type / fn / prop
    if (isIdentStart(ch)) {
      let j = i + 1;
      while (j < n && isIdentPart(code.charCodeAt(j))) j++;
      const word = code.slice(i, j);
      if (JS_KEYWORDS.has(word)) {
        out += span('keyword', word);
      } else if (TS_TYPES.has(word)) {
        out += span('type', word);
      } else {
        // look ahead past spaces for a call paren
        let k = j;
        while (k < n) {
          const c = code.charCodeAt(k);
          if (c === 32 || c === 9) {
            k++;
            continue;
          }
          break;
        }
        const isCall = code.charCodeAt(k) === 40; // (
        if (prevNonSpace(code, i) === 46 /* . */) {
          out += span('prop', word);
        } else if (prevWord === 'class' || prevWord === 'interface') {
          out += span('type', word);
        } else if (isCall || prevWord === 'function') {
          out += span('fn', word);
        } else {
          out += escapeHtml(word);
        }
      }
      prevWord = word;
      i = j;
      continue;
    }

    // punctuation
    if (isPunct(ch)) {
      out += span('punct', code.charAt(i));
      i++;
      continue;
    }

    // whitespace / anything else
    out += escapeHtml(code.charAt(i));
    i++;
  }

  return out;
}

/* ------------------------------------------------------------------ *
 * JSON
 * ------------------------------------------------------------------ */

function highlightJson(code: string): string {
  const n = code.length;
  let out = '';
  let i = 0;

  while (i < n) {
    const ch = code.charCodeAt(i);

    // string — key (followed by ':') vs value
    if (ch === 34 /* " */) {
      const end = consumeString(code, i, 34);
      const text = code.slice(i, end);
      // peek past whitespace for a colon
      let k = end;
      while (k < n) {
        const c = code.charCodeAt(k);
        if (c === 32 || c === 9 || c === 10 || c === 13) {
          k++;
          continue;
        }
        break;
      }
      out += span(code.charCodeAt(k) === 58 /* : */ ? 'prop' : 'string', text);
      i = end;
      continue;
    }

    // number (with optional leading -)
    if (isDigit(ch) || (ch === 45 && isDigit(code.charCodeAt(i + 1)))) {
      let j = i + 1;
      while (j < n && isNumberPart(code.charCodeAt(j))) j++;
      out += span('number', code.slice(i, j));
      i = j;
      continue;
    }

    // literals true / false / null
    if (isIdentStart(ch)) {
      let j = i + 1;
      while (j < n && isIdentPart(code.charCodeAt(j))) j++;
      const word = code.slice(i, j);
      if (word === 'true' || word === 'false' || word === 'null') {
        out += span('keyword', word);
      } else {
        out += escapeHtml(word);
      }
      i = j;
      continue;
    }

    if (isPunct(ch)) {
      out += span('punct', code.charAt(i));
      i++;
      continue;
    }

    out += escapeHtml(code.charAt(i));
    i++;
  }

  return out;
}

/* ------------------------------------------------------------------ *
 * CSS
 * ------------------------------------------------------------------ */

function highlightCss(code: string): string {
  const n = code.length;
  let out = '';
  let i = 0;
  let depth = 0;
  let beforeColon = true; // property-name position inside a block

  while (i < n) {
    const ch = code.charCodeAt(i);

    // block comment /* */
    if (ch === 47 && code.charCodeAt(i + 1) === 42) {
      let j = i + 2;
      while (
        j < n &&
        !(code.charCodeAt(j) === 42 && code.charCodeAt(j + 1) === 47)
      ) {
        j++;
      }
      j = Math.min(n, j + 2);
      out += span('comment', code.slice(i, j));
      i = j;
      continue;
    }

    // strings
    if (ch === 34 || ch === 39) {
      const end = consumeString(code, i, ch);
      out += span('string', code.slice(i, end));
      i = end;
      continue;
    }

    // at-rule
    if (ch === 64 /* @ */) {
      let j = i + 1;
      while (j < n && isIdentPart(code.charCodeAt(j))) j++;
      out += span('keyword', code.slice(i, j));
      i = j;
      continue;
    }

    // structural punctuation controlling the prop/value state machine
    if (ch === 123 /* { */) {
      out += span('punct', '{');
      depth++;
      beforeColon = true;
      i++;
      continue;
    }
    if (ch === 125 /* } */) {
      out += span('punct', '}');
      if (depth > 0) depth--;
      beforeColon = true;
      i++;
      continue;
    }
    if (ch === 59 /* ; */) {
      out += span('punct', ';');
      beforeColon = true;
      i++;
      continue;
    }
    if (ch === 58 /* : */) {
      out += span('punct', ':');
      beforeColon = false;
      i++;
      continue;
    }

    // number (+ trailing unit stays plain)
    if (isDigit(ch) || (ch === 46 && isDigit(code.charCodeAt(i + 1)))) {
      let j = i + 1;
      while (j < n && isNumberPart(code.charCodeAt(j))) j++;
      out += span('number', code.slice(i, j));
      i = j;
      continue;
    }

    // identifier-ish run (property, value keyword, selector fragment)
    if (isIdentStart(ch) || ch === 45 /* - */) {
      let j = i + 1;
      while (
        j < n &&
        (isIdentPart(code.charCodeAt(j)) || code.charCodeAt(j) === 45)
      ) {
        j++;
      }
      const word = code.slice(i, j);
      if (depth > 0 && beforeColon) {
        out += span('prop', word);
      } else {
        out += escapeHtml(word);
      }
      i = j;
      continue;
    }

    if (isPunct(ch)) {
      out += span('punct', code.charAt(i));
      i++;
      continue;
    }

    out += escapeHtml(code.charAt(i));
    i++;
  }

  return out;
}

/* ------------------------------------------------------------------ *
 * HTML
 * ------------------------------------------------------------------ */

function isTagChar(ch: number): boolean {
  return isIdentPart(ch) || ch === 45 /* - */ || ch === 58 /* : */;
}

function highlightHtml(code: string): string {
  const n = code.length;
  let out = '';
  let i = 0;

  while (i < n) {
    const ch = code.charCodeAt(i);

    // comment <!-- -->
    if (ch === 60 && code.startsWith('<!--', i)) {
      const idx = code.indexOf('-->', i + 4);
      const j = idx === -1 ? n : idx + 3;
      out += span('comment', code.slice(i, j));
      i = j;
      continue;
    }

    // tag
    if (ch === 60 /* < */) {
      let j = i + 1;
      if (code.charCodeAt(j) === 47 /* / */) j++;
      out += span('punct', code.slice(i, j));
      // tag name
      const nameStart = j;
      while (j < n && isTagChar(code.charCodeAt(j))) j++;
      if (j > nameStart) out += span('keyword', code.slice(nameStart, j));
      // attributes up to '>'
      while (j < n && code.charCodeAt(j) !== 62 /* > */) {
        const c = code.charCodeAt(j);
        if (c === 34 || c === 39) {
          const end = consumeString(code, j, c);
          out += span('string', code.slice(j, end));
          j = end;
          continue;
        }
        if (c === 61 /* = */) {
          out += span('punct', '=');
          j++;
          continue;
        }
        if (isTagChar(c)) {
          const a = j;
          while (j < n && isTagChar(code.charCodeAt(j))) j++;
          out += span('prop', code.slice(a, j));
          continue;
        }
        out += escapeHtml(code.charAt(j));
        j++;
      }
      if (j < n && code.charCodeAt(j) === 62) {
        out += span('punct', '>');
        j++;
      }
      i = j;
      continue;
    }

    // entity &name; / &#123;
    if (ch === 38 /* & */) {
      let j = i + 1;
      while (
        j < n &&
        j - i < 12 &&
        code.charCodeAt(j) !== 59 &&
        (isIdentPart(code.charCodeAt(j)) || code.charCodeAt(j) === 35)
      ) {
        j++;
      }
      if (j < n && code.charCodeAt(j) === 59) {
        out += span('type', code.slice(i, j + 1));
        i = j + 1;
        continue;
      }
    }

    out += escapeHtml(code.charAt(i));
    i++;
  }

  return out;
}

/* ------------------------------------------------------------------ *
 * Markdown
 * ------------------------------------------------------------------ */

function highlightMarkdownLine(line: string): string {
  const n = line.length;
  let out = '';
  let i = 0;

  // leading whitespace
  while (i < n && (line.charCodeAt(i) === 32 || line.charCodeAt(i) === 9)) {
    out += line.charAt(i);
    i++;
  }

  // heading marker: #{1,6} followed by space
  if (line.charCodeAt(i) === 35 /* # */) {
    let h = i;
    while (h < n && line.charCodeAt(h) === 35) h++;
    if (h - i <= 6 && (h >= n || line.charCodeAt(h) === 32)) {
      out += span('keyword', line.slice(i, h));
      i = h;
    }
  } else if (line.charCodeAt(i) === 62 /* > */) {
    // blockquote marker
    out += span('keyword', '>');
    i++;
  } else {
    // list marker: - + * or `N.`
    const c = line.charCodeAt(i);
    if ((c === 45 || c === 43 || c === 42) && line.charCodeAt(i + 1) === 32) {
      out += span('punct', line.charAt(i));
      i++;
    }
  }

  // inline scan of the remainder
  while (i < n) {
    const ch = line.charCodeAt(i);

    // inline code `…`
    if (ch === 96 /* ` */) {
      let j = i + 1;
      while (j < n && line.charCodeAt(j) !== 96) j++;
      j = Math.min(n, j + 1);
      out += span('string', line.slice(i, j));
      i = j;
      continue;
    }

    // emphasis markers ** * _ ~~
    if (ch === 42 /* * */ || ch === 95 /* _ */ || ch === 126 /* ~ */) {
      let j = i;
      while (j < n && line.charCodeAt(j) === ch) j++;
      out += span('punct', line.slice(i, j));
      i = j;
      continue;
    }

    // link / image punctuation
    if (ch === 91 || ch === 93 || ch === 40 || ch === 41) {
      out += span('punct', line.charAt(i));
      i++;
      continue;
    }

    out += escapeHtml(line.charAt(i));
    i++;
  }

  return out;
}

function highlightMarkdown(code: string): string {
  const lines = code.split('\n');
  let out = '';
  for (let i = 0; i < lines.length; i++) {
    if (i > 0) out += '\n';
    out += highlightMarkdownLine(lines[i] ?? '');
  }
  return out;
}

/* ------------------------------------------------------------------ *
 * Python
 * ------------------------------------------------------------------ */

function highlightPython(code: string): string {
  const n = code.length;
  let out = '';
  let i = 0;
  let prevWord = '';

  while (i < n) {
    const ch = code.charCodeAt(i);

    // comment # …
    if (ch === 35 /* # */) {
      let j = i + 1;
      while (j < n && code.charCodeAt(j) !== 10) j++;
      out += span('comment', code.slice(i, j));
      i = j;
      continue;
    }

    // triple-quoted string
    if (
      (ch === 34 || ch === 39) &&
      code.charCodeAt(i + 1) === ch &&
      code.charCodeAt(i + 2) === ch
    ) {
      const marker = code.slice(i, i + 3);
      const idx = code.indexOf(marker, i + 3);
      const j = idx === -1 ? n : idx + 3;
      out += span('string', code.slice(i, j));
      i = j;
      prevWord = '';
      continue;
    }

    // single/double string
    if (ch === 34 || ch === 39) {
      const end = consumeString(code, i, ch);
      out += span('string', code.slice(i, end));
      i = end;
      prevWord = '';
      continue;
    }

    // decorator @name
    if (ch === 64 /* @ */ && isIdentStart(code.charCodeAt(i + 1))) {
      let j = i + 1;
      while (j < n && isIdentPart(code.charCodeAt(j))) j++;
      out += span('keyword', code.slice(i, j));
      i = j;
      continue;
    }

    // number
    if (isDigit(ch) || (ch === 46 && isDigit(code.charCodeAt(i + 1)))) {
      let j = i + 1;
      while (j < n && isNumberPart(code.charCodeAt(j))) j++;
      out += span('number', code.slice(i, j));
      i = j;
      prevWord = '';
      continue;
    }

    // identifier / keyword / fn
    if (isIdentStart(ch)) {
      let j = i + 1;
      while (j < n && isIdentPart(code.charCodeAt(j))) j++;
      const word = code.slice(i, j);
      if (PY_KEYWORDS.has(word)) {
        out += span('keyword', word);
      } else if (prevWord === 'def') {
        out += span('fn', word);
      } else if (prevWord === 'class') {
        out += span('type', word);
      } else {
        // call?
        let k = j;
        while (k < n && (code.charCodeAt(k) === 32 || code.charCodeAt(k) === 9))
          k++;
        out +=
          code.charCodeAt(k) === 40 ? span('fn', word) : escapeHtml(word);
      }
      prevWord = word;
      i = j;
      continue;
    }

    if (isPunct(ch)) {
      out += span('punct', code.charAt(i));
      i++;
      continue;
    }

    out += escapeHtml(code.charAt(i));
    i++;
  }

  return out;
}

/* ------------------------------------------------------------------ *
 * Bash
 * ------------------------------------------------------------------ */

function highlightBash(code: string): string {
  const n = code.length;
  let out = '';
  let i = 0;

  while (i < n) {
    const ch = code.charCodeAt(i);

    // comment # … (only when the '#' begins a word)
    if (ch === 35 /* # */) {
      const prev = i > 0 ? code.charCodeAt(i - 1) : 10;
      if (
        i === 0 ||
        prev === 32 ||
        prev === 9 ||
        prev === 10 ||
        prev === 13 ||
        prev === 59 /* ; */
      ) {
        let j = i + 1;
        while (j < n && code.charCodeAt(j) !== 10) j++;
        out += span('comment', code.slice(i, j));
        i = j;
        continue;
      }
    }

    // strings
    if (ch === 34 || ch === 39) {
      const end = consumeString(code, i, ch);
      out += span('string', code.slice(i, end));
      i = end;
      continue;
    }

    // variable $name / ${name} / $1
    if (ch === 36 /* $ */) {
      let j = i + 1;
      if (code.charCodeAt(j) === 123 /* { */) {
        while (j < n && code.charCodeAt(j) !== 125 /* } */) j++;
        j = Math.min(n, j + 1);
      } else {
        while (j < n && isIdentPart(code.charCodeAt(j))) j++;
      }
      out += span('prop', code.slice(i, j));
      i = j;
      continue;
    }

    // number
    if (isDigit(ch)) {
      let j = i + 1;
      while (j < n && isNumberPart(code.charCodeAt(j))) j++;
      out += span('number', code.slice(i, j));
      i = j;
      continue;
    }

    // word / keyword
    if (isIdentStart(ch)) {
      let j = i + 1;
      while (j < n && isIdentPart(code.charCodeAt(j))) j++;
      const word = code.slice(i, j);
      out += BASH_KEYWORDS.has(word)
        ? span('keyword', word)
        : escapeHtml(word);
      i = j;
      continue;
    }

    if (isPunct(ch)) {
      out += span('punct', code.charAt(i));
      i++;
      continue;
    }

    out += escapeHtml(code.charAt(i));
    i++;
  }

  return out;
}

/* ------------------------------------------------------------------ *
 * SQL
 * ------------------------------------------------------------------ */

function highlightSql(code: string): string {
  const n = code.length;
  let out = '';
  let i = 0;

  while (i < n) {
    const ch = code.charCodeAt(i);

    // line comment -- …
    if (ch === 45 /* - */ && code.charCodeAt(i + 1) === 45) {
      let j = i + 2;
      while (j < n && code.charCodeAt(j) !== 10) j++;
      out += span('comment', code.slice(i, j));
      i = j;
      continue;
    }

    // block comment /* */
    if (ch === 47 && code.charCodeAt(i + 1) === 42) {
      let j = i + 2;
      while (
        j < n &&
        !(code.charCodeAt(j) === 42 && code.charCodeAt(j + 1) === 47)
      ) {
        j++;
      }
      j = Math.min(n, j + 2);
      out += span('comment', code.slice(i, j));
      i = j;
      continue;
    }

    // strings (single-quoted values, double-quoted identifiers)
    if (ch === 39 || ch === 34) {
      const end = consumeString(code, i, ch);
      out += span('string', code.slice(i, end));
      i = end;
      continue;
    }

    // number
    if (isDigit(ch) || (ch === 46 && isDigit(code.charCodeAt(i + 1)))) {
      let j = i + 1;
      while (j < n && isNumberPart(code.charCodeAt(j))) j++;
      out += span('number', code.slice(i, j));
      i = j;
      continue;
    }

    // keyword (case-insensitive) / identifier
    if (isIdentStart(ch)) {
      let j = i + 1;
      while (j < n && isIdentPart(code.charCodeAt(j))) j++;
      const word = code.slice(i, j);
      out += SQL_KEYWORDS.has(word.toLowerCase())
        ? span('keyword', word)
        : escapeHtml(word);
      i = j;
      continue;
    }

    if (isPunct(ch)) {
      out += span('punct', code.charAt(i));
      i++;
      continue;
    }

    out += escapeHtml(code.charAt(i));
    i++;
  }

  return out;
}

/* ------------------------------------------------------------------ *
 * Language resolution + dispatch
 * ------------------------------------------------------------------ */

/**
 * Alias map → canonical tokenizer key. Anything absent here (and from
 * {@link TOKENIZERS}) is treated as plain text, e.g. `yaml`/`yml`.
 */
const ALIASES: Record<string, string> = {
  js: 'javascript',
  jsx: 'javascript',
  javascript: 'javascript',
  mjs: 'javascript',
  cjs: 'javascript',
  ts: 'typescript',
  tsx: 'typescript',
  typescript: 'typescript',
  json: 'json',
  jsonc: 'json',
  json5: 'json',
  css: 'css',
  html: 'html',
  htm: 'html',
  xml: 'html',
  md: 'markdown',
  markdown: 'markdown',
  py: 'python',
  python: 'python',
  sh: 'bash',
  bash: 'bash',
  shell: 'bash',
  zsh: 'bash',
  sql: 'sql',
};

const TOKENIZERS: Record<string, (code: string) => string> = {
  javascript: highlightCLike,
  typescript: highlightCLike,
  json: highlightJson,
  css: highlightCss,
  html: highlightHtml,
  markdown: highlightMarkdown,
  python: highlightPython,
  bash: highlightBash,
  sql: highlightSql,
};

/**
 * Highlight `code` for the given fence `info` string.
 *
 * `info` is the WHOLE fence info (e.g. `"js {1,3}"` or `"ts title=foo"`); the
 * language is the first whitespace-delimited token, lowercased, run through
 * {@link ALIASES}. Unknown / empty / unsupported languages return the escaped
 * source with no spans, so the output is always safe to inject.
 *
 * @param lang the fence info string (language + any attributes)
 * @param code the raw code block source
 * @returns HTML with `<span class="tw-tok-KIND">` tokens; fully HTML-escaped.
 */
export function highlightToHtml(lang: string, code: string): string {
  const info = typeof lang === 'string' ? lang : '';
  const first = info.trim().split(/\s+/)[0] ?? '';
  const key = first.toLowerCase();
  const resolved = ALIASES[key] ?? key;
  const tokenizer = TOKENIZERS[resolved];
  if (!tokenizer) return escapeHtml(code);
  return tokenizer(code);
}
