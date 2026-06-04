import { Tree } from 'web-tree-sitter';

/** A column-range decoration in output coordinates (line/character). */
export interface Decoration {
  start: { line: number; character: number };
  end: { line: number; character: number };
  properties: { class: string };
  alwaysWrap: boolean;
}

export interface DecorationContext {
  /** The materialized output code (post-transform). */
  code: string;
  /** AST of the output code (column-level effects use it to skip strings/comments). */
  tree: Tree | null;
}

/**
 * Plugin shape mirroring {@link Transformer}, for column-level effects (package
 * fading today; struct-tag / context.Context dimming later). Config is supplied
 * by the caller so providers stay pure and vscode-free.
 */
export interface DecorationProvider {
  readonly id: string;
  build(ctx: DecorationContext, configValue?: unknown): Decoration[];
}
