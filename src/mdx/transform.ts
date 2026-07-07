/**
 * `src/mdx/transform.ts` — MDX transform adapters (SPEC.md §7, step 2).
 *
 * Turning JSX/TS into runnable plain JS is the one conceded boundary. This
 * module resolves an {@link MdxTransform} into a uniform async compile function
 * `(code, meta?) => Promise<string>`:
 *
 *  - `'wasm-esbuild'` → dynamically imports the OPTIONAL peer `esbuild-wasm`.
 *  - `'wasm-swc'`     → dynamically imports the OPTIONAL peer `@swc/wasm-web`.
 *      Both peers are never bundled and never hard-imported; if absent, a clear
 *      Error naming the missing peer is thrown. The host is responsible for
 *      initializing the wasm engine (its `wasmURL` is environment-specific).
 *  - `'constrained'`  → a built-in, ZERO-DEPENDENCY transform for a restricted
 *      MDX-JS subset (see grammar below). No external parser.
 *  - a function       → returned as-is (host-supplied), wrapped to a Promise.
 *  - `undefined`      → a transform that throws "no MDX transform configured"
 *      (the editor treats this as "render escaped source").
 *
 * ── Constrained subset (exact, compiled to `h(tag, props, ...children)`) ──────
 * The constrained transform is a small hand-written recursive-descent parser for
 * a bounded surface — deliberately NOT a general JS parser. It accepts:
 *
 *   Module      := (Line)*                    lines beginning with `import`/`export`
 *                                             (at column 0) are stripped/hoisted out
 *   Body        := (Text | Element | Interp)*  the remaining top-level content
 *   Element     := '<' Name Attr* '/>'
 *                | '<' Name Attr* '>' Children '</' Name '>'
 *   Name        := [A-Za-z][A-Za-z0-9._-]*     Capitalized → component; the root
 *                                             identifier is bound from the map
 *                                             (`const Chart = components["Chart"]`) and the
 *                                             tag is emitted bare (`h(Chart, …)`, `h(Foo.Bar, …)`);
 *                                             lowercase → HTML string tag. A capitalized name
 *                                             whose segments aren't identifiers is rejected.
 *   Attr        := Name                        boolean shorthand → `true`
 *                | Name '=' '"' … '"'          string literal
 *                | Name '=' "'" … "'"          string literal
 *                | Name '=' '{' Expr '}'       restricted expression
 *   Children    := (Text | Element | Interp)*
 *   Interp      := '{' Expr '}'                interpolation child
 *   Expr        := number | 'true' | 'false' | 'null'
 *                | Identifier                  e.g. `name`
 *                | Identifier ('.' Identifier)+  simple member, e.g. `user.name`
 *   Text        := run of chars that are not '<' or '{' (JSX entities untouched)
 *
 * Anything outside this subset (arrow functions, calls, operators, object/array
 * literals, template strings, JSX fragments `<>…</>`, spread `{...x}`, mismatched
 * tags, unterminated constructs) throws a clear Error — it never silently
 * miscompiles. Hosts needing the full surface use `wasm-esbuild`/`wasm-swc`.
 *
 * Output shape: the compiled module is a statement list ending in a `return`,
 * closing over the sandbox-injected `h`, `components`, and `props`. Example:
 *   `<Callout type="info">Hi {name}</Callout>`  →
 *     const Callout = components["Callout"];
 *     return h(Callout, {"type": "info"}, "Hi ", name);
 */

import type { MdxTransform } from '../types';

export interface TransformMeta {
  filename?: string;
}

export type CompileFn = (code: string, meta?: TransformMeta) => Promise<string>;

/* ------------------------------------------------------------------ *
 * Resolution
 * ------------------------------------------------------------------ */

/** Resolve an {@link MdxTransform} into a uniform async compile function. */
export function resolveTransform(t: MdxTransform | undefined): CompileFn {
  if (t === undefined) {
    return async () => {
      throw new Error('no MDX transform configured');
    };
  }
  if (typeof t === 'function') {
    return async (code, meta) => t(code, meta ?? {});
  }
  switch (t) {
    case 'constrained':
      return async (code) => compileConstrained(code);
    case 'wasm-esbuild':
      return (code, meta) => transformWithEsbuild(code, meta);
    case 'wasm-swc':
      return (code, meta) => transformWithSwc(code, meta);
    default: {
      // Exhaustiveness: a new MdxTransform string must be handled here.
      const never: never = t;
      throw new Error(`typewright/mdx: unknown MDX transform "${String(never)}"`);
    }
  }
}

/* ------------------------------------------------------------------ *
 * Optional-peer wasm adapters
 * ------------------------------------------------------------------ */

/**
 * Dynamically import an optional peer by a NON-literal specifier so no bundler
 * tries to resolve/inline it. Throws a clear, actionable Error if it is absent.
 */
async function importOptionalPeer(name: string): Promise<Record<string, unknown>> {
  const specifier = name; // variable → non-analyzable → never bundled
  try {
    return (await import(/* @vite-ignore */ specifier)) as Record<string, unknown>;
  } catch (cause) {
    throw new Error(
      `typewright/mdx: this MDX transform needs the optional peer dependency "${name}", ` +
        `which is not installed. Install it (e.g. \`npm i ${name}\`) or choose a different ` +
        `MdxTransform ("constrained" has zero dependencies).`,
      { cause },
    );
  }
}

function loaderFor(meta?: TransformMeta): 'tsx' | 'jsx' {
  return /\.tsx?$/.test(meta?.filename ?? '') ? 'tsx' : 'jsx';
}

async function transformWithEsbuild(code: string, meta?: TransformMeta): Promise<string> {
  const esbuild = await importOptionalPeer('esbuild-wasm');
  const transform = esbuild.transform as
    | ((input: string, options: unknown) => Promise<{ code: string }>)
    | undefined;
  if (typeof transform !== 'function') {
    throw new Error('typewright/mdx: "esbuild-wasm" is installed but exposes no transform().');
  }
  const result = await transform(code, {
    loader: loaderFor(meta),
    jsx: 'automatic',
    format: 'esm',
    sourcefile: meta?.filename,
  });
  return result.code;
}

async function transformWithSwc(code: string, meta?: TransformMeta): Promise<string> {
  const swc = await importOptionalPeer('@swc/wasm-web');
  const transform = swc.transform as
    | ((input: string, options: unknown) => Promise<{ code: string }>)
    | undefined;
  if (typeof transform !== 'function') {
    throw new Error('typewright/mdx: "@swc/wasm-web" is installed but exposes no transform().');
  }
  const tsx = loaderFor(meta) === 'tsx';
  const result = await transform(code, {
    filename: meta?.filename,
    jsc: {
      parser: tsx
        ? { syntax: 'typescript', tsx: true }
        : { syntax: 'ecmascript', jsx: true },
      transform: { react: { runtime: 'automatic' } },
    },
  });
  return result.code;
}

/* ------------------------------------------------------------------ *
 * Constrained transform — zero-dependency restricted JSX compiler
 * ------------------------------------------------------------------ */

type ConstrainedNode =
  | { kind: 'text'; value: string }
  | { kind: 'expr'; source: string }
  | { kind: 'element'; name: string; attrs: Attr[]; children: ConstrainedNode[] };

interface Attr {
  name: string;
  /** `undefined` → boolean shorthand (`true`). */
  value?: { kind: 'string'; value: string } | { kind: 'expr'; source: string };
}

class TransformError extends Error {
  constructor(message: string, index: number) {
    super(`constrained MDX transform: ${message} (at offset ${index})`);
    this.name = 'TransformError';
  }
}

const IDENT_START = /[A-Za-z_$]/;
const IDENT_PART = /[A-Za-z0-9_$]/;
const NAME_PART = /[A-Za-z0-9._-]/;

/** Compile the restricted MDX subset to a sandbox module string. */
export function compileConstrained(source: string): string {
  const { body, components } = new ConstrainedParser(source).parse();
  const parts: string[] = [];
  for (const name of components) {
    parts.push(`const ${name} = components[${JSON.stringify(name)}];`);
  }
  parts.push(`return ${childrenExpr(body)};`);
  return parts.join('\n');
}

/** Strip top-level `import`/`export` lines; return the remaining body. */
function stripModuleLines(source: string): string {
  const kept: string[] = [];
  for (const line of source.split('\n')) {
    if (/^\s*(import|export)\b/.test(line)) {
      // Line-based hoist: imports/exports are dropped (components come from the
      // injected `components` map, not resolved modules — documented limitation).
      kept.push('');
    } else {
      kept.push(line);
    }
  }
  return kept.join('\n');
}

class ConstrainedParser {
  private readonly src: string;
  private pos = 0;
  private readonly components = new Set<string>();

  constructor(rawSource: string) {
    this.src = stripModuleLines(rawSource);
  }

  parse(): { body: ConstrainedNode[]; components: string[] } {
    const body = this.parseChildren(null);
    this.skipInsignificantWhitespace();
    if (this.pos < this.src.length) {
      throw new TransformError(`unexpected "${this.src[this.pos]}"`, this.pos);
    }
    return { body, components: [...this.components] };
  }

  private parseChildren(closeTag: string | null): ConstrainedNode[] {
    const children: ConstrainedNode[] = [];
    for (;;) {
      if (this.pos >= this.src.length) {
        if (closeTag !== null) {
          throw new TransformError(`unclosed <${closeTag}>`, this.pos);
        }
        return children;
      }
      const ch = this.src[this.pos];
      if (ch === '<') {
        if (this.src[this.pos + 1] === '/') {
          // Closing tag — belongs to the caller.
          if (closeTag === null) {
            throw new TransformError('unexpected closing tag', this.pos);
          }
          return children;
        }
        children.push(this.parseElement());
      } else if (ch === '{') {
        children.push({ kind: 'expr', source: this.parseBracedExpr() });
      } else {
        const text = this.parseText();
        if (text.value.length > 0) children.push(text);
      }
    }
  }

  private parseText(): { kind: 'text'; value: string } {
    let out = '';
    while (this.pos < this.src.length) {
      const ch = this.src[this.pos];
      if (ch === '<' || ch === '{') break;
      out += ch;
      this.pos++;
    }
    return { kind: 'text', value: out };
  }

  private parseElement(): ConstrainedNode {
    const start = this.pos;
    this.expect('<');
    const name = this.parseName();
    if (isComponentName(name)) this.components.add(componentRoot(name, start));
    const attrs: Attr[] = [];
    for (;;) {
      this.skipWhitespace();
      const ch = this.src[this.pos];
      if (ch === undefined) throw new TransformError('unterminated tag', start);
      if (ch === '/') {
        this.expect('/');
        this.expect('>');
        return { kind: 'element', name, attrs, children: [] };
      }
      if (ch === '>') {
        this.pos++;
        const children = this.parseChildren(name);
        this.expect('<');
        this.expect('/');
        this.skipWhitespace();
        const closeName = this.parseName();
        if (closeName !== name) {
          throw new TransformError(`mismatched closing tag </${closeName}> for <${name}>`, this.pos);
        }
        this.skipWhitespace();
        this.expect('>');
        return { kind: 'element', name, attrs, children };
      }
      attrs.push(this.parseAttr());
    }
  }

  private parseAttr(): Attr {
    const name = this.parseName();
    this.skipWhitespace();
    if (this.src[this.pos] !== '=') {
      return { name }; // boolean shorthand
    }
    this.pos++; // '='
    this.skipWhitespace();
    const ch = this.src[this.pos];
    if (ch === '"' || ch === "'") {
      return { name, value: { kind: 'string', value: this.parseStringLiteral(ch) } };
    }
    if (ch === '{') {
      return { name, value: { kind: 'expr', source: this.parseBracedExpr() } };
    }
    throw new TransformError(`attribute "${name}" must be a string literal or a {expression}`, this.pos);
  }

  private parseName(): string {
    const start = this.pos;
    const first = this.src[this.pos];
    if (first === undefined || !/[A-Za-z]/.test(first)) {
      throw new TransformError('expected a tag/attribute name', this.pos);
    }
    let out = first;
    this.pos++;
    while (this.pos < this.src.length && NAME_PART.test(this.src[this.pos] as string)) {
      out += this.src[this.pos];
      this.pos++;
    }
    if (out.endsWith('.') || out.endsWith('-')) {
      throw new TransformError(`invalid name "${out}"`, start);
    }
    return out;
  }

  private parseStringLiteral(quote: string): string {
    this.expect(quote);
    let out = '';
    while (this.pos < this.src.length) {
      const ch = this.src[this.pos];
      if (ch === quote) {
        this.pos++;
        return out;
      }
      if (ch === '\\') {
        // Keep escapes literal-safe: capture the next char verbatim.
        out += ch;
        this.pos++;
        if (this.pos < this.src.length) {
          out += this.src[this.pos];
          this.pos++;
        }
        continue;
      }
      out += ch;
      this.pos++;
    }
    throw new TransformError('unterminated string literal', this.pos);
  }

  /** Consume `{ … }` and return the validated restricted expression source. */
  private parseBracedExpr(): string {
    const start = this.pos;
    this.expect('{');
    let depth = 1;
    let raw = '';
    while (this.pos < this.src.length && depth > 0) {
      const ch = this.src[this.pos];
      if (ch === '{') depth++;
      else if (ch === '}') {
        depth--;
        if (depth === 0) {
          this.pos++;
          break;
        }
      }
      raw += ch;
      this.pos++;
    }
    if (depth !== 0) throw new TransformError('unterminated {expression}', start);
    return validateRestrictedExpr(raw.trim(), start);
  }

  private expect(ch: string): void {
    if (this.src[this.pos] !== ch) {
      throw new TransformError(`expected "${ch}"`, this.pos);
    }
    this.pos++;
  }

  private skipWhitespace(): void {
    while (this.pos < this.src.length && /\s/.test(this.src[this.pos] as string)) this.pos++;
  }

  /** Skip trailing whitespace-only content when checking for EOF. */
  private skipInsignificantWhitespace(): void {
    while (this.pos < this.src.length && /\s/.test(this.src[this.pos] as string)) this.pos++;
  }
}

function isComponentName(name: string): boolean {
  return /^[A-Z]/.test(name);
}

const SIMPLE_IDENT = /^[A-Za-z_$][A-Za-z0-9_$]*$/;

/**
 * For a capitalized component tag (optionally a member expression like
 * `Foo.Bar`), validate that every segment is a plain identifier and return the
 * ROOT identifier to bind from the `components` map (`const Foo = components["Foo"]`;
 * the tag itself is emitted as the bare dotted path). Throws on names that would
 * not form valid JS (e.g. a hyphenated capitalized name).
 */
function componentRoot(name: string, index: number): string {
  const segments = name.split('.');
  for (const seg of segments) {
    if (!SIMPLE_IDENT.test(seg)) {
      throw new TransformError(
        `unsupported component name "${name}" — component tags must be dot-separated identifiers`,
        index,
      );
    }
  }
  return segments[0] as string;
}

/**
 * Validate that `expr` is a restricted expression (number/boolean/null,
 * identifier, or a simple dotted member). Returns it unchanged; throws
 * otherwise. This is the guard that keeps the subset safe and predictable — no
 * calls, operators, or function bodies slip through.
 */
function validateRestrictedExpr(expr: string, index: number): string {
  if (expr.length === 0) {
    throw new TransformError('empty {expression}', index);
  }
  if (expr === 'true' || expr === 'false' || expr === 'null') return expr;
  if (/^-?\d+(\.\d+)?$/.test(expr)) return expr;
  if (isSimpleMemberPath(expr)) return expr;
  throw new TransformError(
    `unsupported expression \`${expr}\` — only numbers, true/false/null, ` +
      `an identifier, or a simple dotted member (a.b.c) are allowed`,
    index,
  );
}

/** `foo` or `foo.bar.baz` — each segment a valid JS identifier. */
function isSimpleMemberPath(expr: string): boolean {
  const segments = expr.split('.');
  for (const seg of segments) {
    if (seg.length === 0) return false;
    if (!IDENT_START.test(seg[0] as string)) return false;
    for (let i = 1; i < seg.length; i++) {
      if (!IDENT_PART.test(seg[i] as string)) return false;
    }
  }
  return true;
}

/* ------------------------------------------------------------------ *
 * Codegen
 * ------------------------------------------------------------------ */

function childrenExpr(children: ConstrainedNode[]): string {
  const rendered = children.map(nodeExpr).filter((s) => s !== null) as string[];
  if (rendered.length === 0) return 'null';
  if (rendered.length === 1) return rendered[0] as string;
  return `[${rendered.join(', ')}]`;
}

function nodeExpr(node: ConstrainedNode): string | null {
  if (node.kind === 'text') {
    if (node.value.trim().length === 0 && node.value.indexOf('\n') !== -1) {
      // Whitespace-only text spanning a line break is layout noise — drop it,
      // matching JSX's whitespace handling for readability.
      return null;
    }
    return JSON.stringify(node.value);
  }
  if (node.kind === 'expr') {
    return node.source;
  }
  const tag = isComponentName(node.name) ? node.name : JSON.stringify(node.name);
  const props = attrsExpr(node.attrs);
  const kids = node.children.map(nodeExpr).filter((s) => s !== null) as string[];
  const args = [tag, props, ...kids];
  return `h(${args.join(', ')})`;
}

function attrsExpr(attrs: Attr[]): string {
  if (attrs.length === 0) return 'null';
  const entries = attrs.map((attr) => {
    const key = JSON.stringify(attr.name);
    if (attr.value === undefined) return `${key}: true`;
    if (attr.value.kind === 'string') return `${key}: ${JSON.stringify(attr.value.value)}`;
    return `${key}: ${attr.value.source}`;
  });
  return `{${entries.join(', ')}}`;
}
