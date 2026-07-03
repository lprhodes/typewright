import * as React from 'react';
import { anticipate } from '../streaming/anticipate';
import { createStreamController, pipeStream } from '../streaming';
import type { AnticipationOptions } from '../types';
import { useInjectStyles } from './TypewrightEditor';

/**
 * Streaming preview — renders an AI/LLM token stream incrementally while
 * anticipating incomplete formatting (SPEC.md §8). The HTML comes from the
 * sanitizing renderer + our own class-only pending markup, so it is safe to
 * inject.
 *
 * Drive it either by passing an updating `text` prop yourself, or by handing it
 * a `stream` (an async iterable or ReadableStream of string chunks).
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
  const text = controlledText !== undefined ? controlledText : streamed;

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

  const { html } = anticipate(text, ant);
  const cls = ['tw-editor', 'tw-streaming', className].filter(Boolean).join(' ');

  return (
    <div
      className={cls}
      style={style}
      data-typewright="streaming"
      // sanitized by render.ts + class-only pending markup
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
