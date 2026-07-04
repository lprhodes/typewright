/**
 * `typewright/core` — the headless, framework-agnostic engine.
 *
 * Status: PRE-ALPHA SCAFFOLD. The from-scratch document model, incremental
 * block-structured parser, and virtualized DOM view described in SPEC.md are
 * not yet implemented. This module defines the public surface those internals
 * will fulfil so integrators can build against a stable contract.
 */

import type {
  DocChange,
  DocSelection,
  EditorConfig,
  EditorEvents,
} from '../types';

export * from '../types';

/* Headless engine surface — parser, renderer, unified-mode, folding, doc model. */
export { parse } from './parser';
export { renderToHtml, renderInline, renderNode, safeUrl } from './render';
export { collectMarkers, hiddenMarkers, activeBlockIndex } from './unified';
export type { Marker } from './unified';
export { headingFoldRanges } from './fold';
export type { FoldRange } from './fold';
export { applyCommand } from './commands';
export type { Command, Sel, CommandResult } from './commands';
export { TextDoc } from './text';
export type { Change, LineInfo, Position } from './text';
export * from './ast';

export interface EditorViewOptions extends EditorConfig, EditorEvents {
  /** Element the editor mounts into. */
  parent: HTMLElement;
}

/**
 * The mounted editor. Owns the document string, the incremental parse tree,
 * the decoration set, and the virtualized viewport. React is not required to
 * use this class — the React component in `typewright` is a thin wrapper over it.
 */
export class EditorView {
  readonly dom: HTMLElement;

  constructor(options: EditorViewOptions) {
    this.dom = options.parent;
    throw new Error(
      'typewright/core: engine not yet implemented (pre-alpha scaffold). ' +
        'See SPEC.md for the architecture and roadmap.',
    );
  }

  /** Current document string. */
  get doc(): string {
    return '';
  }

  /** Apply an edit. */
  dispatch(_change: DocChange): void {
    /* not implemented */
  }

  setSelection(_selection: DocSelection): void {
    /* not implemented */
  }

  destroy(): void {
    /* not implemented */
  }
}
