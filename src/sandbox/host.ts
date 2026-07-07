/**
 * `src/sandbox/host.ts` — the opaque-origin execution sandbox (SPEC.md §7, §11).
 *
 * Anything executable (compiled MDX, Mermaid diagrams) runs here, never in the
 * host document. The sandbox is a hidden `<iframe srcdoc sandbox="allow-scripts">`
 * with an **opaque origin** — `allow-same-origin` is NEVER granted, so a payload
 * cannot reach `parent.document`, storage, cookies, or the network beyond what
 * the CSP permits. This closes the XSS→RCE escalation and is Electron-safe.
 *
 * Security model (why this is safe without origin checks)
 * ------------------------------------------------------
 *  - The iframe is opaque-origin, so every message it posts arrives at the host
 *    with `event.origin === "null"`. Origin therefore cannot authenticate the
 *    channel. Instead we validate:
 *      1. `event.source === iframe.contentWindow` — the message really came from
 *         *our* frame (not a sibling frame or another window), and
 *      2. `message.token === <per-instance random token>` — the message carries
 *         the secret channel token baked into this frame's `srcdoc`.
 *    Both must hold; mismatches are silently ignored. The same token+source gate
 *    is applied *inside* the frame (it only accepts messages whose source is its
 *    `parent` and whose token matches).
 *  - The CSP baked into the srcdoc is `default-src 'none'` with only
 *    `'unsafe-inline'` scripts/styles (extendable via {@link SandboxOptions.csp}).
 *    Compiled modules run as DOM-inserted **inline** `<script>` elements — which
 *    `'unsafe-inline'` permits — so we never need `'unsafe-eval'`/`new Function`.
 *  - Compiled output renders **inside** the iframe (the iframe *is* the widget).
 *    The host never `innerHTML`s compiled output into its own tree. `evaluate`
 *    resolves with the produced `html` for informational/read-mode use only; the
 *    host must treat it as untrusted.
 *  - A component's legitimate host/network needs are brokered: code inside the
 *    frame calls `host(payload)` → `postMessage({type:'host', payload})` → the
 *    host's {@link SandboxOptions.onHostMessage}, which proxies the request.
 *
 * The message-validation and dispatch logic is factored into pure functions
 * ({@link shouldAcceptMessage}, {@link dispatchInbound}, {@link buildSandboxCsp},
 * {@link buildSandboxSrcdoc}) so the protocol is unit-testable without a real
 * cross-origin frame (end-to-end iframe evaluation is covered by the e2e suite).
 */

import type { SandboxOptions } from '../types';

/* ------------------------------------------------------------------ *
 * Public surface
 * ------------------------------------------------------------------ */

/** Result of evaluating a compiled module inside the sandbox. */
export interface EvaluateResult {
  /**
   * Serialized HTML the module produced (already rendered inside the iframe).
   * Informational only — the host MUST NOT inject this into its own DOM.
   */
  html?: string;
  /** Measured content height of the iframe, for sizing the widget. */
  height?: number;
  /** Present when evaluation threw; the module never crashes the host. */
  error?: string;
}

/** Result of rendering a Mermaid diagram inside the sandbox. */
export interface MermaidResult {
  /** The diagram SVG (already rendered inside the iframe). */
  svg?: string;
  height?: number;
  error?: string;
}

/** Controller returned by {@link createSandbox}. */
export interface SandboxController {
  /**
   * Evaluate a compiled module body inside the sandbox. `code` is a statement
   * list that closes over the injected `h`, `components`, `props`, `host`, and
   * `root`, and returns the rendered result (an HTML string, a DOM node, or
   * nothing if it mounts into `root` itself). See the transform adapters in
   * `src/mdx/transform.ts` for the code shape.
   */
  evaluate(code: string, props?: Record<string, unknown>): Promise<EvaluateResult>;
  /** Render a Mermaid diagram source using the injected engine (if any). */
  renderMermaid(src: string): Promise<MermaidResult>;
  /** Tear down: remove the iframe, drop listeners, settle pending calls. */
  destroy(): void;
}

/**
 * Options for {@link createSandbox}. A superset of the public
 * {@link SandboxOptions} with host-only injection points (an existing
 * `SandboxOptions` is accepted as-is).
 */
export interface CreateSandboxOptions extends SandboxOptions {
  /** Element to append the hidden iframe to (defaults to `document.body`). */
  container?: HTMLElement;
  /**
   * Milliseconds before an `evaluate` / `renderMermaid` call resolves with a
   * timeout error (never rejects). `0` disables the timeout. Defaults to 8000.
   */
  timeoutMs?: number;
  /**
   * JavaScript *source* of a Mermaid-compatible engine, inlined into the sandbox
   * document (see {@link import('../types').MermaidOptions.getEngine}). Expected
   * to define `self.__twMermaidRender(src)` or `self.mermaid`.
   */
  mermaidEngine?: string;
}

/* ------------------------------------------------------------------ *
 * Pure protocol helpers (unit-tested)
 * ------------------------------------------------------------------ */

/** Normalized shape of an inbound result message from the frame. */
export interface InboundResult {
  html?: string;
  svg?: string;
  height?: number;
  error?: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/**
 * Decide whether an inbound `message` event should be trusted. Replaces the
 * origin check (useless for an opaque-origin frame, where `event.origin` is
 * always `"null"`) with a source-identity + secret-token check.
 */
export function shouldAcceptMessage(
  event: { source?: unknown; data?: unknown },
  ctx: { source: unknown; token: string },
): boolean {
  // The frame's own window must be the sender — not a sibling frame or a
  // rogue opener that happens to know the token.
  if (event.source !== ctx.source) return false;
  const data = event.data;
  if (!isRecord(data)) return false;
  return data.token === ctx.token;
}

/**
 * Route a *trusted* inbound message to the right handler. `ready` unlocks the
 * outbound queue, `host` is brokered to {@link SandboxOptions.onHostMessage},
 * anything carrying a numeric `id` settles the matching pending call.
 */
export function dispatchInbound(
  data: Record<string, unknown>,
  handlers: {
    onReady?: () => void;
    onHost?: (payload: unknown) => void;
    onResult?: (id: number, result: InboundResult) => void;
  },
): void {
  const type = data.type;
  if (type === 'ready') {
    handlers.onReady?.();
    return;
  }
  if (type === 'host') {
    handlers.onHost?.(data.payload);
    return;
  }
  if (typeof data.id === 'number') {
    handlers.onResult?.(data.id, {
      html: typeof data.html === 'string' ? data.html : undefined,
      svg: typeof data.svg === 'string' ? data.svg : undefined,
      height: typeof data.height === 'number' ? data.height : undefined,
      error: typeof data.error === 'string' ? data.error : undefined,
    });
  }
}

/**
 * Build the frame-bound payload for an `evaluate` request. The host component
 * map travels under `props.components` — the single standardized field that the
 * in-frame `runModule` reads to bind the module's `components` (see
 * {@link MODULE_BINDINGS} and the dispatch in {@link SANDBOX_BOOTSTRAP}).
 * Centralizing the shape here keeps the sender and the frame in agreement and
 * makes the wiring unit-testable without a live iframe.
 */
export function buildEvaluateMessage(
  code: string,
  props?: Record<string, unknown>,
): { code: string; props: Record<string, unknown> } {
  return { code, props: props ?? {} };
}

/**
 * The lexical bindings every compiled module closes over, injected verbatim as
 * the head of the in-frame module wrapper (see {@link SANDBOX_BOOTSTRAP}).
 * Notably it binds `components` ← `self.__tw.components` (the host's component
 * map), which the constrained transform relies on (`const Callout =
 * components["Callout"]`). Exported so the binding contract is unit-testable
 * against the exact source the frame runs — no drift.
 */
export const MODULE_BINDINGS =
  'var h=self.__tw.h,host=self.__tw.host,components=self.__tw.components,' +
  'props=self.__tw.props,root=document.getElementById("tw-root");';

/** The strict base CSP for the sandbox document; `extra` is appended. */
export function buildSandboxCsp(extra?: string): string {
  const base =
    "default-src 'none'; " +
    "script-src 'unsafe-inline'; " +
    "style-src 'unsafe-inline'; " +
    'img-src data: https:; ' +
    'font-src data:';
  const trimmed = extra?.trim();
  return trimmed ? `${base}; ${trimmed}` : base;
}

/** A per-instance random channel token. Prefers crypto; falls back gracefully. */
export function createChannelToken(): string {
  const cryptoObj = (globalThis as { crypto?: Crypto }).crypto;
  if (cryptoObj && typeof cryptoObj.getRandomValues === 'function') {
    const bytes = new Uint8Array(16);
    cryptoObj.getRandomValues(bytes);
    let out = '';
    for (const b of bytes) out += b.toString(16).padStart(2, '0');
    return out;
  }
  return `${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`;
}

/** Neutralize a premature `</script>` in inlined engine source. */
function neutralizeScriptClose(source: string): string {
  return source.replace(/<\/(script)/gi, '<\\/$1');
}

/**
 * Build the sandbox document. Only trusted, fixed content is inlined here (the
 * bootstrap and the optional engine source); per-evaluate module code is NEVER
 * inlined into this string — it is injected at runtime via a script element's
 * `textContent` (see the bootstrap), which is immune to `</script>` breakout.
 */
export function buildSandboxSrcdoc(params: {
  token: string;
  csp: string;
  engineSource?: string;
}): string {
  const { token, csp, engineSource } = params;
  const bootstrap = SANDBOX_BOOTSTRAP.replace('__TW_TOKEN__', JSON.stringify(token));
  return (
    '<!DOCTYPE html><html><head><meta charset="utf-8">' +
    `<meta http-equiv="Content-Security-Policy" content="${csp}">` +
    '<style>html,body{margin:0;padding:0;background:transparent;color:inherit;' +
    'font:14px/1.5 system-ui,-apple-system,sans-serif}#tw-root{display:block}</style>' +
    '</head><body><div id="tw-root"></div>' +
    (engineSource ? `<script>\n${neutralizeScriptClose(engineSource)}\n</script>` : '') +
    `<script>\n${bootstrap}\n</script>` +
    '</body></html>'
  );
}

/* ------------------------------------------------------------------ *
 * Sandbox factory
 * ------------------------------------------------------------------ */

/**
 * Create a hidden opaque-origin sandbox and return a controller for evaluating
 * compiled modules and rendering Mermaid inside it. Requires a DOM (browser or
 * jsdom). Debouncing is the caller's responsibility.
 */
export function createSandbox(opts: CreateSandboxOptions = {}): SandboxController {
  if (typeof document === 'undefined') {
    throw new Error(
      'typewright/mdx: createSandbox requires a DOM (browser or jsdom); none was found.',
    );
  }

  const token = createChannelToken();
  const csp = buildSandboxCsp(opts.csp);
  const srcdoc = buildSandboxSrcdoc({ token, csp, engineSource: opts.mermaidEngine });
  const timeoutMs = opts.timeoutMs ?? 8000;

  const iframe = document.createElement('iframe');
  // Opaque origin: scripts only, NEVER allow-same-origin (SPEC.md §7/§11).
  iframe.setAttribute('sandbox', 'allow-scripts');
  iframe.setAttribute('aria-hidden', 'true');
  iframe.setAttribute('tabindex', '-1');
  iframe.setAttribute('title', 'typewright sandbox');
  iframe.style.cssText =
    'position:absolute;width:0;height:0;border:0;visibility:hidden;pointer-events:none;';
  iframe.srcdoc = srcdoc;

  const container = opts.container ?? document.body ?? document.documentElement;
  container.appendChild(iframe);

  let destroyed = false;
  let ready = false;
  let nextId = 1;
  const outbox: Array<Record<string, unknown>> = [];
  const pending = new Map<
    number,
    { resolve: (r: InboundResult) => void; timer?: ReturnType<typeof setTimeout> }
  >();

  function flush(): void {
    if (!ready || destroyed) return;
    const win = iframe.contentWindow;
    if (!win) return;
    while (outbox.length > 0) {
      const msg = outbox.shift();
      if (msg) win.postMessage(msg, '*');
    }
  }

  function send(msg: Record<string, unknown>): void {
    // targetOrigin '*' is required: the frame is opaque-origin ("null") and
    // cannot be named. The token in the payload authenticates the channel.
    outbox.push({ ...msg, token });
    flush();
  }

  function settle(id: number, result: InboundResult): void {
    const entry = pending.get(id);
    if (!entry) return;
    pending.delete(id);
    if (entry.timer) clearTimeout(entry.timer);
    entry.resolve(result);
  }

  function request(
    kind: 'evaluate' | 'mermaid',
    extra: Record<string, unknown>,
  ): Promise<InboundResult> {
    if (destroyed) return Promise.resolve({ error: 'sandbox destroyed' });
    const id = nextId++;
    return new Promise<InboundResult>((resolve) => {
      const timer =
        timeoutMs > 0
          ? setTimeout(
              () => settle(id, { error: `sandbox ${kind} timed out after ${timeoutMs}ms` }),
              timeoutMs,
            )
          : undefined;
      pending.set(id, { resolve, timer });
      send({ type: kind, id, ...extra });
    });
  }

  function onMessage(event: MessageEvent): void {
    if (destroyed) return;
    // Opaque-origin frame → validate by source identity + token, not origin.
    if (!shouldAcceptMessage(event, { source: iframe.contentWindow, token })) return;
    dispatchInbound(event.data as Record<string, unknown>, {
      onReady: () => {
        ready = true;
        flush();
      },
      onHost: (payload) => {
        opts.onHostMessage?.(payload);
      },
      onResult: (id, result) => settle(id, result),
    });
  }

  window.addEventListener('message', onMessage);

  return {
    async evaluate(code, props) {
      const r = await request('evaluate', buildEvaluateMessage(code, props));
      return { html: r.html, height: r.height, error: r.error };
    },
    async renderMermaid(src) {
      const r = await request('mermaid', { src });
      return { svg: r.svg, height: r.height, error: r.error };
    },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      window.removeEventListener('message', onMessage);
      for (const [, entry] of pending) {
        if (entry.timer) clearTimeout(entry.timer);
        entry.resolve({ error: 'sandbox destroyed' });
      }
      pending.clear();
      iframe.remove();
    },
  };
}

/* ------------------------------------------------------------------ *
 * The in-frame bootstrap (runs inside the opaque-origin iframe)
 * ------------------------------------------------------------------ */

/**
 * Injected into the sandbox `srcdoc`. `__TW_TOKEN__` is replaced with the
 * JSON-encoded channel token. Written in ES5-ish JS (no build step runs on it)
 * and self-contained. It:
 *  - only accepts messages whose `source === parent` and whose `token` matches;
 *  - on `evaluate`, runs the module as a DOM-inserted inline script (CSP
 *    `'unsafe-inline'` — no `eval`), mounting output into `#tw-root` and posting
 *    `{ html, height }` (or `{ error }`);
 *  - on `mermaid`, calls the injected engine and posts `{ svg, height }`;
 *  - exposes `host(payload)` to brokered code, and `h()` to build DOM.
 */
const SANDBOX_BOOTSTRAP = `
(function () {
  var TOKEN = __TW_TOKEN__;
  var root = document.getElementById('tw-root') || document.body;

  function post(msg) { msg.token = TOKEN; parent.postMessage(msg, '*'); }
  function measure() {
    var de = document.documentElement, b = document.body;
    return Math.max(
      de ? de.scrollHeight : 0,
      b ? b.scrollHeight : 0,
      root ? root.scrollHeight : 0
    );
  }
  function host(payload) { post({ type: 'host', payload: payload }); }

  function appendChildren(el, children) {
    for (var i = 0; i < children.length; i++) {
      var c = children[i];
      if (c == null || c === false || c === true) continue;
      if (Object.prototype.toString.call(c) === '[object Array]') { appendChildren(el, c); continue; }
      if (typeof Node !== 'undefined' && c instanceof Node) { el.appendChild(c); continue; }
      el.appendChild(document.createTextNode(String(c)));
    }
  }
  // Hyperscript used by compiled MDX: builds real DOM (no innerHTML string
  // concatenation), returns an element. A function tag is a component.
  function h(tag, props) {
    var children = Array.prototype.slice.call(arguments, 2);
    if (typeof tag === 'function') {
      var p = {}; for (var pk in (props || {})) p[pk] = props[pk]; p.children = children;
      return tag(p);
    }
    var el = document.createElement(String(tag));
    if (props) {
      for (var key in props) {
        var v = props[key];
        if (v == null || v === false) continue;
        if (key === 'className' || key === 'class') { el.setAttribute('class', String(v)); continue; }
        if (key === 'style' && v && typeof v === 'object') {
          for (var s in v) { try { el.style[s] = v[s]; } catch (e) {} }
          continue;
        }
        if (key.slice(0, 2) === 'on') continue; // never wire inline handlers
        if (v === true) { el.setAttribute(key, ''); continue; }
        el.setAttribute(key, String(v));
      }
    }
    appendChildren(el, children);
    return el;
  }

  var RT = { h: h, host: host, props: {}, components: {}, done: null, error: null };
  self.__tw = RT;

  RT.done = function (id, out) {
    Promise.resolve(out).then(function (value) {
      try {
        if (typeof Node !== 'undefined' && value instanceof Node) root.appendChild(value);
        else if (typeof value === 'string') root.innerHTML = value;
        // else: the module mounted itself into root
      } catch (e) {}
      post({ type: 'result', id: id, html: root.innerHTML, height: measure() });
    }, function (err) {
      post({ type: 'result', id: id, error: String((err && err.message) || err) });
    });
  };
  RT.error = function (id, err) {
    post({ type: 'result', id: id, error: String((err && err.message) || err) });
  };

  function runModule(id, code, props, components) {
    RT.props = props || {};
    RT.components = components || {};
    // Inline-script injection (allowed by CSP 'unsafe-inline'; no eval). Setting
    // textContent — not innerHTML — makes any '</script>' in code inert.
    var wrapped =
      '"use strict";(function(){' +
      '${MODULE_BINDINGS}' +
      'try{var __out=(function(){' + code + '\\n})();self.__tw.done(' + id + ',__out);}' +
      'catch(__e){self.__tw.error(' + id + ',__e);}})();';
    var s = document.createElement('script');
    s.textContent = wrapped;
    (document.body || document.documentElement).appendChild(s);
    if (s.parentNode) s.parentNode.removeChild(s);
  }

  function renderMermaid(id, src) {
    try {
      var engine = null;
      if (typeof self.__twMermaidRender === 'function') {
        engine = self.__twMermaidRender;
      } else if (self.mermaid && typeof self.mermaid.render === 'function') {
        engine = function (s) {
          return Promise.resolve(self.mermaid.render('tw-mmd-' + id, s)).then(function (r) {
            return typeof r === 'string' ? r : (r && r.svg) || '';
          });
        };
      }
      if (!engine) { post({ type: 'result', id: id, error: 'no mermaid engine injected in sandbox' }); return; }
      Promise.resolve(engine(src)).then(function (svg) {
        try { root.innerHTML = svg || ''; } catch (e) {}
        post({ type: 'result', id: id, svg: svg || '', height: measure() });
      }, function (err) {
        post({ type: 'result', id: id, error: String((err && err.message) || err) });
      });
    } catch (err) {
      post({ type: 'result', id: id, error: String((err && err.message) || err) });
    }
  }

  window.addEventListener('message', function (event) {
    if (event.source !== parent) return;           // only the host frame
    var data = event.data;
    if (!data || typeof data !== 'object' || data.token !== TOKEN) return; // token gate
    // The host component map travels under props.components (see
    // buildEvaluateMessage); bind it as the module components map.
    if (data.type === 'evaluate') runModule(data.id, data.code, data.props, data.props && data.props.components);
    else if (data.type === 'mermaid') renderMermaid(data.id, data.src);
  });

  post({ type: 'ready' });
})();
`;
