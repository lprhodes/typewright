import { describe, it, expect } from 'vitest';
import { resolveTransform, compileConstrained } from './transform';

describe('resolveTransform', () => {
  it('passes a host-supplied function through (async-wrapped)', async () => {
    const calls: Array<{ code: string; meta: unknown }> = [];
    const fn = (code: string, meta: { filename?: string }): string => {
      calls.push({ code, meta });
      return `/*compiled*/ ${code}`;
    };
    const compile = resolveTransform(fn);
    await expect(compile('<x/>', { filename: 'a.jsx' })).resolves.toBe('/*compiled*/ <x/>');
    expect(calls[0]?.meta).toEqual({ filename: 'a.jsx' });
    // meta defaults to {} when omitted
    await compile('<y/>');
    expect(calls[1]?.meta).toEqual({});
  });

  it('undefined resolves to a transform that throws "no MDX transform configured"', async () => {
    const compile = resolveTransform(undefined);
    await expect(compile('anything')).rejects.toThrow('no MDX transform configured');
  });

  it('wasm-esbuild throws a clear "peer not installed" error when the peer is absent', async () => {
    const compile = resolveTransform('wasm-esbuild');
    await expect(compile('<x/>')).rejects.toThrow(/esbuild-wasm/);
    await expect(compile('<x/>')).rejects.toThrow(/not installed/);
  });

  it('wasm-swc throws a clear "peer not installed" error when the peer is absent', async () => {
    const compile = resolveTransform('wasm-swc');
    await expect(compile('<x/>')).rejects.toThrow(/@swc\/wasm-web/);
    await expect(compile('<x/>')).rejects.toThrow(/not installed/);
  });
});

describe('constrained transform — accepted subset', () => {
  it('compiles a component with a string attr and a text + interpolation child', () => {
    const out = compileConstrained('<Callout type="info">Hi {name}</Callout>');
    // component is resolved from the components map
    expect(out).toContain('const Callout = components["Callout"];');
    // h() call with the component identifier (not a string), props, and children
    expect(out).toContain('return h(Callout, {"type": "info"}, "Hi ", name);');
  });

  it('compiles a self-closing component with an attribute', () => {
    const out = compileConstrained('<Chart kind="area" />');
    expect(out).toContain('const Chart = components["Chart"];');
    expect(out).toContain('return h(Chart, {"kind": "area"});');
  });

  it('lowercase tags become string tags; nested elements nest their h() calls', () => {
    const out = compileConstrained('<div class="box"><span>hi</span></div>');
    expect(out).toContain('return h("div", {"class": "box"}, h("span", null, "hi"));');
    // no component destructuring for pure-HTML trees
    expect(out).not.toContain('components[');
  });

  it('supports {number|boolean|null} and {simple.member} expressions in attrs', () => {
    const out = compileConstrained('<Box count={3} active={true} title={user.name} empty={null} />');
    expect(out).toContain('"count": 3');
    expect(out).toContain('"active": true');
    expect(out).toContain('"title": user.name');
    expect(out).toContain('"empty": null');
  });

  it('treats a valueless attribute as boolean true', () => {
    const out = compileConstrained('<input disabled />');
    expect(out).toContain('return h("input", {"disabled": true});');
  });

  it('strips top-level import/export lines (components come from the map)', () => {
    const src = [
      'import Chart from "./chart";',
      'export const meta = 1;',
      '<Chart kind="bar" />',
    ].join('\n');
    const out = compileConstrained(src);
    expect(out).not.toContain('import');
    expect(out).not.toContain('export const');
    expect(out).toContain('const Chart = components["Chart"];');
    expect(out).toContain('return h(Chart, {"kind": "bar"});');
  });

  it('renders multiple top-level children as an array', () => {
    const out = compileConstrained('<a href="/x">one</a><b>two</b>');
    expect(out).toContain('return [h("a", {"href": "/x"}, "one"), h("b", null, "two")];');
  });

  it('binds the ROOT identifier for a member-expression component tag', () => {
    const out = compileConstrained('<Chart.Bar kind="area" />');
    // only the root `Chart` is destructured; the tag is the bare dotted path
    expect(out).toContain('const Chart = components["Chart"];');
    expect(out).not.toContain('Chart.Bar =');
    expect(out).toContain('return h(Chart.Bar, {"kind": "area"});');
  });
});

describe('constrained transform — rejected constructs', () => {
  it('rejects an arrow-function expression with a clear error', () => {
    expect(() => compileConstrained('<Btn onClick={() => 1} />')).toThrow(
      /unsupported expression/,
    );
  });

  it('rejects a function call in an interpolation', () => {
    expect(() => compileConstrained('<p>{doThing()}</p>')).toThrow(/unsupported expression/);
  });

  it('rejects an object/spread expression', () => {
    expect(() => compileConstrained('<Box style={{a: 1}} />')).toThrow(/unsupported expression/);
  });

  it('rejects a mismatched closing tag', () => {
    expect(() => compileConstrained('<div><span>hi</div></span>')).toThrow(/mismatched closing tag/);
  });

  it('rejects an unclosed element', () => {
    expect(() => compileConstrained('<div>hi')).toThrow(/unclosed <div>/);
  });

  it('rejects a stray closing tag', () => {
    expect(() => compileConstrained('</div>')).toThrow(/unexpected closing tag/);
  });

  it('rejects an operator expression', () => {
    expect(() => compileConstrained('<p>{a + b}</p>')).toThrow(/unsupported expression/);
  });

  it('rejects a capitalized tag whose segments are not valid identifiers', () => {
    expect(() => compileConstrained('<Foo-bar />')).toThrow(/unsupported component name/);
  });
});
