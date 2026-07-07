import { describe, it, expect, vi } from 'vitest';
import { createStreamController } from './index';

describe('createStreamController', () => {
  it('emits the full buffer immediately when smoothing is off', () => {
    const seen: string[] = [];
    const c = createStreamController((t) => seen.push(t));
    c.push('Hello world');
    expect(seen.at(-1)).toBe('Hello world');
    expect(c.text).toBe('Hello world');
    c.push(' again');
    expect(seen.at(-1)).toBe('Hello world again');
  });

  it('reveals a growing prefix over time and flushes on end when smoothing is on', () => {
    vi.useFakeTimers();
    try {
      const seen: string[] = [];
      const c = createStreamController((t) => seen.push(t), { smooth: { charsPerSecond: 100 } });
      c.push('Hello world'); // 11 chars — buffered whole, revealed gradually
      expect(c.text).toBe('Hello world'); // the full buffer is retained
      expect((seen.at(-1) ?? '').length).toBeLessThan(11); // not revealed all at once

      vi.advanceTimersByTime(40); // one reveal tick
      const mid = seen.at(-1) ?? '';
      expect(mid.length).toBeGreaterThan(0);
      expect(mid.length).toBeLessThan(11);
      expect('Hello world'.startsWith(mid)).toBe(true); // a real prefix, never reordered

      c.end();
      expect(seen.at(-1)).toBe('Hello world'); // end() flushes everything
      expect(c.complete).toBe(true);
    } finally {
      vi.clearAllTimers();
      vi.useRealTimers();
    }
  });

  it('clears the reveal timer on reset (no leak, no further emits)', () => {
    vi.useFakeTimers();
    try {
      const seen: string[] = [];
      const c = createStreamController((t) => seen.push(t), { smooth: true });
      c.push('some streaming text that reveals slowly');
      c.reset();
      const n = seen.length;
      vi.advanceTimersByTime(5000);
      expect(seen.length).toBe(n); // timer stopped — no ticks fire after reset
      expect(c.text).toBe('');
    } finally {
      vi.clearAllTimers();
      vi.useRealTimers();
    }
  });
});
