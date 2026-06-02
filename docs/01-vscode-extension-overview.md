# 01 — VS Code Extension Overview

## What is a VS Code Extension?

A VS Code extension is a Node.js package that VS Code loads at runtime to add features. It runs in a separate process called the **Extension Host** — not the main VS Code UI process — which means a crashing extension can't crash the editor.

---

## The `package.json` manifest

Every extension starts with `package.json`. It has two roles:

1. **npm metadata** — name, version, dependencies (same as any Node project)
2. **VS Code metadata** — tells VS Code what the extension does *before loading it*

The VS Code-specific keys are:

```jsonc
{
  "engines":          { "vscode": "^1.85.0" },  // minimum VS Code version
  "activationEvents": ["onLanguage:go"],          // WHEN to load this extension
  "main":             "./out/extension.js",       // WHAT file to load
  "contributes":      { ... }                     // WHAT to add to the UI
}
```

### `activationEvents`

VS Code is lazy — it won't load your extension until one of the activation events fires.
Common events:

| Event | When |
|---|---|
| `onLanguage:go` | User opens a `.go` file |
| `onCommand:myExt.doThing` | User runs the command |
| `*` | Always (slow, avoid it) |

### `contributes`

This declarative section registers things into the VS Code UI:

| Key | What it adds |
|---|---|
| `commands` | Items in the Command Palette (`Ctrl+Shift+P`) |
| `menus` | Buttons/items in toolbars, context menus |
| `configuration` | Settings in the Settings UI |
| `keybindings` | Keyboard shortcuts |
| `languages` | Language support (file associations, etc.) |

VS Code reads `contributes` at startup for every installed extension — but only *loads* your code when an `activationEvent` fires.

---

## The entry point: `extension.ts`

When VS Code loads your extension it calls one exported function:

```typescript
export function activate(context: vscode.ExtensionContext): void {
  // register commands, providers, listeners here
}

export function deactivate(): void {
  // optional cleanup
}
```

Everything you register goes into `context.subscriptions` — VS Code calls `.dispose()` on each one when the extension is deactivated.

```typescript
context.subscriptions.push(
  vscode.commands.registerCommand('myExt.hello', () => {
    vscode.window.showInformationMessage('Hello!');
  })
);
```

---

## The build step

VS Code requires a single compiled `.js` file. This project uses **esbuild** (via `esbuild.js`) to:
- Compile TypeScript → JavaScript
- Bundle all `src/` files + `node_modules` into one `out/extension.js`
- Mark `vscode` as external (it's provided by VS Code itself, not npm)

```
npm run build   → one-shot compile
npm run watch   → rebuild on every file save
```

---

## Debugging (F5)

`.vscode/launch.json` configures the debugger. Pressing **F5** will:
1. Run the build task (defined in `.vscode/tasks.json`)
2. Open a new VS Code window called the **Extension Development Host**
3. Your extension is loaded into that window
4. You can set breakpoints in `src/` and they'll hit in the debugger

The Extension Development Host is a full VS Code instance — you can open any folder, use the terminal, etc. It's just also running your extension.

---

## Key VS Code APIs used in this project

| API | Purpose |
|---|---|
| `vscode.commands.registerCommand` | Wire up commands from `contributes.commands` |
| `vscode.window.createWebviewPanel` | Open a custom HTML panel |
| `vscode.workspace.onDidChangeTextDocument` | Listen for file edits |
| `vscode.workspace.getConfiguration` | Read user settings |
| `vscode.window.activeTextEditor` | Get the currently focused editor |
