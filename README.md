# Go Pretty Preview

[![VS Code Extension](https://img.shields.io/badge/VS%20Code-Extension-blue?logo=visualstudiocode)](https://github.com/Luckyman42/go-pretty-preview)
[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)
[![GitHub release](https://img.shields.io/github/v/release/Luckyman42/go-pretty-preview)](https://github.com/Luckyman42/go-pretty-preview/releases)

A VS Code extension that opens a **read-only rendered preview** of Go source files — like Markdown preview, but for Go.

It is built for **reading and reviewing Go code, especially AI-generated code**. The preview keeps your code byte-for-byte intact, but visually quiets down the repetitive, boilerplate-heavy parts (error guards, package qualifiers) so the logic you actually need to review stands out. The goal is simple: **filter out the noise.**

The source editor stays fully editable; the preview is read-only and updates live as you type.

---

## Why this exists

When you review a large amount of machine-generated Go, most of the screen is taken up by patterns that are correct-by-construction and rarely the source of bugs:

```go
result, err := doSomething()
if err != nil {
    return nil, err
}
slog.Info("did something", "result", result)
```

Three of those four lines are noise for a reviewer. Go Pretty Preview renders the same code so the error guard collapses to one dim line — leaving the meaningful statement visible. Nothing is deleted from disk; only the *preview* is simplified.

---

## Features

### 1. `if`/`else` chains → compact, valid Go

Go's error-propagation pattern is readable but visually heavy across a whole file:

```go
result, err := doSomething()
if err != nil {
    return nil, err
}
```

In the preview each single-statement branch is compacted onto its own line:

```go
result, err := doSomething()
if err != nil { return nil, err }
```

Mixed `if`/`else-if`/`else` chains also work — single-statement branches collapse, multi-statement ones stay expanded, and the output is always valid Go:

```go
// before
if a > b {
    return a
} else if b > a {
    return b
} else {
    x := b
    return x * 2
}

// preview
if a > b { return a
} else if b > a { return b
} else {
    x := b
    return x * 2
}
```

The braces are kept (so the output compiles) but rendered at low opacity — they read as punctuation, not code. Applies to **any** single-statement body: `return`, `break`, `continue`, assignments, calls, etc.

Toggle with `goPreview.rules.inlineOneLineIf`.

### 2. Preview Rules — regexp-based display control

Define per-project rules using JavaScript regexp patterns. Rules are applied in priority order:

| Rule | Behaviour |
|---|---|
| `protect` | Immune to all other rules — line always shown as-is |
| `highlight` | Whole line highlighted, or only capture groups if the pattern has them |
| `hide` | Removed from the preview entirely |
| `fade` | Whole line dimmed, or only capture groups hidden (opacity 0) if the pattern has them |

**Example:** fade all `slog.Info`/`slog.Debug` calls, protect `slog.Fatal` so it always stays visible, and highlight anything that matches `error`:

```jsonc
"goPreview.rules.previewRules": {
  "protect": ["\\bslog\\.(Fatal|Panic)"],
  "highlight": ["(?i)\\berror\\b"],
  "hide": [],
  "fade": ["\\bslog\\.(Debug|Info|Warn)\\b"]
}
```

**Example with capture groups:** fade the entire argument list of any log call so only the function name stays visible:

```jsonc
"goPreview.rules.previewRules": {
  "fade": ["\\bslog\\.\\w+\\((.*?)\\)\\s*$"]
}
```

With capture groups the matched text is hidden (opacity 0); without groups the whole line is dimmed.

Patterns are JavaScript regexps. Common recipes are listed in [AGENTS.md](AGENTS.md).

### 3. Package-qualifier fading

Dim the package prefix in calls like `fmt.Println` or `context.Background` so your eye lands on the function, not the package:

```jsonc
"goPreview.rules.fadePackages": ["fmt", "sync", "context"]
```

The `fmt.` part renders dimmed; `Println` stays at full contrast.

### 4. Editor-grade navigation, without leaving the preview

The preview is wired into the same language server (gopls) that powers your editor:

- **Double-click a line** → jumps to that line in the source editor
- **Ctrl/Cmd+click a symbol** → Go to Definition
- **Hover a symbol** → combined tooltip: diagnostics (errors/warnings with 🔴/⚠️ prefix) and gopls doc/type info in one popup, just like the real editor
- **Diagnostics** → errors/warnings from gopls are mirrored as squiggles in the preview

### 5. Syntax highlighting with a deliberate read-only look

Rendering uses **tree-sitter highlight queries** — the same parser that powers the transformer pipeline — so there is one source of truth for both structure and color. The palette is intentionally different from your editor: the preview is meant to *look* read-only, not like a second editor pane. Dark and light palettes switch automatically with your VS Code theme.

---

## Installation

### From a release (VSIX)

1. Go to the [Releases page](https://github.com/Luckyman42/go-pretty-preview/releases)
2. Download the latest `.vsix` file
3. In VS Code, open the Command Palette (`Ctrl+Shift+P`) and run **"Extensions: Install from VSIX..."**
4. Select the downloaded file

Or via the terminal:

```bash
code --install-extension go-pretty-preview-<version>.vsix
```

### Build from source

```bash
git clone https://github.com/Luckyman42/go-pretty-preview.git
cd go-pretty-preview
npm install
npm run build
```

Then press `F5` in VS Code to open an Extension Development Host with the extension loaded, or package a VSIX with `npx vsce package`.

---

## How to use

There are two ways to open the preview, matching the experience of VS Code's built-in Markdown preview:

**Side-by-side** (source + preview visible together):
1. Open any `.go` file
2. Click the **open-preview icon** in the editor title bar, or run **"Go Preview: Open Preview to Side"** (`Ctrl+K V`)
3. The preview opens beside your source editor and updates live as you type

**Full preview** (only the preview, no source editor):
1. Open any `.go` file
2. Run **"Go Preview: Open as Preview Only"** from the Command Palette
3. The source editor tab closes; only the preview remains
4. Ctrl/Cmd+click navigates to definitions (opens in the same tab group); double-click opens the source file for editing

Alternatively, right-click a `.go` file in the Explorer → **Open With** → **Go Pretty Preview** to open it full-screen directly from the file tree.

Set `goPreview.openByDefault` to `true` to have the side-by-side preview open automatically whenever you focus a Go file.

---

## Settings

Open Settings (`Ctrl+,`) and search for **"Go Pretty Preview"**.

| Setting | Type | Default | Description |
|---|---|---|---|
| `goPreview.openByDefault` | boolean | `false` | Open the preview automatically when a Go file is activated |
| `goPreview.rules.inlineOneLineIf` | boolean | `true` | Inline one-line `if`/`else-if`/`else` blocks onto a single line |
| `goPreview.rules.previewRules` | object | `{}` | Regexp-based display rules: `protect`, `highlight`, `hide`, `fade` — each a list of JS regexp strings |
| `goPreview.rules.fadePackages` | string[] | `[]` | Package names whose qualifier (e.g. `fmt.`) renders dimmed |

---

## Development

```bash
npm install        # install dependencies
npm run build      # one-shot build
npm run watch      # rebuild on change
# Press F5 in VS Code to launch the Extension Development Host
```

See [AGENTS.md](AGENTS.md) for the architecture, conventions, and a guide to adding new rules — written for both human contributors and AI coding agents.

---

## Project structure

The code is split into a **vscode-free `core/`** (pure, easily testable) and a thin
**`vscode/`** layer that wires it to the editor:

```
src/
  core/                    vscode-free — pure logic, no editor APIs
    parser.ts              GoParser (injectable wasmDir) + parseGo() test helper
    descriptors.ts         LineDescriptor model + materialize() + LineBuilder (colMap)
    astUtils.ts            ERROR-subtree degradation, block statement helpers
    goHighlights.ts        Inlined Go tree-sitter highlight query
    highlighter.ts         Tree-sitter captures → HTML (token spans with source positions)
    transformers/
      types.ts             Transformer interface (descriptor in / descriptor out)
      index.ts             Runs enabled transformers over one shared source tree
      previewRules.ts      Regexp-based protect / highlight / hide / fade rules
      inlineOneLineIf.ts   Collapses single-statement if/else chains to valid Go
    decorations/
      types.ts             DecorationProvider interface (column-level effects)
      packageDecorations.ts  Package-prefix fading (config passed in, not read here)
  vscode/                  editor integration
    extension.ts                    Entry point — activate() wires up commands & listeners
    GoPreviewProvider.ts            Command-based panel (side-by-side and preview-only modes)
    GoPreviewCustomEditorProvider.ts  Custom editor — powers "Open With" in the file explorer
    previewUtils.ts                 Shared utilities: buildShell, buildHoverHtml, sendDiagnostics
    ParserService.ts                vscode wrapper around core GoParser (wasmDir + OutputChannel)
media/
  preview.css              Webview styles (two syntax palettes, dimming, tooltip, diagnostics)
  preview.js               Webview script (renders HTML, navigation, hover, diagnostics)
.github/                   Release workflow + issue templates
```

The preview is rendered with **tree-sitter highlight queries** (not Shiki) into a
deliberately distinct, read-only look. A single source tree drives all transformers
(no per-step re-parse); the rendered output is always valid Go.

---

## Known limitations

- `if`/`else` chains collapse only when each branch has at most one visible statement. A branch with a trailing line-comment on its body line (`if x { stmt // note`) is also left expanded to preserve the comment.
- Hover / go-to-definition column accuracy on collapsed lines relies on the per-column source map (`colMap`); very long conditions with Unicode may shift by a character.
- Preview Rules patterns are matched against each output line independently; there is no multi-line regexp support.

---

## Contributing

Contributions are welcome — new preview rules, bug fixes, docs. Please read [CONTRIBUTING.md](CONTRIBUTING.md) and [AGENTS.md](AGENTS.md) first.

The easiest way to contribute is to **add a new transformer**; [AGENTS.md](AGENTS.md) walks through the architecture and the steps to add one.

---

## License

[MIT](LICENSE)
