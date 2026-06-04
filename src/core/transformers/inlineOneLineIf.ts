import { Tree, Node } from 'web-tree-sitter';
import { Transformer } from './types';
import { LineDescriptor, LineBuilder } from '../descriptors';
import { isErrorNode, containsError, blockStatements, blockHasCommentOnRow } from '../astUtils';

/**
 * Collapses if/else-if/else chains whose branches reduce to a single (still
 * visible) statement into one valid-Go line, e.g.
 *
 *   if err != nil {        →   if err != nil { return err }   (collapsed)
 *       return err
 *   }
 *
 * The output is valid Go (braces kept) so the tree-sitter renderer can highlight
 * it; the remaining braces are faded by the renderer on collapsed lines. Each
 * collapsed line carries a per-column `colMap` so hover / go-to-definition still
 * resolve to exact source positions.
 *
 * "Still visible" is evaluated against the descriptor list, so a slog statement
 * hidden by LogVisibility is not counted — that is what lets a two-statement body
 * collapse without any re-parse (the AST is the original source).
 */
export class InlineOneLineIfTransformer implements Transformer {
  readonly id = 'inlineOneLineIf';
  readonly label = 'Inline one-line if blocks';

  transform(input: LineDescriptor[], tree: Tree | null, _configValue?: unknown): LineDescriptor[] {
    // No AST available — skip transformation rather than risk incorrect output.
    if (!tree) return input;

    const present = new Set(input.map((d) => d.sourceLine));
    const descBySource = new Map(input.map((d) => [d.sourceLine, d] as const));

    // Build source-row → outermost if_statement node map for O(1) lookup.
    const ifByRow = new Map<number, Node>();
    collectIfNodes(tree.rootNode, ifByRow);

    const output: LineDescriptor[] = [];
    let i = 0;
    while (i < input.length) {
      const d = input[i];
      const ifNode = ifByRow.get(d.sourceLine);
      if (ifNode) {
        const res = buildChainOutput(ifNode, present, descBySource);
        if (res) {
          output.push(...res.output);
          // Skip the header descriptor plus every descriptor within the chain.
          i++;
          while (i < input.length && input[i].sourceLine <= res.endRow) i++;
          continue;
        }
      }
      output.push(d);
      i++;
    }
    return output;
  }
}

interface Branch {
  ifNode: Node | null; // the if_statement (for if / else-if); null for else
  header: string; // "if x" / "else if y" / "else" (no brace)
  block: Node; // consequence or else block
  headerRow: number;
  closingRow: number; // source row of the closing brace
  braceCol: number; // column of the opening `{`
  closeBraceCol: number; // column of the closing `}`
}

interface BranchEval {
  canCollapse: boolean;
  stmt: Node | null; // the single remaining statement node
  desc: LineDescriptor | undefined; // its descriptor (carries faded/highlighted)
}

function buildChainOutput(
  outerNode: Node,
  present: Set<number>,
  descBySource: Map<number, LineDescriptor>
): { output: LineDescriptor[]; endRow: number } | null {
  const chain = parseChain(outerNode, descBySource);
  if (!chain) return null;

  const evals = chain.branches.map((b) => evalBranch(b, present, descBySource));

  // The output must be valid Go (the renderer parses it), and in Go `else` must
  // sit on the same line as the preceding `}`. So we collapse a chain only when
  // EVERY branch reduces to a single visible statement, joining the whole chain
  // into one line: `if c1 { s1 } else if c2 { s2 } else { s3 }`. A mixed chain
  // (some branch still multi-line) is left untouched rather than producing an
  // invalid split.
  if (!evals.every((e) => e.canCollapse)) return null;

  const line = buildCollapsedChain(chain.baseIndent, chain.branches, evals);
  if (line.text.length > 160) return null;
  return { output: [line], endRow: chain.endRow };
}

function parseChain(
  outerNode: Node,
  descBySource: Map<number, LineDescriptor>
): { branches: Branch[]; endRow: number; baseIndent: string } | null {
  const headerText = (row: number) => descBySource.get(row)?.text ?? '';
  const baseIndent = leadingWhitespace(headerText(outerNode.startPosition.row));
  const branches: Branch[] = [];

  let current: Node | null = outerNode;
  let isFirst = true;

  while (current?.type === 'if_statement') {
    const conseq = current.childForFieldName('consequence');
    if (!conseq) return null;

    // Only collapse single-line if headers (multi-line conditions are left as-is).
    const headerRow = current.startPosition.row;
    if (conseq.startPosition.row !== headerRow) return null;

    branches.push({
      ifNode: current,
      header: buildIfHeader(current, isFirst) ?? fallbackHeader(headerText(headerRow), isFirst),
      block: conseq,
      headerRow,
      closingRow: conseq.endPosition.row,
      braceCol: conseq.startPosition.column,
      closeBraceCol: Math.max(0, conseq.endPosition.column - 1),
    });

    const alt = current.childForFieldName('alternative');
    if (!alt) break;

    if (alt.type === 'if_statement') {
      current = alt;
      isFirst = false;
    } else if (alt.type === 'block') {
      branches.push({
        ifNode: null,
        header: 'else',
        block: alt,
        headerRow: alt.startPosition.row,
        closingRow: alt.endPosition.row,
        braceCol: alt.startPosition.column,
        closeBraceCol: Math.max(0, alt.endPosition.column - 1),
      });
      break;
    } else {
      break;
    }
  }

  if (branches.length === 0) return null;
  return { branches, endRow: outerNode.endPosition.row, baseIndent };
}

function evalBranch(
  b: Branch,
  present: Set<number>,
  descBySource: Map<number, LineDescriptor>
): BranchEval {
  const stmts = blockStatements(b.block).filter((s) => present.has(s.startPosition.row));

  // Body rows still visible (excludes lines hidden by an earlier transformer).
  const bodyRows: number[] = [];
  for (let r = b.headerRow + 1; r < b.closingRow; r++) if (present.has(r)) bodyRows.push(r);

  const stmt = stmts[0];
  const single =
    stmts.length === 1 &&
    bodyRows.length === 1 &&
    stmt.startPosition.row === stmt.endPosition.row &&
    bodyRows[0] === stmt.startPosition.row;

  const desc = single ? descBySource.get(stmt.startPosition.row) : undefined;

  // A trailing line-comment on the body line would swallow the synthesized ` }`,
  // breaking valid-Go output — leave such a branch expanded.
  const safe = single && !!desc && !blockHasCommentOnRow(b.block, stmt.startPosition.row);

  return { canCollapse: safe, stmt: safe ? stmt : null, desc: safe ? desc : undefined };
}

// Assembles a whole if/else chain into one valid-Go line:
//   `<indent>if c1 { s1 } else if c2 { s2 } else { s3 }`
// while recording, for every output column, the source position it came from.
// Verbatim segments (conditions, statements) map precisely; synthesized braces
// and joining spaces map to a representative source position.
function buildCollapsedChain(
  baseIndent: string,
  branches: Branch[],
  evals: BranchEval[]
): LineDescriptor {
  const lb = new LineBuilder();
  const firstRow = branches[0].headerRow;
  lb.appendAt(baseIndent, { line: firstRow, col: 0 });

  branches.forEach((b, bi) => {
    const stmt = evals[bi].stmt!;
    const desc = evals[bi].desc!;
    const stmtText = desc.text.trim();
    const stmtIndentLen = desc.text.length - desc.text.trimStart().length;

    if (bi > 0) lb.appendAt(' ', { line: b.headerRow, col: b.braceCol }); // join ` else`
    lb.append(b.header, b.headerRow, baseIndent.length);
    lb.appendAt(' ', { line: b.headerRow, col: b.braceCol });
    lb.appendAt('{', { line: b.headerRow, col: b.braceCol });
    lb.appendAt(' ', { line: b.headerRow, col: b.braceCol });
    lb.append(stmtText, stmt.startPosition.row, stmtIndentLen);
    lb.appendAt(' ', { line: stmt.startPosition.row, col: stmtIndentLen + stmtText.length });
    lb.appendAt('}', { line: b.closingRow, col: b.closeBraceCol });
  });

  const { text, colMap } = lb.build();
  return {
    sourceLine: firstRow,
    text,
    collapsed: true,
    colMap,
    faded: evals.every((e) => e.desc!.faded) || undefined,
    highlighted: evals.some((e) => e.desc!.highlighted) || undefined,
  };
}

function leadingWhitespace(line: string): string {
  return (line.match(/^(\s*)/) ?? ['', ''])[1];
}

// Builds an if/else-if header from the AST: `if [init; ]cond` (else-if gets an
// `else ` prefix). Returns null if the condition field is missing so the caller
// can fall back to the text-based reconstruction.
function buildIfHeader(ifNode: Node, isFirst: boolean): string | null {
  const condition = ifNode.childForFieldName('condition');
  if (!condition) return null;
  const initializer = ifNode.childForFieldName('initializer');
  const initPart = initializer ? `${initializer.text.trim().replace(/;$/, '').trim()}; ` : '';
  const core = `if ${initPart}${condition.text.trim()}`;
  return isFirst ? core : `else ${core}`;
}

// Legacy text-based header reconstruction, used only when AST fields are unavailable.
function fallbackHeader(headerLine: string, isFirst: boolean): string {
  if (isFirst) return headerLine.trim().replace(/\s*\{$/, '').trim();
  return headerLine.trim().replace(/^\}\s*/, '').replace(/\s*\{$/, '').trim();
}

function collectIfNodes(node: Node, map: Map<number, Node>): void {
  // Skip unparseable regions entirely (subtree-level degradation).
  if (isErrorNode(node)) return;
  if (node.type === 'if_statement') {
    // Only register the outermost if at each row; nested else-if chains are walked
    // from the outer node. A chain with any syntax error inside is left untouched
    // so we never collapse half-typed code.
    if (!map.has(node.startPosition.row) && !containsError(node)) {
      map.set(node.startPosition.row, node);
    }
  }
  for (const child of node.children) {
    if (child) collectIfNodes(child, map);
  }
}
