import * as vscode from 'vscode';
import * as path from 'path';
import { randomBytes } from 'crypto';
import { Tree } from 'web-tree-sitter';
import { createHighlighterCore } from 'shiki/core';
import { createJavaScriptRegexEngine } from 'shiki/engine/javascript';
import darkPlusTheme from 'shiki/dist/themes/dark-plus.mjs';
import lightPlusTheme from 'shiki/dist/themes/light-plus.mjs';
import goLang from 'shiki/dist/langs/go.mjs';
import { runTransformers } from '../core/transformers/index';
import { descriptorsFromSource, materialize, LineDescriptor } from '../core/descriptors';
import { PackageDecorationProvider } from '../core/decorations/packageDecorations';
import { ParserService } from './ParserService';

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

const packageDecorations = new PackageDecorationProvider();

export class GoPreviewProvider {
  private panel: vscode.WebviewPanel | undefined;
  private currentDocUri: string | undefined;
  private currentLineMap: number[] = [];
  private diagnosticsDisposable: vscode.Disposable | undefined;
  // Monotonic counter: each pushUpdate captures its value and bails before writing
  // shared state if a newer update (or document switch) has superseded it.
  private updateGeneration = 0;

  private updateTimer: ReturnType<typeof setTimeout> | undefined;

  private scrollSyncDisposable: vscode.Disposable | undefined;
  // Prevents the source→preview and preview→source scroll events from chasing each other.
  private suppressScrollSync = false;

  constructor(private readonly context: vscode.ExtensionContext) {
    getHighlighter().catch(() => {});
    ParserService.getInstance(); // trigger WASM load early
  }

  toggle(document: vscode.TextDocument): void {
    if (this.panel) {
      this.panel.dispose();
    } else {
      this.open(document);
    }
  }

  open(document: vscode.TextDocument): void {
    if (this.panel) {
      this.panel.reveal(vscode.ViewColumn.Beside);
      this.updatePanel(document);
      return;
    }

    const panel = vscode.window.createWebviewPanel(
      'goPreview',
      `Preview: ${path.basename(document.fileName)}`,
      vscode.ViewColumn.Beside,
      {
        enableScripts: true,
        localResourceRoots: [vscode.Uri.joinPath(this.context.extensionUri, 'media')],
      }
    );

    panel.webview.html = this.buildShell(panel.webview);
    this.panel = panel;
    this.currentDocUri = document.uri.toString();

    panel.webview.onDidReceiveMessage((msg) => this.handleWebviewMessage(msg));

    panel.onDidDispose(() => {
      this.panel = undefined;
      this.currentDocUri = undefined;
      this.currentLineMap = [];
      clearTimeout(this.updateTimer);
      this.diagnosticsDisposable?.dispose();
      this.diagnosticsDisposable = undefined;
      this.scrollSyncDisposable?.dispose();
      this.scrollSyncDisposable = undefined;
    });

    this.setupDiagnosticsListener();
    this.setupScrollSync();
    this.pushUpdate(panel, document);
  }

  handleDocumentChange(event: vscode.TextDocumentChangeEvent): void {
    if (!this.panel || event.document.uri.toString() !== this.currentDocUri) return;
    clearTimeout(this.updateTimer);
    this.updateTimer = setTimeout(() => {
      if (this.panel) this.pushUpdate(this.panel, event.document);
    }, 120);
  }

  handleConfigChange(): void {
    if (!this.panel || !this.currentDocUri) return;
    const uri = vscode.Uri.parse(this.currentDocUri);
    vscode.workspace.openTextDocument(uri).then((doc) => {
      if (this.panel) this.pushUpdate(this.panel, doc);
    });
  }

  handleActiveEditorChange(editor: vscode.TextEditor | undefined): void {
    if (!editor || editor.document.languageId !== 'go') return;
    const openByDefault = vscode.workspace
      .getConfiguration('goPreview')
      .get<boolean>('openByDefault', false);

    if (this.panel) {
      this.updatePanel(editor.document);
    } else if (openByDefault) {
      this.open(editor.document);
    }
  }

  dispose(): void {
    clearTimeout(this.updateTimer);
    this.panel?.dispose();
    this.diagnosticsDisposable?.dispose();
    this.scrollSyncDisposable?.dispose();
  }

  private updatePanel(document: vscode.TextDocument): void {
    if (!this.panel) return;
    this.currentDocUri = document.uri.toString();
    this.panel.title = `Preview: ${path.basename(document.fileName)}`;
    this.pushUpdate(this.panel, document);
    this.pushDiagnostics(document);
  }

  private setupDiagnosticsListener(): void {
    this.diagnosticsDisposable?.dispose();
    this.diagnosticsDisposable = vscode.languages.onDidChangeDiagnostics((e) => {
      if (!this.currentDocUri) return;
      const affected = e.uris.some((u) => u.toString() === this.currentDocUri);
      if (!affected) return;
      const uri = vscode.Uri.parse(this.currentDocUri);
      vscode.workspace.openTextDocument(uri).then((doc) => this.pushDiagnostics(doc));
    });
  }

  private setupScrollSync(): void {
    this.scrollSyncDisposable?.dispose();
    this.scrollSyncDisposable = vscode.window.onDidChangeTextEditorVisibleRanges((e) => {
      if (this.suppressScrollSync) return;
      if (!this.currentDocUri || e.textEditor.document.uri.toString() !== this.currentDocUri)
        return;
      const topSourceLine = e.visibleRanges[0]?.start.line ?? 0;
      // Find the first preview line whose source line is >= topSourceLine.
      const previewLine = this.currentLineMap.findIndex((sl) => sl >= topSourceLine);
      if (previewLine < 0) return;
      this.panel?.webview.postMessage({ type: 'scroll-to-line', line: previewLine });
    });
  }

  private pushDiagnostics(document: vscode.TextDocument): void {
    if (!this.panel) return;
    const rawDiags = vscode.languages.getDiagnostics(document.uri);

    // Build inverse map: sourceLine → previewLine
    const sourceToPreview = new Map<number, number>();
    for (let previewLine = 0; previewLine < this.currentLineMap.length; previewLine++) {
      const sourceLine = this.currentLineMap[previewLine];
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

    this.panel.webview.postMessage({ type: 'diagnostics', items });
  }

  private async handleWebviewMessage(msg: { type: string; [key: string]: unknown }): Promise<void> {
    if (!this.currentDocUri) return;
    const sourceUri = vscode.Uri.parse(this.currentDocUri);

    if (msg.type === 'navigate') {
      const line = msg.line as number;
      const doc = await vscode.workspace.openTextDocument(sourceUri);
      const editor = await vscode.window.showTextDocument(doc, vscode.ViewColumn.One);
      const pos = new vscode.Position(line, 0);
      editor.selection = new vscode.Selection(pos, pos);
      editor.revealRange(
        new vscode.Range(pos, pos),
        vscode.TextEditorRevealType.InCenterIfOutsideViewport
      );
    }

    if (msg.type === 'definition') {
      const line = msg.line as number;
      const col = msg.col as number;
      const pos = new vscode.Position(line, col);
      const locations = await vscode.commands.executeCommand<vscode.Location[]>(
        'vscode.executeDefinitionProvider',
        sourceUri,
        pos
      );
      if (locations && locations.length > 0) {
        const loc = locations[0];
        const doc = await vscode.workspace.openTextDocument(loc.uri);
        const editor = await vscode.window.showTextDocument(doc, vscode.ViewColumn.One);
        editor.selection = new vscode.Selection(loc.range.start, loc.range.start);
        editor.revealRange(loc.range, vscode.TextEditorRevealType.InCenterIfOutsideViewport);
      }
    }

    if (msg.type === 'hover') {
      const line = msg.line as number;
      const col = msg.col as number;
      const x = msg.x as number;
      const y = msg.y as number;
      const pos = new vscode.Position(line, col);
      const hovers = await vscode.commands.executeCommand<vscode.Hover[]>(
        'vscode.executeHoverProvider',
        sourceUri,
        pos
      );
      if (!hovers || hovers.length === 0) {
        this.panel?.webview.postMessage({ type: 'hover-result', html: '', x, y });
        return;
      }

      const markdown = hovers
        .flatMap((h) => h.contents)
        .map((c) => {
          if (typeof c === 'string') return c;
          if ('value' in c) {
            const ms = c as vscode.MarkdownString;
            return ms.value;
          }
          const marked = c as { language: string; value: string };
          return `\`\`\`${marked.language}\n${marked.value}\n\`\`\``;
        })
        .filter(Boolean)
        .join('\n\n---\n\n');

      let html = '';
      try {
        html =
          (await vscode.commands.executeCommand<string>('markdown.api.render', markdown)) ?? '';
      } catch {
        html = `<pre>${markdown.replace(/&/g, '&amp;').replace(/</g, '&lt;')}</pre>`;
      }

      this.panel?.webview.postMessage({ type: 'hover-result', html, x, y });
    }

    if (msg.type === 'scroll-source') {
      const previewLine = msg.line as number;
      const sourceLine = this.currentLineMap[previewLine] ?? previewLine;
      const editor = vscode.window.visibleTextEditors.find(
        (e) => e.document.uri.toString() === this.currentDocUri
      );
      if (!editor) return;
      const pos = new vscode.Position(sourceLine, 0);
      this.suppressScrollSync = true;
      editor.revealRange(new vscode.Range(pos, pos), vscode.TextEditorRevealType.AtTop);
      setTimeout(() => {
        this.suppressScrollSync = false;
      }, 200);
    }
  }

  private async pushUpdate(
    panel: vscode.WebviewPanel,
    document: vscode.TextDocument
  ): Promise<void> {
    const source = document.getText();
    const docUri = document.uri.toString();
    const gen = ++this.updateGeneration;

    const config = vscode.workspace.getConfiguration('goPreview.rules');
    const parser = ParserService.getInstance();

    // 1) Parse the source once and run the transformer pipeline. A single tree is
    //    shared by all transformers — no intermediate re-parse, no leaked trees.
    let sourceTree: Tree | null = null;
    try {
      sourceTree = await parser.parse(source);
    } catch {
      sourceTree = null;
    }
    let descriptors: LineDescriptor[];
    try {
      descriptors = runTransformers(descriptorsFromSource(source), sourceTree, (id) =>
        config.get(id)
      );
    } catch {
      descriptors = descriptorsFromSource(source);
    } finally {
      sourceTree?.delete();
    }

    const {
      code,
      lineMap,
      fadedLineIndices,
      highlightedLineIndices,
      collapsedLineIndices,
      colMaps,
    } = materialize(descriptors);

    // 2) Parse the output once for syntax highlighting and decorations.
    let outputTree: Tree | null = null;
    try {
      outputTree = await parser.parse(code);
    } catch {
      outputTree = null;
    }
    const highlighter = await getHighlighter();

    // A newer update (or a document switch) superseded this one while we awaited.
    // Bail before touching shared state so stale data can't clobber the current doc.
    if (gen !== this.updateGeneration || this.currentDocUri !== docUri) {
      outputTree?.delete();
      return;
    }
    this.currentLineMap = lineMap;

    const isDark = vscode.window.activeColorTheme.kind !== vscode.ColorThemeKind.Light;
    const theme = isDark ? 'dark-plus' : 'light-plus';

    const tabSize = vscode.workspace
      .getConfiguration('editor', document.uri)
      .get<number>('tabSize', 4);

    let html: string;
    try {
      const packages = config.get<string[]>('fadePackages', []);
      const decorations = packageDecorations.build({ code, tree: outputTree }, packages);
      html = highlighter.codeToHtml(code, { lang: 'go', theme, decorations });
    } finally {
      outputTree?.delete();
    }

    panel.webview.postMessage({
      type: 'update',
      html,
      tabSize,
      lineMap,
      fadedLines: Array.from(fadedLineIndices),
      highlightedLines: Array.from(highlightedLineIndices),
      collapsedLines: Array.from(collapsedLineIndices),
      colMaps,
      sourceUri: document.uri.toString(),
    });

    this.pushDiagnostics(document);
  }

  private buildShell(webview: vscode.Webview): string {
    const scriptUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.context.extensionUri, 'media', 'preview.js')
    );
    const cssUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.context.extensionUri, 'media', 'preview.css')
    );
    const nonce = randomNonce();

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
}

function randomNonce(): string {
  return randomBytes(16).toString('hex');
}
