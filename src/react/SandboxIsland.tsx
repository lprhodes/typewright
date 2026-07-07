import * as React from 'react';
import { createSandbox, resolveTransform } from '../mdx';
import type { SandboxController } from '../mdx';
import type { ComponentMap, MdxTransform, SandboxOptions } from '../types';

/**
 * SandboxIsland — one executable widget island rendered *as the sandbox iframe*
 * (Phase D4 / E1, SPEC.md §7/§11). The compiled MDX / Mermaid output stays
 * **inside** the opaque-origin `<iframe sandbox="allow-scripts">` created by
 * {@link createSandbox}; the host tree never `innerHTML`s the untrusted output
 * (invariant K-3). The iframe itself is the widget — this component only mounts
 * the sandbox into a container `<div>` it owns, un-hides + sizes the iframe once
 * the sandbox reports a height, and shows an inline error card on failure.
 *
 * Lifecycle:
 *  - **create/reuse** — a single sandbox is created on mount (in a container ref
 *    passed as {@link createSandbox}'s `container`) and reused across `code`
 *    edits; it is recreated only when the engine identity changes (a Mermaid
 *    engine or CSP is baked into the sandbox document at creation).
 *  - **evaluate** — DEBOUNCED ~250 ms after `code` (or the MDX transform/
 *    components) change: `mdx` → `resolveTransform(transform)(code)` then
 *    `sandbox.evaluate(js, {components})`; `mermaid` → `sandbox.renderMermaid(code)`.
 *  - **destroy** — the sandbox is torn down on unmount.
 *
 * Failure handling (invariant K-6 — editing must never break): a transform
 * throw, an `evaluate`/`renderMermaid` error result, or any unexpected throw is
 * caught and surfaced as an inline `.tw-island-error` card (the message is
 * rendered as escaped text by React, never as HTML). The component itself never
 * throws during render.
 *
 * With no MDX transform configured the island falls back to the escaped source
 * in a `<pre>` (the "no transform" case) — the same safe form the renderer uses.
 */
export interface SandboxIslandProps {
  /** `mdx` runs a compiled MDX module; `mermaid` renders a diagram. */
  kind: 'mdx' | 'mermaid';
  /** Raw `mdxFlow` source (mdx), or the Mermaid diagram source (mermaid). */
  code: string;
  /** How to compile the MDX source to runnable JS (mdx only). */
  transform?: MdxTransform;
  /** Components made available to the compiled module (mdx only). */
  components?: ComponentMap;
  /** Sandbox options (opaque-origin iframe; `allowSameOrigin` is type-forbidden). */
  sandbox?: SandboxOptions;
  /** Resolved Mermaid engine JavaScript *source*, inlined into the sandbox (mermaid only). */
  mermaidEngine?: string;
  /** Colour scheme hint applied to the iframe + error card. */
  theme?: 'light' | 'dark';
}

/** How long an edit settles before the island re-compiles/renders. */
const DEBOUNCE_MS = 250;

/** The one iframe {@link createSandbox} appended into `host`, if any. */
function frameOf(host: HTMLElement | null): HTMLIFrameElement | null {
  return host?.querySelector<HTMLIFrameElement>('iframe') ?? null;
}

/** Reveal + size the (default-hidden) sandbox iframe so it becomes the widget. */
function showFrame(iframe: HTMLIFrameElement, height: number | undefined, theme: 'light' | 'dark'): void {
  iframe.style.position = 'static';
  iframe.style.visibility = 'visible';
  iframe.style.pointerEvents = 'auto';
  iframe.style.width = '100%';
  iframe.style.height = `${Math.max(1, Math.ceil(height ?? 0))}px`;
  iframe.style.colorScheme = theme;
}

/** Collapse the iframe (kept mounted for reuse; the error card takes its place). */
function hideFrame(iframe: HTMLIFrameElement): void {
  iframe.style.visibility = 'hidden';
  iframe.style.height = '0';
  iframe.style.pointerEvents = 'none';
}

/** Best-effort message text for an error card (never throws). */
function errorText(err: unknown): string {
  if (typeof err === 'string') return err;
  if (err && typeof err === 'object' && 'message' in err) {
    return String((err as { message: unknown }).message);
  }
  return String(err);
}

function SandboxIslandBase(props: SandboxIslandProps): React.ReactElement {
  const { kind, code, transform, components, sandbox, mermaidEngine, theme = 'light' } = props;

  const hostRef = React.useRef<HTMLDivElement>(null);
  const [controller, setController] = React.useState<SandboxController | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  // Freshest theme for the DEBOUNCED reveal, without making the run re-fire on a
  // pure theme change (the theme effect below restyles an already-shown frame).
  const themeRef = React.useRef(theme);
  themeRef.current = theme;

  // The "no MDX transform" case renders the escaped source (below) and needs no
  // sandbox at all; every other case runs inside the opaque-origin iframe.
  const needsSandbox = !(kind === 'mdx' && transform === undefined);
  const sandboxCsp = sandbox?.csp;

  // --- create / destroy the sandbox (reused across `code` edits) ------------
  React.useEffect(() => {
    if (!needsSandbox) return undefined;
    if (typeof document === 'undefined') return undefined;
    const container = hostRef.current;
    if (!container) return undefined;
    let ctrl: SandboxController | null = null;
    try {
      ctrl = createSandbox({
        ...sandbox,
        container,
        mermaidEngine: kind === 'mermaid' ? mermaidEngine : undefined,
      });
    } catch (err) {
      setError(errorText(err));
      return undefined;
    }
    setController(ctrl);
    return () => {
      ctrl?.destroy();
      setController(null);
    };
    // The engine source + CSP are baked into the sandbox document at creation,
    // so a change there requires a fresh sandbox; `transform`/`components`/`code`
    // do not (they flow through `evaluate`, handled by the run effect below).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kind, needsSandbox, mermaidEngine, sandboxCsp]);

  // --- debounced compile + evaluate -----------------------------------------
  React.useEffect(() => {
    if (!controller) return undefined;
    const iframe = frameOf(hostRef.current);
    if (!code.trim()) {
      // Nothing to run — clear any prior error and collapse the frame.
      setError(null);
      if (iframe) hideFrame(iframe);
      return undefined;
    }
    let canceled = false;
    const succeed = (height: number | undefined): void => {
      if (canceled) return;
      setError(null);
      const f = frameOf(hostRef.current);
      if (f) showFrame(f, height, themeRef.current);
    };
    const fail = (err: unknown): void => {
      if (canceled) return;
      setError(errorText(err));
      const f = frameOf(hostRef.current);
      if (f) hideFrame(f);
    };
    const timer = setTimeout(() => {
      void (async () => {
        try {
          if (kind === 'mdx') {
            let js: string;
            try {
              js = await resolveTransform(transform)(code);
            } catch (err) {
              fail(err);
              return;
            }
            const result = await controller.evaluate(js, { components });
            if (result.error) fail(result.error);
            else succeed(result.height);
          } else {
            const result = await controller.renderMermaid(code);
            if (result.error) fail(result.error);
            else succeed(result.height);
          }
        } catch (err) {
          // Defence in depth: no failure path may bubble out of the island.
          fail(err);
        }
      })();
    }, DEBOUNCE_MS);
    return () => {
      canceled = true;
      clearTimeout(timer);
    };
  }, [controller, kind, code, transform, components]);

  // --- live theme restyle of an already-visible frame -----------------------
  React.useEffect(() => {
    const iframe = frameOf(hostRef.current);
    if (iframe && iframe.style.visibility === 'visible') iframe.style.colorScheme = theme;
  }, [theme]);

  // "No transform configured" → the safe escaped-source fallback (React escapes
  // the text child), matching the renderer's default `mdxFlow` output.
  if (kind === 'mdx' && transform === undefined) {
    return <pre className="tw-island-src">{code}</pre>;
  }

  const title = kind === 'mdx' ? 'Component failed' : 'Diagram failed';
  return (
    <div className={`tw-island tw-island-${kind}${error !== null ? ' tw-island-failed' : ''}`} data-tw-island={kind}>
      <div className="tw-island-frame" ref={hostRef} aria-hidden={error !== null} />
      {error !== null && (
        <div className="tw-island-error" role="alert">
          <div className="tw-island-error-title">
            <span aria-hidden="true">⚠</span> {title}
          </div>
          <pre className="tw-island-error-msg">{error}</pre>
        </div>
      )}
    </div>
  );
}

/**
 * Memoized so an island only re-compiles/re-renders when its own `code`/config
 * changes — a keystroke in a *different* block leaves every island untouched.
 */
export const SandboxIsland = React.memo(SandboxIslandBase);

/* ------------------------------------------------------------------ *
 * Styles (injected into the editor's single stylesheet)
 * ------------------------------------------------------------------ */

export const SANDBOX_ISLAND_CSS = `
.tw-island{position:relative;margin:.6em 0;width:100%}
.tw-island-frame{display:block;width:100%}
.tw-island-frame iframe{display:block;border:0;width:100%;background:transparent;color-scheme:inherit}
.tw-island-src{white-space:pre-wrap}
.tw-island-error{border:1px solid color-mix(in srgb, #e5484d 42%, var(--tw-line));border-left:3px solid #e5484d;border-radius:9px;background:color-mix(in srgb, #e5484d 8%, var(--tw-bg));padding:9px 12px;margin:.2em 0}
.tw-island-error-title{display:flex;align-items:center;gap:6px;font-size:12.5px;font-weight:640;color:#e5484d}
.tw-island-error-msg{margin:5px 0 0;padding:0;border:0;background:none;font-family:"SF Mono",ui-monospace,Menlo,monospace;font-size:11.5px;line-height:1.5;color:var(--tw-muted);white-space:pre-wrap;overflow-wrap:anywhere}
`;
