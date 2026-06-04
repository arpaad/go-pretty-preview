import { Tree, Node } from 'web-tree-sitter';
import { Transformer } from './types';
import { LineDescriptor } from '../descriptors';
import { isErrorNode, containsError } from '../astUtils';

export class LogVisibilityTransformer implements Transformer {
  readonly id = 'logVisibility';
  readonly label = 'Log line visibility';
  readonly alwaysRun = true;

  transform(input: LineDescriptor[], tree: Tree | null, configValue?: unknown): LineDescriptor[] {
    const mode = (typeof configValue === 'string' ? configValue : null) ?? 'normal';
    if (mode === 'normal') return input;

    // Set of source rows covered by standalone slog.* call statements. With the
    // AST this handles multi-line calls and skips strings/comments; otherwise we
    // fall back to a per-line regex over the descriptor text.
    const slogRows = tree ? slogRowSet(tree.rootNode) : regexSlogRows(input);

    if (mode === 'fade' || mode === 'highlight') {
      const flag = mode === 'fade' ? 'faded' : 'highlighted';
      return input.map((d) => (slogRows.has(d.sourceLine) ? { ...d, [flag]: true } : d));
    }

    // hide mode: drop every descriptor whose source row is part of a slog call.
    return input.filter((d) => !slogRows.has(d.sourceLine));
  }
}

function slogRowSet(root: Node): Set<number> {
  const rows = new Set<number>();
  collectSlogRows(root, rows);
  return rows;
}

// A call is "standalone" when its immediate parent is an expression_statement,
// meaning it is used as a statement rather than embedded in a larger expression.
function collectSlogRows(node: Node, out: Set<number>): void {
  // Skip unparseable regions so a half-typed statement elsewhere does not make us
  // hide the wrong lines (subtree-level degradation, not whole-file).
  if (isErrorNode(node)) return;
  if (node.type === 'call_expression' && !containsError(node)) {
    const fn = node.childForFieldName('function');
    if (
      fn?.type === 'selector_expression' &&
      fn.childForFieldName('operand')?.type === 'identifier' &&
      fn.childForFieldName('operand')?.text === 'slog' &&
      node.parent?.type === 'expression_statement'
    ) {
      for (let r = node.startPosition.row; r <= node.endPosition.row; r++) out.add(r);
      return; // children of this call are not separate slog calls
    }
  }
  for (const child of node.children) {
    if (child) collectSlogRows(child, out);
  }
}

const SLOG_LINE = /^\s*slog\.(Debug|Info|Warn|Error|Log|LogAttrs)\s*\(.*\)\s*$/;

function regexSlogRows(input: LineDescriptor[]): Set<number> {
  const rows = new Set<number>();
  for (const d of input) {
    if (SLOG_LINE.test(d.text)) rows.add(d.sourceLine);
  }
  return rows;
}
