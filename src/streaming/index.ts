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

export { anticipate } from './anticipate';
export type { AnticipateResult } from './anticipate';

/** Default reveal rate when `smooth` is `true` (chars/second). */
const DEFAULT_CPS = 220;
/** Reveal-timer cadence — ~30fps, so the cursor advances in small steady steps. */
const TICK_MS = 1000 / 30;

/**
 * Create a controller that accumulates an incoming token stream and emits the
 * running text on every update.
 *
 * When {@link StreamOptions.smooth} is set the FULL buffer is retained (readable
 * via `.text`) but `onUpdate` receives only a steadily-revealed prefix: a timer
 * advances a reveal cursor at the target rate (`charsPerSecond`, or a default),
 * so bursty chunk arrivals read as smooth typing. `end()` reveals everything and
 * clears the timer; `reset()` clears it too — no timer or handle is ever leaked.
 *
 * @param onUpdate  Called with the emitted text (revealed prefix when smoothing)
 *                  and whether the stream has ended.
 * @param options   Anticipation / smoothing options (see SPEC.md §8).
 */
export function createStreamController(
  onUpdate: (text: string, complete: boolean) => void,
  options: StreamOptions = {},
): StreamController {
  const smoothCfg =
    !options.smooth
      ? null
      : typeof options.smooth === 'object'
        ? options.smooth
        : { charsPerSecond: DEFAULT_CPS };
  const cps = smoothCfg && smoothCfg.charsPerSecond > 0 ? smoothCfg.charsPerSecond : DEFAULT_CPS;
  // Chars revealed per tick — deterministic (no wall-clock), so it is stable
  // under fake timers and averages to the requested rate.
  const perTick = Math.max(1, Math.round((cps * TICK_MS) / 1000));

  let text = '';
  let revealed = 0;
  let complete = false;
  let timer: ReturnType<typeof setInterval> | null = null;

  const emit = (): void => onUpdate(smoothCfg ? text.slice(0, revealed) : text, complete);

  const stopTimer = (): void => {
    if (timer !== null) {
      clearInterval(timer);
      timer = null;
    }
  };
  const tick = (): void => {
    revealed = Math.min(text.length, revealed + perTick);
    emit();
    if (revealed >= text.length) stopTimer();
  };
  const ensureTimer = (): void => {
    if (timer !== null || complete || revealed >= text.length) return;
    timer = setInterval(tick, TICK_MS);
  };

  return {
    push(chunk: string): void {
      if (complete) return;
      text += chunk;
      if (smoothCfg) ensureTimer();
      emit();
    },
    replace(full: string): void {
      text = full;
      complete = false;
      if (smoothCfg) {
        if (revealed > text.length) revealed = text.length;
        ensureTimer();
      }
      emit();
    },
    end(): void {
      complete = true;
      revealed = text.length; // flush everything on completion
      stopTimer();
      emit();
    },
    reset(): void {
      text = '';
      revealed = 0;
      complete = false;
      stopTimer();
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
