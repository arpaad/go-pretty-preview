import { Tree, Node } from 'web-tree-sitter';
import { Decoration, DecorationContext, DecorationProvider } from './types';

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// [startCol, endCol) per line — endCol may be Infinity for rest-of-line ranges.
type ColInterval = [number, number];

function buildNonCodeIntervals(root: Node): Map<number, ColInterval[]> {
  const map = new Map<number, ColInterval[]>();

  function add(sr: number, sc: number, er: number, ec: number): void {
    function push(row: number, s: number, e: number) {
      if (!map.has(row)) map.set(row, []);
      map.get(row)!.push([s, e]);
    }
    if (sr === er) {
      push(sr, sc, ec);
    } else {
      push(sr, sc, Infinity);
      for (let r = sr + 1; r < er; r++) push(r, 0, Infinity);
      push(er, 0, ec);
    }
  }

  function walk(node: Node): void {
    if (
      node.type === 'comment' ||
      node.type === 'interpreted_string_literal' ||
      node.type === 'raw_string_literal'
    ) {
      add(
        node.startPosition.row, node.startPosition.column,
        node.endPosition.row, node.endPosition.column,
      );
      return;
    }
    for (const child of node.children) if (child) walk(child);
  }

  walk(root);
  return map;
}

function inNonCode(map: Map<number, ColInterval[]>, line: number, col: number): boolean {
  const intervals = map.get(line);
  if (!intervals) return false;
  return intervals.some(([s, e]) => col >= s && col < e);
}

/**
 * Returns `pkg-faded` decorations over `pkg.` prefixes for the configured
 * packages. `tree` (AST of `code`) is used to skip matches inside strings and
 * comments. Pure: config is passed in as `packages`, never read from vscode.
 */
export function buildPackageDecorations(
  code: string,
  packages: string[],
  tree?: Tree | null
): Decoration[] {
  if (packages.length === 0) return [];

  const pattern = new RegExp(`\\b(${packages.map(escapeRegex).join('|')})\\.`, 'g');
  const decorations: Decoration[] = [];
  const nonCode = tree ? buildNonCodeIntervals(tree.rootNode) : null;

  const lines = code.split('\n');
  for (let lineIdx = 0; lineIdx < lines.length; lineIdx++) {
    pattern.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(lines[lineIdx])) !== null) {
      if (nonCode && inNonCode(nonCode, lineIdx, match.index)) continue;
      decorations.push({
        start: { line: lineIdx, character: match.index },
        end: { line: lineIdx, character: match.index + match[0].length },
        properties: { class: 'pkg-faded' },
        alwaysWrap: true,
      });
    }
  }
  return decorations;
}

/** DecorationProvider wrapper; `configValue` is the `string[]` of package names. */
export class PackageDecorationProvider implements DecorationProvider {
  readonly id = 'fadePackages';
  build(ctx: DecorationContext, configValue?: unknown): Decoration[] {
    const packages = Array.isArray(configValue) ? (configValue as string[]) : [];
    return buildPackageDecorations(ctx.code, packages, ctx.tree);
  }
}
