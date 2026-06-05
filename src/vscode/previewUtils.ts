import * as vscode from 'vscode';
import { randomBytes } from 'crypto';
import { ColRange } from '../core/descriptors';
import { Decoration } from '../core/decorations/types';
import { createGoHighlighter, GoHighlighter } from '../core/highlighter';
import { GO_HIGHLIGHTS_SCM } from '../core/goHighlights';
import { ParserService } from './ParserService';

let highlighterPromise: Promise<GoHighlighter> | null = null;

export function getHighlighter(parser: ParserService): Promise<GoHighlighter> {
  if (!highlighterPromise) {
    highlighterPromise = parser
      .getLanguage()
      .then((lang) => createGoHighlighter(lang, GO_HIGHLIGHTS_SCM));
  }
  return highlighterPromise;
}

export function buildShell(webview: vscode.Webview, context: vscode.ExtensionContext): string {
  const scriptUri = webview.asWebviewUri(
    vscode.Uri.joinPath(context.extensionUri, 'media', 'preview.js')
  );
  const cssUri = webview.asWebviewUri(
    vscode.Uri.joinPath(context.extensionUri, 'media', 'preview.css')
  );
  const nonce = randomBytes(16).toString('hex');

  return /* html */ `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy"
    content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}';">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <link rel="stylesheet" href="${cssUri}">
  <title>Go Preview</title>
</head>
<body>
  <div id="preview-container"></div>
  <div id="hover-tooltip" style="display:none;position:fixed;z-index:9999;max-width:600px;padding:6px 10px;border-radius:4px;font-size:13px;pointer-events:none;overflow:auto;max-height:300px;"></div>
  <script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
}

export function appendRangeDecorations(
  decorations: Decoration[],
  ranges: Array<ColRange[] | null>,
  cssClass: string
): void {
  for (let i = 0; i < ranges.length; i++) {
    const lineRanges = ranges[i];
    if (!lineRanges) continue;
    for (const r of lineRanges) {
      decorations.push({
        start: { line: i, character: r.start },
        end: { line: i, character: r.end },
        properties: { class: cssClass },
        alwaysWrap: true,
      });
    }
  }
}

const SEVERITY_PREFIX = ['🔴', '⚠️', 'ℹ️', '💡'] as const;

export async function buildHoverHtml(
  uri: vscode.Uri,
  pos: vscode.Position
): Promise<string> {
  const diagsAtPos = vscode.languages.getDiagnostics(uri).filter((d) => d.range.contains(pos));

  const hovers = await vscode.commands.executeCommand<vscode.Hover[]>(
    'vscode.executeHoverProvider',
    uri,
    pos
  );

  const hoverMarkdown = (hovers ?? [])
    .flatMap((h) => h.contents)
    .map((c) => {
      if (typeof c === 'string') return c;
      if ('value' in c) return (c as vscode.MarkdownString).value;
      const marked = c as { language: string; value: string };
      return `\`\`\`${marked.language}\n${marked.value}\n\`\`\``;
    })
    .filter(Boolean)
    .join('\n\n---\n\n');

  const diagMarkdown = diagsAtPos
    .map((d) => `${SEVERITY_PREFIX[d.severity] ?? '🔴'} ${d.message}`)
    .join('\n\n');

  const parts = [diagMarkdown, hoverMarkdown].filter(Boolean);
  if (parts.length === 0) return '';

  const markdown = parts.join('\n\n---\n\n');
  try {
    return (await vscode.commands.executeCommand<string>('markdown.api.render', markdown)) ?? '';
  } catch {
    return `<pre>${markdown.replace(/&/g, '&amp;').replace(/</g, '&lt;')}</pre>`;
  }
}

export function sendDiagnostics(
  panel: vscode.WebviewPanel,
  document: vscode.TextDocument,
  currentLineMap: number[]
): void {
  const rawDiags = vscode.languages.getDiagnostics(document.uri);

  const sourceToPreview = new Map<number, number>();
  for (let previewLine = 0; previewLine < currentLineMap.length; previewLine++) {
    const sourceLine = currentLineMap[previewLine];
    if (!sourceToPreview.has(sourceLine)) {
      sourceToPreview.set(sourceLine, previewLine);
    }
  }

  const items = rawDiags.flatMap((d) => {
    const previewLine = sourceToPreview.get(d.range.start.line);
    if (previewLine === undefined) return [];
    return [
      {
        line: previewLine,
        startCol: d.range.start.character,
        endCol: d.range.end.character,
        severity: d.severity,
        message: d.message,
      },
    ];
  });

  panel.webview.postMessage({ type: 'diagnostics', items });
}
