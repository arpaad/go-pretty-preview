import { Transformer, TransformOutput } from './types';

interface ParsedBranch {
  header: string;     // e.g. "if err != nil" or "else if x < 0" or "else"
  bodyLines: string[];
  canCollapse: boolean;
  singleStmt: string; // populated only when canCollapse
}

/**
 * Collapses if/else-if/else chains where individual branches have a single
 * return, break, or continue statement.
 *
 * Single branch:
 *   if err != nil {        →   if err != nil return err        (dimmed)
 *       return err
 *   }
 *
 * Mixed chain (only qualifying branches are collapsed):
 *   if err != nil {        →   if err != nil return            (dimmed)
 *       return                 else if a == 0 return           (dimmed)
 *   } else if a == 0 {        else {
 *       return                     a = a * 2
 *   } else {                   }
 *       a = a * 2
 *   }
 */
export class SingleStatementIfTransformer implements Transformer {
  readonly id = 'singleStatementIf';
  readonly label = 'Collapse single-statement if blocks';

  transform(source: string): TransformOutput {
    const lines = source.split('\n');
    const resultLines: string[] = [];
    const collapsedLineIndices = new Set<number>();
    let i = 0;

    while (i < lines.length) {
      if (/^(\s*)if\s+.+\{$/.test(lines[i])) {
        const result = this.tryTransformChain(lines, i);
        if (result) {
          for (const { text, collapsed } of result.outputLines) {
            if (collapsed) collapsedLineIndices.add(resultLines.length);
            resultLines.push(text);
          }
          i = result.endIdx + 1;
          continue;
        }
      }
      resultLines.push(lines[i]);
      i++;
    }

    return { code: resultLines.join('\n'), collapsedLineIndices };
  }

  private tryTransformChain(
    lines: string[],
    startIdx: number
  ): { outputLines: Array<{ text: string; collapsed: boolean }>; endIdx: number } | null {
    const parsed = this.parseChain(lines, startIdx);
    if (!parsed) return null;

    const { branches, endIdx, baseIndent } = parsed;

    if (!branches.some(b => b.canCollapse)) return null;

    // Single branch → one-liner
    if (branches.length === 1) {
      const b = branches[0];
      const text = `${baseIndent}${b.header} ${b.singleStmt}`;
      if (text.length > 120) return null;
      return { outputLines: [{ text, collapsed: true }], endIdx };
    }

    // Multi-branch → collapse qualifying branches individually
    const outputLines: Array<{ text: string; collapsed: boolean }> = [];
    for (const branch of branches) {
      if (branch.canCollapse) {
        outputLines.push({ text: `${baseIndent}${branch.header} ${branch.singleStmt}`, collapsed: true });
      } else {
        outputLines.push({ text: `${baseIndent}${branch.header} {`, collapsed: false });
        for (const bodyLine of branch.bodyLines) {
          outputLines.push({ text: bodyLine, collapsed: false });
        }
        outputLines.push({ text: `${baseIndent}}`, collapsed: false });
      }
    }

    return { outputLines, endIdx };
  }

  private parseChain(
    lines: string[],
    startIdx: number
  ): { branches: ParsedBranch[]; endIdx: number; baseIndent: string } | null {
    const baseIndent = (lines[startIdx].match(/^(\s*)/) ?? ['', ''])[1];
    const branches: ParsedBranch[] = [];
    let i = startIdx;
    let isFirst = true;

    while (true) {
      const line = lines[i];
      if (line === undefined) return null;
      const trimmed = line.trim();

      let headerText: string;

      if (isFirst) {
        const m = trimmed.match(/^(if\s+.+)\{$/);
        if (!m) return null;
        headerText = m[1].trimEnd();
      } else {
        const mElseIf = trimmed.match(/^\}\s*(else\s+if\s+.+)\{$/);
        const mElse   = trimmed.match(/^\}\s*(else)\s*\{$/);
        if      (mElseIf) headerText = mElseIf[1].trimEnd();
        else if (mElse)   headerText = mElse[1];
        else return null;
      }

      // Collect body lines by tracking brace depth from the opening {
      let j = i + 1;
      let depth = 1;
      const bodyLines: string[] = [];

      outer: while (j < lines.length) {
        for (const ch of lines[j]) {
          if (ch === '{') depth++;
          else if (ch === '}') {
            depth--;
            if (depth === 0) break outer;
          }
        }
        bodyLines.push(lines[j]);
        j++;
      }

      if (j >= lines.length) return null;

      const closingTrimmed = lines[j].trim();
      const singleStmt = bodyLines.length === 1 ? bodyLines[0].trim() : '';
      const canCollapse = bodyLines.length === 1 && /^(return|break|continue)(\s.*)?$/.test(singleStmt);

      branches.push({ header: headerText, bodyLines, canCollapse, singleStmt });

      if (closingTrimmed === '}') {
        return { branches, endIdx: j, baseIndent };
      } else if (/^\}\s*else[\s{]/.test(closingTrimmed)) {
        i = j;
        isFirst = false;
      } else {
        return null;
      }
    }
  }
}
