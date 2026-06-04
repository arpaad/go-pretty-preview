import { Tree } from 'web-tree-sitter';
import { LineDescriptor } from '../descriptors';

export interface Transformer {
  readonly id: string;
  readonly label: string;
  /** When true the transformer always runs, bypassing the boolean config gate. */
  readonly alwaysRun?: boolean;
  /**
   * Annotate / rewrite the descriptor list.
   *
   * input: the current output-line descriptors (already transformed by earlier
   *   transformers). Each descriptor carries the source line it came from.
   * tree: the AST of the ORIGINAL source (never re-parsed between transformers),
   *   so node row/column positions are in source coordinates.
   * configValue: the raw value from goPreview.rules.<id>, supplied by the caller
   *   so transformers stay pure and unit-testable without a vscode mock.
   */
  transform(input: LineDescriptor[], tree: Tree | null, configValue?: unknown): LineDescriptor[];
}
