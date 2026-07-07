/**
 * `typewright/mdx` — the sandboxed MDX/Mermaid execution boundary.
 *
 * Two pieces, kept separate on purpose (SPEC.md §7):
 *  - {@link resolveTransform} turns JSX/TS into plain JS (the one conceded
 *    dependency boundary — wasm peers or a zero-dep constrained subset).
 *  - {@link createSandbox} runs that plain JS inside an opaque-origin sandboxed
 *    iframe that cannot reach the host DOM, storage, or session.
 *
 * {@link compileAndRun} is the convenience that wires them together for a
 * one-shot compile-and-render.
 */

import { createSandbox } from '../sandbox/host';
import type { CreateSandboxOptions, EvaluateResult } from '../sandbox/host';
import { resolveTransform } from './transform';
import type { TransformMeta } from './transform';
import type { MdxTransform } from '../types';

export { createSandbox } from '../sandbox/host';
export type {
  SandboxController,
  CreateSandboxOptions,
  EvaluateResult,
  MermaidResult,
  InboundResult,
} from '../sandbox/host';
export {
  shouldAcceptMessage,
  dispatchInbound,
  buildSandboxCsp,
  buildSandboxSrcdoc,
  createChannelToken,
} from '../sandbox/host';

export { resolveTransform, compileConstrained } from './transform';
export type { CompileFn, TransformMeta } from './transform';

/* Re-export the relevant public config types for `typewright/mdx` consumers. */
export type {
  MdxOptions,
  MdxTransform,
  ComponentMap,
  SandboxOptions,
  MermaidOptions,
  MathOptions,
} from '../types';

/** Options for {@link compileAndRun}. */
export interface CompileAndRunOptions {
  /** MDX/JSX source to compile. */
  code: string;
  /** How to transform it (defaults to `undefined` → throws "no transform"). */
  transform?: MdxTransform;
  /** Transform metadata (e.g. a filename to pick the tsx/jsx loader). */
  meta?: TransformMeta;
  /** Props passed to the evaluated module. */
  props?: Record<string, unknown>;
  /**
   * Sandbox options for a freshly-created sandbox. Ignored when `controller`
   * is supplied.
   */
  sandbox?: CreateSandboxOptions;
  /** Reuse an existing sandbox instead of creating (and destroying) one. */
  controller?: ReturnType<typeof createSandbox>;
}

/**
 * Compile `code` with the resolved transform and evaluate it in a sandbox. When
 * no `controller` is supplied a temporary sandbox is created and destroyed
 * around the call. The compiled output renders inside the sandbox; the returned
 * `html` is informational — never inject it into the host tree (SPEC.md §11).
 */
export async function compileAndRun(opts: CompileAndRunOptions): Promise<EvaluateResult> {
  const compile = resolveTransform(opts.transform);
  const js = await compile(opts.code, opts.meta);
  const owned = opts.controller === undefined;
  const sandbox = opts.controller ?? createSandbox(opts.sandbox);
  try {
    return await sandbox.evaluate(js, opts.props);
  } finally {
    if (owned) sandbox.destroy();
  }
}
