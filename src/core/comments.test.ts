import { describe, it, expect } from 'vitest';
import type { Change } from './text';
import { mapAnchor } from './comments';

describe('mapAnchor', () => {
  // Anchor covers "BBB" (offsets 3..6) in a doc like "AAABBBCCC".
  const anchor = { from: 3, to: 6 };

  it('shifts both ends by +len when text is inserted ABOVE the anchor', () => {
    const change: Change = { from: 0, to: 0, insert: 'xxx' }; // len 3, before the anchor
    expect(mapAnchor(anchor, change)).toEqual({ from: 6, to: 9 });
  });

  it("extends 'to' only when text is inserted INSIDE the anchor", () => {
    const change: Change = { from: 4, to: 4, insert: 'zz' }; // strictly inside [3,6)
    expect(mapAnchor(anchor, change)).toEqual({ from: 3, to: 8 });
  });

  it('returns null when a delete fully covers the anchor', () => {
    const change: Change = { from: 2, to: 8, insert: '' }; // [2,8) ⊇ [3,6)
    expect(mapAnchor(anchor, change)).toBeNull();
  });

  it('clamps correctly when a delete partially overlaps the anchor', () => {
    // Anchor covers "BBBCCC" (3..9); delete the trailing "CCC" (6..9).
    const wide = { from: 3, to: 9 };
    const change: Change = { from: 6, to: 9, insert: '' };
    expect(mapAnchor(wide, change)).toEqual({ from: 3, to: 6 });
  });

  it('leaves the anchor unchanged when the edit is entirely BELOW it', () => {
    const change: Change = { from: 10, to: 12, insert: 'zz' }; // after the anchor
    expect(mapAnchor(anchor, change)).toEqual({ from: 3, to: 6 });
  });
});
