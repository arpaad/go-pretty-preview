import * as vscode from 'vscode';
import * as path from 'path';
import { createHighlighterCore } from 'shiki/core';
import { createJavaScriptRegexEngine } from 'shiki/engine/javascript';
import darkPlusTheme from 'shiki/dist/themes/dark-plus.mjs';
import lightPlusTheme from 'shiki/dist/themes/light-plus.mjs';
import goLang from 'shiki/dist/langs/go.mjs';
import { runTransformers } from './transformers/index';

type Highlighter = Awaited<ReturnType<typeof createHighlighterCore>>;

let highlighterPromise: Promise<Highlighter> | null = null;

function getHighlighter(): Promise<Highlighter> {
  if (!highlighterPromise) {
    highlighterPromise = createHighlighterCore({
      themes: [darkPlusTheme, lightPlusTheme],
      langs: [goLang],
      engine: createJavaScriptRegexEngine(),
    });
  }
  return highlighterPromise;
}

export class GoPreviewProvider {
  private readonly panels = new Map<string, vscode.WebviewPanel>();

  constructor(private readonly context: vscode.ExtensionContext) {
    getHighlighter().catch(() => {});
  }

  open(document: vscode.TextDocument): void {
    const key = document.uri.toString();
    const existing = this.panels.get(key);
    if (existing) {
      existing.reveal(vscode.ViewColumn.Beside);
      return;
    }

    const panel = vscode.window.createWebviewPanel(
      'goPreview',
      `Preview: ${path.basename(document.fileName)}`,
      vscode.ViewColumn.Beside,
      {
        enableScripts: true,
        localResourceRoots: [
          vscode.Uri.joinPath(this.context.extensionUri, 'media'),
        ],
      }
    );

    panel.webview.html = this.buildShell(panel.webview);
    this.pushUpdate(panel, document);

    panel.onDidDispose(() => this.panels.delete(key));
    this.panels.set(key, panel);
  }

  handleDocumentChange(event: vscode.TextDocumentChangeEvent): void {
    const panel = this.panels.get(event.document.uri.toString());
    if (panel) {
      this.pushUpdate(panel, event.document);
    }
  }

  handleConfigChange(): void {
    for (const [key, panel] of this.panels) {
      const uri = vscode.Uri.parse(key);
      vscode.workspace.openTextDocument(uri).then(doc => {
        this.pushUpdate(panel, doc);
      });
    }
  }

  dispose(): void {
    this.panels.forEach(p => p.dispose());
    this.panels.clear();
  }

  private async pushUpdate(panel: vscode.WebviewPanel, document: vscode.TextDocument): Promise<void> {
    const highlighter = await getHighlighter();
    const source = document.getText();
    const { code } = runTransformers(source);

    const isDark = vscode.window.activeColorTheme.kind !== vscode.ColorThemeKind.Light;
    const theme = isDark ? 'dark-plus' : 'light-plus';

    const tabSize = vscode.workspace.getConfiguration('editor', document.uri).get<number>('tabSize', 4);

    const html = highlighter.codeToHtml(code, { lang: 'go', theme });
    panel.webview.postMessage({ type: 'update', html, tabSize });
  }

  private buildShell(webview: vscode.Webview): string {
    const scriptUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.context.extensionUri, 'media', 'preview.js')
    );
    const cssUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.context.extensionUri, 'media', 'preview.css')
    );
    const nonce = randomNonce();

    return /* html */`<!DOCTYPE html>
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
  <script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
  }
}

function randomNonce(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  return Array.from({ length: 32 }, () =>
    chars[Math.floor(Math.random() * chars.length)]
  ).join('');
}
