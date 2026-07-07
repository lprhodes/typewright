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
export { parse, parseIncremental } from './parser';
export { renderToHtml, renderInline, renderNode, safeUrl } from './render';
export type { RenderOptions } from './render';
export { collectMarkers, hiddenMarkers, activeBlockIndex } from './unified';
export type { Marker } from './unified';
export { headingFoldRanges } from './fold';
export type { FoldRange } from './fold';
export { applyCommand, COMMANDS } from './commands';
export type { Command, Sel, CommandResult } from './commands';
export { TextDoc } from './text';
export type { Change, LineInfo, Position } from './text';
/* Syntax highlighting (native, zero-dep), comment-anchor + table helpers. */
export { highlightToHtml } from './highlight';
export { mapAnchor } from './comments';
export {
  cellSourceRange,
  addRow,
  addColumn,
  removeRow,
  removeColumn,
  setAlignment,
} from './table';
export type { TableEdit } from './table';
/* ParseOptions and the AST node types are re-exported here too. */
export * from './ast';

export interface EditorViewOptions extends EditorConfig, EditorEvents {
  /** Element the editor mounts into. */
  parent: HTMLElement;
}

/**
 * PRE-ALPHA SCAFFOLD — not yet implemented. Constructing an `EditorView`
 * throws: the stateful mounted engine (document string, incremental parse tree,
 * decoration set, virtualized viewport) described in SPEC.md is still to come.
 * This class only reserves the eventual public surface.
 *
 * To edit or render Markdown today, use the functional headless API exported
 * from this module — {@link parse}, {@link parseIncremental}, {@link renderToHtml} —
 * or the React `TypewrightEditor` component in `typewright`.
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
