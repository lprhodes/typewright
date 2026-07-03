/**
 * `typewright/streaming` — feed an AI/LLM token stream into a preview.
 *
 * Status: PRE-ALPHA SCAFFOLD. Text accumulation and stream piping below are
 * real and usable. The anticipatory formatting renderer — turning an incomplete
 * `*bo` into in-progress bold, an unterminated fence into an open code block,
 * and partial JSX into a component skeleton (SPEC.md §8) — is not yet wired to
 * a view; `createStreamController` accumulates and emits raw text for now.
 */

import type { StreamController, StreamOptions } from '../types';

export type {
  StreamController,
  StreamOptions,
  AnticipationOptions,
} from '../types';

/**
 * Create a controller that accumulates an incoming token stream and emits the
 * running text on every update.
 *
 * @param onUpdate  Called with the accumulated text and whether the stream ended.
 * @param options   Anticipation / smoothing options (see SPEC.md §8; not yet applied).
 */
export function createStreamController(
  onUpdate: (text: string, complete: boolean) => void,
  options: StreamOptions = {},
): StreamController {
  void options; // reserved for the anticipation engine (SPEC.md §8)
  let text = '';
  let complete = false;
  const emit = (): void => onUpdate(text, complete);

  return {
    push(chunk: string): void {
      if (complete) return;
      text += chunk;
      emit();
    },
    replace(full: string): void {
      text = full;
      complete = false;
      emit();
    },
    end(): void {
      complete = true;
      emit();
    },
    reset(): void {
      text = '';
      complete = false;
      emit();
    },
    get text(): string {
      return text;
    },
    get complete(): boolean {
      return complete;
    },
  };
}

/**
 * Drive a controller from an async iterable or a `ReadableStream` of string
 * chunks, calling `end()` when the source is exhausted.
 *
 * @example
 *   const controller = createStreamController(setText);
 *   await pipeStream(llmResponse.textStream, controller);
 */
export async function pipeStream(
  source: AsyncIterable<string> | ReadableStream<string>,
  controller: StreamController,
): Promise<void> {
  if (Symbol.asyncIterator in source) {
    for await (const chunk of source as AsyncIterable<string>) {
      controller.push(chunk);
    }
  } else {
    const reader = source.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value != null) controller.push(value);
    }
  }
  controller.end();
}
