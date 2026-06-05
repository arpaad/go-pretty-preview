import * as vscode from 'vscode';
import * as path from 'path';
import { Tree } from 'web-tree-sitter';
import { runTransformers } from '../core/transformers/index';
import { descriptorsFromSource, materialize, LineDescriptor } from '../core/descriptors';
import { buildPackageDecorations } from '../core/decorations/packageDecorations';
import { ParserService } from './ParserService';
import {
  getHighlighter,
  buildShell,
  appendRangeDecorations,
  sendDiagnostics,
  buildHoverHtml,
} from './previewUtils';

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
  // True when the panel was opened in "preview only" mode (no source file visible).
  private previewOnly = false;

  constructor(private readonly context: vscode.ExtensionContext) {
    getHighlighter(ParserService.getInstance()).catch(() => {}); // trigger WASM + query early
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
    this.previewOnly = false;
    this.initPanel(document, vscode.ViewColumn.Beside);
  }

  openOnly(document: vscode.TextDocument): void {
    if (this.panel) {
      this.panel.reveal(vscode.ViewColumn.One);
      this.updatePanel(document);
      return;
    }
    this.previewOnly = true;
    this.initPanel(document, vscode.ViewColumn.One);
    // Close the source file tab so only the preview is visible, like "Open Preview" in Markdown.
    for (const group of vscode.window.tabGroups.all) {
      for (const tab of group.tabs) {
        if (
          tab.input instanceof vscode.TabInputText &&
          tab.input.uri.toString() === document.uri.toString()
        ) {
          void vscode.window.tabGroups.close(tab);
          break;
        }
      }
    }
  }

  private initPanel(document: vscode.TextDocument, column: vscode.ViewColumn): void {
    const panel = vscode.window.createWebviewPanel(
      'goPreview',
      `Preview: ${path.basename(document.fileName)}`,
      column,
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
    // In preview-only mode the panel is locked to the file that was explicitly opened;
    // don't follow the active editor to definition targets or other files.
    if (this.previewOnly) return;
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
    sendDiagnostics(this.panel, document, this.currentLineMap);
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
      const html = await buildHoverHtml(sourceUri, pos);
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
      fadeRanges,
      highlightRanges,
    } = materialize(descriptors);

    // 2) Parse the output once for syntax highlighting and decorations.
    let outputTree: Tree | null = null;
    try {
      outputTree = await parser.parse(code);
    } catch {
      outputTree = null;
    }
    const highlighter = await getHighlighter(parser);

    // A newer update (or a document switch) superseded this one while we awaited.
    // Bail before touching shared state so stale data can't clobber the current doc.
    if (gen !== this.updateGeneration || this.currentDocUri !== docUri) {
      outputTree?.delete();
      return;
    }
    this.currentLineMap = lineMap;

    const isDark = vscode.window.activeColorTheme.kind !== vscode.ColorThemeKind.Light;
    const tabSize = vscode.workspace
      .getConfiguration('editor', document.uri)
      .get<number>('tabSize', 4);

    let html: string;
    try {
      const packages = config.get<string[]>('fadePackages', []);
      const decorations = buildPackageDecorations(code, packages, outputTree);
      appendRangeDecorations(decorations, fadeRanges, 'rule-group-hidden');
      appendRangeDecorations(decorations, highlightRanges, 'rule-group-highlighted');
      html = highlighter.render({
        code,
        tree: outputTree,
        lineMap,
        colMaps,
        collapsedLines: collapsedLineIndices,
        decorations,
      });
    } finally {
      outputTree?.delete();
    }

    panel.webview.postMessage({
      type: 'update',
      html,
      theme: isDark ? 'dark' : 'light',
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
    return buildShell(webview, this.context);
  }
}

