import { Node } from 'web-tree-sitter';

/**
 * During live editing the source is frequently half-valid, so tree-sitter emits
 * `ERROR` / missing nodes. These helpers let transformers degrade at the subtree
 * level — skipping only the broken region — instead of bailing on the whole file.
 */

/** True when `node` is itself an ERROR node (an unparseable region). */
export function isErrorNode(node: Node): boolean {
  return node.isError;
}

/**
 * True when `node` is an ERROR node or contains any syntax error within it.
 * A transformer should leave the corresponding source line untouched in this case,
 * since AST-based assumptions (statement counts, field children) may be wrong.
 */
export function containsError(node: Node): boolean {
  return node.hasError;
}

/**
 * The statements of a Go block. In tree-sitter-go a `block` wraps a single
 * `statement_list` whose named children are the statements. A leading comment
 * (e.g. `{ // note`) is also a named child of the block, so we locate the list
 * by type rather than by index, and drop comment nodes from the result.
 */
export function blockStatements(block: Node): Node[] {
  const stmtList = block.namedChildren.find((n): n is Node => n?.type === 'statement_list');
  if (!stmtList) return [];
  return stmtList.namedChildren.filter((n): n is Node => n !== null && n.type !== 'comment');
}

/** True if a comment node appears anywhere within `block` on the given source row. */
export function blockHasCommentOnRow(block: Node, row: number): boolean {
  let found = false;
  function walk(n: Node): void {
    if (found) return;
    if (n.type === 'comment' && n.startPosition.row === row) {
      found = true;
      return;
    }
    for (const c of n.children) if (c) walk(c);
  }
  walk(block);
  return found;
}
