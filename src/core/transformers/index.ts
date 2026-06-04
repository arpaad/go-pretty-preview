import { Tree } from 'web-tree-sitter';
import { LineDescriptor } from '../descriptors';
import { Transformer } from './types';
import { LogVisibilityTransformer } from './logVisibility';
import { InlineOneLineIfTransformer } from './inlineOneLineIf';

// Order matters: LogVisibility runs first because hiding a slog line can turn a
// multi-statement block into a single-statement one, enabling InlineOneLineIf.
const allTransformers: Transformer[] = [
  new LogVisibilityTransformer(),
  new InlineOneLineIfTransformer(),
];

/**
 * Runs every enabled transformer over the descriptor list. A SINGLE source `tree`
 * is shared by all of them — there is no intermediate re-parse and no intermediate
 * WASM tree allocation. `getConfig(id)` supplies each transformer's config value,
 * keeping this function (and the transformers) free of any vscode dependency.
 */
export function runTransformers(
  input: LineDescriptor[],
  tree: Tree | null,
  getConfig: (id: string) => unknown
): LineDescriptor[] {
  let descriptors = input;
  for (const transformer of allTransformers) {
    const configValue = getConfig(transformer.id);
    const enabled = transformer.alwaysRun || (configValue as boolean) !== false;
    if (!enabled) continue;
    descriptors = transformer.transform(descriptors, tree, configValue);
  }
  return descriptors;
}
