import * as vscode from 'vscode';

function escapeRegex(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function buildPackageDecorations(code: string) {
  const packages = vscode.workspace
    .getConfiguration('goPreview.rules')
    .get<string[]>('fadePackages', []);

  if (packages.length === 0) return [];

  const pattern = new RegExp(
    `\\b(${packages.map(escapeRegex).join('|')})\\.`,
    'g'
  );

  const decorations: Array<{
    start: { line: number; character: number };
    end: { line: number; character: number };
    properties: { class: string };
    alwaysWrap: boolean;
  }> = [];

  const lines = code.split('\n');
  for (let lineIdx = 0; lineIdx < lines.length; lineIdx++) {
    pattern.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(lines[lineIdx])) !== null) {
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
