import * as React from 'react';
import { anticipate } from '../streaming/anticipate';
import { createStreamController, pipeStream } from '../streaming';
import type { AnticipationOptions } from '../types';
import { useInjectStyles } from './TypewrightEditor';

/**
 * Streaming preview — renders an AI/LLM token stream incrementally while
 * anticipating incomplete formatting (SPEC.md §8). Committed blocks are
 * reconciled in place (stable, no flicker); new blocks animate in and a block
 * whose type changes (e.g. skeleton → resolved) re-animates. The HTML comes
 * from the sanitizing renderer + class-only pending markup, so it is safe.
 *
 * Drive it with an updating `text` prop, or hand it a `stream` (async iterable
 * or ReadableStream of string chunks).
 */
export interface StreamingPreviewProps {
  /** Controlled accumulated text. */
  text?: string;
  /** A stream of chunks to consume (alternative to `text`). */
  stream?: AsyncIterable<string> | ReadableStream<string>;
  /** Which incomplete constructs to optimistically render. */
  anticipate?: boolean | AnticipationOptions;
  className?: string;
  style?: React.CSSProperties;
}

export function StreamingPreview(props: StreamingPreviewProps): React.ReactElement {
  useInjectStyles();
  const { text: controlledText, stream, anticipate: ant = true, className, style } = props;
  const [streamed, setStreamed] = React.useState('');
  const value = controlledText !== undefined ? controlledText : streamed;
  const containerRef = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    if (!stream) return;
    let cancelled = false;
    setStreamed('');
    const controller = createStreamController((t) => {
      if (!cancelled) setStreamed(t);
    });
    void pipeStream(stream, controller).catch(() => {
      /* stream errored — keep what we have */
    });
    return () => {
      cancelled = true;
    };
  }, [stream]);

  // Reconcile the anticipated HTML into the container block-by-block.
  React.useEffect(() => {
    const container = containerRef.current;
    if (!container || typeof document === 'undefined') return;

    if (!value.trim()) {
      container.replaceChildren();
      return;
    }

    const { html } = anticipate(value, ant);
    const tmp = document.createElement('div');
    tmp.innerHTML = html; // sanitized by render.ts + class-only pending markup
    const next = Array.from(tmp.children) as HTMLElement[];

    for (let i = 0; i < next.length; i++) {
      const nb = next[i]!;
      const wrapper = container.children[i] as HTMLElement | undefined;
      if (!wrapper) {
        const w = document.createElement('div');
        w.className = 'tw-streamblk tw-stream-in';
        w.appendChild(nb);
        container.appendChild(w);
        continue;
      }
      const cur = wrapper.firstElementChild as HTMLElement | null;
      if (!cur || cur.outerHTML === nb.outerHTML) continue; // unchanged — keep stable
      const typeChanged = cur.tagName !== nb.tagName || cur.className !== nb.className;
      wrapper.replaceChildren(nb);
      if (typeChanged) {
        wrapper.classList.remove('tw-stream-in');
        void wrapper.offsetWidth; // reflow to restart the animation
        wrapper.classList.add('tw-stream-in');
      }
    }
    while (container.children.length > next.length) container.lastElementChild?.remove();
  }, [value, ant]);

  const cls = ['tw-editor', 'tw-streaming', className].filter(Boolean).join(' ');
  return <div ref={containerRef} className={cls} style={style} data-typewright="streaming" />;
}
