import * as vscode from 'vscode';
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

export class GoPreviewCustomEditorProvider
  implements vscode.CustomReadonlyEditorProvider<vscode.CustomDocument>
{
  static readonly viewType = 'goPreview.previewOnly';

  constructor(private readonly context: vscode.ExtensionContext) {
    getHighlighter(ParserService.getInstance()).catch(() => {});
  }

  openCustomDocument(uri: vscode.Uri): vscode.CustomDocument {
    return { uri, dispose: () => {} };
  }

  async resolveCustomEditor(
    document: vscode.CustomDocument,
    webviewPanel: vscode.WebviewPanel
  ): Promise<void> {
    const uri = document.uri;

    webviewPanel.webview.options = {
      enableScripts: true,
      localResourceRoots: [vscode.Uri.joinPath(this.context.extensionUri, 'media')],
    };
    webviewPanel.webview.html = buildShell(webviewPanel.webview, this.context);

    // Per-panel mutable state (captured by closures below)
    let currentLineMap: number[] = [];
    let updateGeneration = 0;
    let updateTimer: ReturnType<typeof setTimeout> | undefined;

    const pushUpdate = async (doc: vscode.TextDocument): Promise<void> => {
      const source = doc.getText();
      const gen = ++updateGeneration;

      const config = vscode.workspace.getConfiguration('goPreview.rules');
      const parser = ParserService.getInstance();

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

      let outputTree: Tree | null = null;
      try {
        outputTree = await parser.parse(code);
      } catch {
        outputTree = null;
      }
      const highlighter = await getHighlighter(parser);

      if (gen !== updateGeneration) {
        outputTree?.delete();
        return;
      }
      currentLineMap = lineMap;

      const isDark = vscode.window.activeColorTheme.kind !== vscode.ColorThemeKind.Light;
      const tabSize = vscode.workspace
        .getConfiguration('editor', doc.uri)
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

      webviewPanel.webview.postMessage({
        type: 'update',
        html,
        theme: isDark ? 'dark' : 'light',
        tabSize,
        lineMap,
        fadedLines: Array.from(fadedLineIndices),
        highlightedLines: Array.from(highlightedLineIndices),
        collapsedLines: Array.from(collapsedLineIndices),
        colMaps,
        sourceUri: uri.toString(),
      });

      sendDiagnostics(webviewPanel, doc, lineMap);
    };

    // Load initial content — gopls also needs the document open to analyze it.
    const doc = await vscode.workspace.openTextDocument(uri);
    await pushUpdate(doc);

    // Message handling (hover, definition, navigate — no scroll-source since no source editor)
    webviewPanel.webview.onDidReceiveMessage(async (msg: { type: string; [k: string]: unknown }) => {
      if (msg.type === 'navigate') {
        const line = msg.line as number;
        const srcDoc = await vscode.workspace.openTextDocument(uri);
        const editor = await vscode.window.showTextDocument(srcDoc, vscode.ViewColumn.One);
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
          uri,
          pos
        );
        if (locations && locations.length > 0) {
          const loc = locations[0];
          const locDoc = await vscode.workspace.openTextDocument(loc.uri);
          const editor = await vscode.window.showTextDocument(locDoc, vscode.ViewColumn.One);
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
        const html = await buildHoverHtml(uri, pos);
        webviewPanel.webview.postMessage({ type: 'hover-result', html, x, y });
      }
    });

    const listeners: vscode.Disposable[] = [];

    listeners.push(
      vscode.languages.onDidChangeDiagnostics((e) => {
        if (!e.uris.some((u) => u.toString() === uri.toString())) return;
        vscode.workspace
          .openTextDocument(uri)
          .then((d) => sendDiagnostics(webviewPanel, d, currentLineMap));
      })
    );

    listeners.push(
      vscode.workspace.onDidChangeTextDocument((e) => {
        if (e.document.uri.toString() !== uri.toString()) return;
        clearTimeout(updateTimer);
        updateTimer = setTimeout(() => void pushUpdate(e.document), 120);
      })
    );

    listeners.push(
      vscode.workspace.onDidChangeConfiguration((e) => {
        if (!e.affectsConfiguration('goPreview') && !e.affectsConfiguration('editor.tabSize'))
          return;
        vscode.workspace.openTextDocument(uri).then((d) => void pushUpdate(d));
      })
    );

    listeners.push(
      vscode.window.onDidChangeActiveColorTheme(() => {
        vscode.workspace.openTextDocument(uri).then((d) => void pushUpdate(d));
      })
    );

    webviewPanel.onDidDispose(() => {
      clearTimeout(updateTimer);
      listeners.forEach((l) => l.dispose());
    });
  }
}
