# Go Pretty Preview

[![VS Code Extension](https://img.shields.io/badge/VS%20Code-Extension-blue?logo=visualstudiocode)](https://github.com/Luckyman42/vscode-go-preview)
[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)
[![GitHub release](https://img.shields.io/github/v/release/Luckyman42/vscode-go-preview)](https://github.com/Luckyman42/vscode-go-preview/releases)

A VS Code extension that opens a **read-only rendered preview** of Go source files — like Markdown preview, but for Go.

The goal is to make large codebases (especially AI-generated code) easier to review by visually simplifying common verbose patterns.

---

## Features

### Single-statement if blocks → one line

Go's error propagation pattern is readable but visually noisy across a large file:

```go
result, err := doSomething()
if err != nil {
    return nil, err
}
```

In the preview it becomes one dimmed line, letting the "happy path" stand out:

```
result, err := doSomething()
if err != nil { return nil, err }    ← 50% opacity
```

Works for any single-statement `if` body — not just `err != nil`:
- `return`, `break`, `continue`
- `else if` and `else` chains where every branch is single-statement
- Skips collapse if the result would exceed 120 characters

---

## Installation

### From a release (VSIX)

1. Go to the [Releases page](https://github.com/Luckyman42/vscode-go-preview/releases)
2. Download the latest `.vsix` file
3. In VS Code, open the Command Palette (`Ctrl+Shift+P`) and run **"Extensions: Install from VSIX..."**
4. Select the downloaded file

Or via the terminal:

```bash
code --install-extension go-pretty-preview-<version>.vsix
```

### Build from source

```bash
git clone https://github.com/Luckyman42/vscode-go-preview.git
cd vscode-go-preview
npm install
npm run build
```

Then in VS Code: **Extensions: Install from VSIX...** → select the `.vsix` from the project root,  
or press `F5` to open an Extension Development Host directly.

---

## How to use

1. Open any `.go` file
2. Click the **eye icon** (⊙) in the editor title bar, or run **"Go Preview: Open Preview to Side"** from the Command Palette (`Ctrl+Shift+P`)
3. The preview opens beside your source editor and updates live as you type

The source editor remains fully editable. The preview is read-only.

---

## Settings

| Setting | Default | Description |
|---|---|---|
| `goPreview.rules.singleStatementIf` | `true` | Collapse single-statement if/else blocks |

Open VS Code Settings (`Ctrl+,`) and search for **"Go Pretty Preview"** to toggle rules.

---

## Development

```bash
# Install dependencies
npm install

# Build once
npm run build

# Build + watch for changes
npm run watch

# Launch Extension Development Host (press F5 in VS Code)
# → opens a new VS Code window with the extension loaded
```

See [docs/](docs/) for architecture details:
- [01 — VS Code Extension Overview](docs/01-vscode-extension-overview.md)
- [02 — Webview & Custom Editor API](docs/02-custom-editor-api.md)
- [03 — How This Extension Works](docs/03-how-this-extension-works.md)
- [04 — Adding New Rules](docs/04-adding-new-rules.md)

---

## Project structure

```
src/
  extension.ts             Entry point — activate() wires up the command
  GoPreviewProvider.ts     Opens panels, runs transformers, sends HTML to webview
  transformers/
    types.ts               Transformer interface
    index.ts               Runs all enabled transformers in sequence
    singleStatementIf.ts   Collapses single-statement if blocks
media/
  preview.css              Webview styles (syntax colours + guard-inline dimming)
  preview.js               Webview script (receives messages, updates DOM)
docs/
  01-vscode-extension-overview.md
  02-custom-editor-api.md
  03-how-this-extension-works.md
  04-adding-new-rules.md
.github/
  workflows/
    release.yml            Builds + packages VSIX on every version tag
  ISSUE_TEMPLATE/          Bug report & feature request templates
```

---

## Contributing

Contributions are welcome! Please read [CONTRIBUTING.md](CONTRIBUTING.md) before opening a PR.

The easiest way to contribute is to **add a new transformer** — see [docs/04-adding-new-rules.md](docs/04-adding-new-rules.md) for a step-by-step guide.

---

## License

[MIT](LICENSE)
