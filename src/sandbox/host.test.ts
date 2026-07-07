// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  createSandbox,
  shouldAcceptMessage,
  dispatchInbound,
  buildSandboxCsp,
  buildSandboxSrcdoc,
  buildEvaluateMessage,
  MODULE_BINDINGS,
  createChannelToken,
  type InboundResult,
} from './host';

/* ------------------------------------------------------------------ *
 * Pure protocol helpers
 * ------------------------------------------------------------------ */

describe('shouldAcceptMessage (token + source gate)', () => {
  const SOURCE = { id: 'frame-window' };

  it('accepts a message from the right source with the right token', () => {
    const ok = shouldAcceptMessage(
      { source: SOURCE, data: { token: 'secret', type: 'host' } },
      { source: SOURCE, token: 'secret' },
    );
    expect(ok).toBe(true);
  });

  it('ignores a message with the wrong token', () => {
    const ok = shouldAcceptMessage(
      { source: SOURCE, data: { token: 'WRONG', type: 'host' } },
      { source: SOURCE, token: 'secret' },
    );
    expect(ok).toBe(false);
  });

  it('ignores a message from the wrong source even with the right token', () => {
    const ok = shouldAcceptMessage(
      { source: { id: 'other-window' }, data: { token: 'secret', type: 'host' } },
      { source: SOURCE, token: 'secret' },
    );
    expect(ok).toBe(false);
  });

  it('ignores non-object payloads', () => {
    expect(
      shouldAcceptMessage({ source: SOURCE, data: 'nope' }, { source: SOURCE, token: 'secret' }),
    ).toBe(false);
    expect(
      shouldAcceptMessage({ source: SOURCE, data: null }, { source: SOURCE, token: 'secret' }),
    ).toBe(false);
  });
});

describe('dispatchInbound', () => {
  it('routes ready → onReady', () => {
    const onReady = vi.fn();
    dispatchInbound({ type: 'ready' }, { onReady });
    expect(onReady).toHaveBeenCalledOnce();
  });

  it('routes host → onHost with the payload', () => {
    const onHost = vi.fn();
    dispatchInbound({ type: 'host', payload: { fetch: '/x' } }, { onHost });
    expect(onHost).toHaveBeenCalledWith({ fetch: '/x' });
  });

  it('routes an id-carrying result → onResult, normalizing fields', () => {
    const results: Array<[number, InboundResult]> = [];
    dispatchInbound(
      { type: 'result', id: 7, html: '<b>ok</b>', height: 42 },
      { onResult: (id, r) => results.push([id, r]) },
    );
    expect(results).toEqual([[7, { html: '<b>ok</b>', svg: undefined, height: 42, error: undefined }]]);
  });

  it('carries svg + error results through', () => {
    const onResult = vi.fn();
    dispatchInbound({ id: 1, svg: '<svg/>' }, { onResult });
    expect(onResult).toHaveBeenCalledWith(1, { html: undefined, svg: '<svg/>', height: undefined, error: undefined });
    onResult.mockClear();
    dispatchInbound({ id: 2, error: 'boom' }, { onResult });
    expect(onResult).toHaveBeenCalledWith(2, { html: undefined, svg: undefined, height: undefined, error: 'boom' });
  });

  it('ignores messages with no id and no recognized type', () => {
    const onResult = vi.fn();
    const onHost = vi.fn();
    dispatchInbound({ foo: 'bar' }, { onResult, onHost });
    expect(onResult).not.toHaveBeenCalled();
    expect(onHost).not.toHaveBeenCalled();
  });
});

describe('buildSandboxCsp', () => {
  it('bakes a strict default-src none with unsafe-inline scripts', () => {
    const csp = buildSandboxCsp();
    expect(csp).toContain("default-src 'none'");
    expect(csp).toContain("script-src 'unsafe-inline'");
    expect(csp).toContain("style-src 'unsafe-inline'");
    expect(csp).toContain('img-src data: https:');
    // opaque-origin execution never needs eval
    expect(csp).not.toContain('unsafe-eval');
  });

  it('appends host-supplied extra directives', () => {
    const csp = buildSandboxCsp('connect-src https://api.example.com');
    expect(csp).toContain("default-src 'none'");
    expect(csp).toContain('connect-src https://api.example.com');
  });
});

describe('buildSandboxSrcdoc', () => {
  it('embeds the CSP meta and the channel token, and inlines engine source', () => {
    const doc = buildSandboxSrcdoc({
      token: 'tok123',
      csp: buildSandboxCsp(),
      engineSource: 'self.__twMermaidRender = function(){};',
    });
    expect(doc).toContain('http-equiv="Content-Security-Policy"');
    expect(doc).toContain("default-src 'none'");
    expect(doc).toContain('"tok123"'); // token baked in (JSON-encoded)
    expect(doc).toContain('self.__twMermaidRender');
    expect(doc).toContain('id="tw-root"');
  });

  it('neutralizes a premature </script> in inlined engine source', () => {
    const doc = buildSandboxSrcdoc({
      token: 't',
      csp: 'default-src \'none\'',
      engineSource: 'var x = "</script>";',
    });
    // the raw closing tag must not appear verbatim inside the engine <script>
    expect(doc).not.toContain('"</script>"');
    expect(doc).toContain('<\\/script>');
  });
});

describe('component-map wiring (evaluate → frame → module)', () => {
  // Regression: SandboxIsland calls evaluate(js, { components }), so the map
  // must reach the compiled module. Previously the in-frame dispatch read a
  // never-sent top-level `data.components`, leaving RT.components = {} and the
  // transform's `const Callout = components["Callout"]` resolving to undefined
  // (silently rendering an <undefined> element). These lock the wiring end-to-end.

  it('buildEvaluateMessage carries the host component map under props.components', () => {
    const Callout = () => null;
    const msg = buildEvaluateMessage('return h("div")', { components: { Callout } });
    expect(msg.code).toBe('return h("div")');
    expect(msg.props.components).toEqual({ Callout });
  });

  it('buildEvaluateMessage defaults props to an empty object', () => {
    expect(buildEvaluateMessage('return 1')).toEqual({ code: 'return 1', props: {} });
  });

  it('the in-frame dispatch forwards props.components into runModule → RT.components', () => {
    const srcdoc = buildSandboxSrcdoc({ token: 't', csp: buildSandboxCsp() });
    // The fix: read the standardized field the sender writes (props.components),
    // not the never-sent `data.components`, and bind it as the module map.
    expect(srcdoc).toContain(
      'runModule(data.id, data.code, data.props, data.props && data.props.components)',
    );
    expect(srcdoc).toContain('RT.components = components || {}');
    // …and the module wrapper the frame runs exposes it as `components`.
    expect(srcdoc).toContain(MODULE_BINDINGS);
  });

  it('the module wrapper binds self.__tw.components → the module-scoped `components`', () => {
    // Execute the EXACT bindings source the frame injects (MODULE_BINDINGS) and
    // prove a compiled module referencing components["Callout"] resolves the host
    // component — the end the bug silently rendered as <undefined>.
    const Callout = (): string => 'CALLOUT';
    document.body.innerHTML = '<div id="tw-root"></div>';
    (globalThis as unknown as { __tw?: unknown }).__tw = {
      h: () => null,
      host: () => undefined,
      components: { Callout },
      props: {},
    };
    try {
      const wrapper =
        '"use strict";(function(){' + MODULE_BINDINGS + 'return components["Callout"];})();';
      // eval is intentional and safe here: `wrapper` is a fixed, test-authored
      // string (MODULE_BINDINGS is a module constant, no interpolation) — this
      // reproduces exactly how the sandbox frame runs a compiled module so the
      // binding contract is exercised without a live iframe.
      // eslint-disable-next-line no-eval
      const bound = eval(wrapper);
      expect(bound).toBe(Callout);
    } finally {
      delete (globalThis as unknown as { __tw?: unknown }).__tw;
    }
  });
});

describe('createChannelToken', () => {
  it('produces non-empty, per-call-unique tokens', () => {
    const a = createChannelToken();
    const b = createChannelToken();
    expect(a.length).toBeGreaterThanOrEqual(16);
    expect(a).not.toBe(b);
  });
});

/* ------------------------------------------------------------------ *
 * createSandbox integration (jsdom): the security boundary + wiring
 * ------------------------------------------------------------------ */

describe('createSandbox', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  function currentIframe(): HTMLIFrameElement {
    const el = document.body.querySelector('iframe');
    if (!el) throw new Error('no sandbox iframe found');
    return el;
  }

  function tokenOf(iframe: HTMLIFrameElement): string {
    const match = /var TOKEN = "([^"]+)"/.exec(iframe.srcdoc);
    if (!match) throw new Error('token not found in srcdoc');
    return match[1] as string;
  }

  it('creates a hidden opaque-origin iframe: sandbox="allow-scripts", never allow-same-origin', () => {
    const controller = createSandbox();
    try {
      const iframe = currentIframe();
      expect(iframe.getAttribute('sandbox')).toBe('allow-scripts');
      expect(iframe.getAttribute('sandbox')).not.toContain('allow-same-origin');
      expect(iframe.srcdoc).toContain('Content-Security-Policy');
    } finally {
      controller.destroy();
    }
  });

  it('invokes onHostMessage for a valid host-brokered message', () => {
    const onHostMessage = vi.fn();
    const controller = createSandbox({ onHostMessage });
    try {
      const iframe = currentIframe();
      const token = tokenOf(iframe);
      window.dispatchEvent(
        new MessageEvent('message', {
          data: { token, type: 'host', payload: { need: 'fetch' } },
          source: iframe.contentWindow,
        }),
      );
      expect(onHostMessage).toHaveBeenCalledWith({ need: 'fetch' });
    } finally {
      controller.destroy();
    }
  });

  it('ignores a host message with the wrong token', () => {
    const onHostMessage = vi.fn();
    const controller = createSandbox({ onHostMessage });
    try {
      const iframe = currentIframe();
      window.dispatchEvent(
        new MessageEvent('message', {
          data: { token: 'not-the-token', type: 'host', payload: 1 },
          source: iframe.contentWindow,
        }),
      );
      expect(onHostMessage).not.toHaveBeenCalled();
    } finally {
      controller.destroy();
    }
  });

  it('ignores a message from the wrong source even with a valid token', () => {
    const onHostMessage = vi.fn();
    const controller = createSandbox({ onHostMessage });
    try {
      const iframe = currentIframe();
      const token = tokenOf(iframe);
      window.dispatchEvent(
        new MessageEvent('message', {
          data: { token, type: 'host', payload: 1 },
          source: window, // not iframe.contentWindow
        }),
      );
      expect(onHostMessage).not.toHaveBeenCalled();
    } finally {
      controller.destroy();
    }
  });

  it('destroy removes the iframe and stops delivering messages', () => {
    const onHostMessage = vi.fn();
    const controller = createSandbox({ onHostMessage });
    const iframe = currentIframe();
    const token = tokenOf(iframe);
    const source = iframe.contentWindow;

    controller.destroy();
    expect(document.body.contains(iframe)).toBe(false);

    // After destroy, the window listener is gone — a valid message is a no-op.
    window.dispatchEvent(
      new MessageEvent('message', { data: { token, type: 'host', payload: 1 }, source }),
    );
    expect(onHostMessage).not.toHaveBeenCalled();
  });

  it('resolves evaluate with an error once destroyed (never hangs)', async () => {
    const controller = createSandbox();
    controller.destroy();
    await expect(controller.evaluate('return "x";')).resolves.toEqual({
      html: undefined,
      height: undefined,
      error: 'sandbox destroyed',
    });
  });

  it('fails fast with a clear error when postMessage throws (never hangs)', async () => {
    // A non-structured-cloneable payload (e.g. a function in the component map)
    // makes the browser's postMessage throw DataCloneError. jsdom does not
    // clone-validate, so we force the throw to exercise flush()'s guard: it
    // must settle the request with a clear error, not hang until the timeout.
    const controller = createSandbox({ timeoutMs: 300 });
    const iframe = currentIframe();
    const token = tokenOf(iframe);
    const source = iframe.contentWindow!;
    vi.spyOn(source, 'postMessage').mockImplementation(() => {
      throw new DOMException('could not be cloned', 'DataCloneError');
    });
    // Simulate the frame signalling ready so the outbox flushes.
    window.dispatchEvent(new MessageEvent('message', { data: { token, type: 'ready' }, source }));
    const result = await controller.evaluate('return null;', {
      components: { X: () => null },
    });
    expect(result.error).toMatch(/not serializable/i);
  });
});
