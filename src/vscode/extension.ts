import * as vscode from 'vscode';
import { GoPreviewProvider } from './GoPreviewProvider';

export function activate(context: vscode.ExtensionContext): void {
  const provider = new GoPreviewProvider(context);

  context.subscriptions.push(
    vscode.commands.registerCommand('goPreview.openPreview', () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor || editor.document.languageId !== 'go') {
        vscode.window.showInformationMessage('Open a Go file to use Go Pretty Preview.');
        return;
      }
      provider.open(editor.document);
    }),

    vscode.commands.registerCommand('goPreview.togglePreview', () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor || editor.document.languageId !== 'go') {
        vscode.window.showInformationMessage('Open a Go file to use Go Pretty Preview.');
        return;
      }
      provider.toggle(editor.document);
    }),

    vscode.workspace.onDidChangeTextDocument((e) => {
      if (e.document.languageId === 'go') {
        provider.handleDocumentChange(e);
      }
    }),

    vscode.window.onDidChangeActiveColorTheme(() => {
      provider.handleConfigChange();
    }),

    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration('goPreview') || e.affectsConfiguration('editor.tabSize')) {
        provider.handleConfigChange();
      }
    }),

    vscode.window.onDidChangeActiveTextEditor((editor) => {
      provider.handleActiveEditorChange(editor);
    }),

    { dispose: () => provider.dispose() }
  );
}

export function deactivate(): void {}
