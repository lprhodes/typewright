import { describe, it, expect } from 'vitest';
import { parse } from './parser';

/**
 * Regression guard: a run of unmatched `[` / `![` must not scan to end from every
 * bracket (which was O(n^2) and froze the UI, since parse() runs on every
 * keystroke / streamed token). The label-scan cap bounds it to O(n).
 */
describe('parser performance', () => {
  it('parses a long run of unmatched [ quickly', () => {
    const big = '['.repeat(50_000);
    const start = Date.now();
    const doc = parse(big);
    const elapsed = Date.now() - start;
    expect(doc.type).toBe('document');
    expect(elapsed).toBeLessThan(2000);
  });

  it('parses a long run of unmatched ![ quickly', () => {
    const big = '!['.repeat(50_000);
    const start = Date.now();
    const doc = parse(big);
    const elapsed = Date.now() - start;
    expect(doc.type).toBe('document');
    expect(elapsed).toBeLessThan(2000);
  });
});
