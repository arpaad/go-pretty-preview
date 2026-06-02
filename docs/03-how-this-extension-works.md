# 03 — How This Extension Works (End-to-End)

## The full data flow

```
User clicks the eye icon in the editor title bar
  │
  ▼
extension.ts: command "goPreview.openPreview" fires
  │  Gets active text document (the .go file)
  ▼
GoPreviewProvider.open(document)
  │  Creates a WebviewPanel beside the source editor
  │  Calls pushUpdate() immediately to show content
  ▼
GoPreviewProvider.pushUpdate(panel, document)
  │  1. document.getText()       → raw Go source
  │  2. runTransformers(source)  → { code, collapsedLineIndices }
  │  3. hljs.highlight(code)     → syntax-highlighted HTML string
  │  4. applyCollapsedClasses()  → wraps collapsed lines in <span class="guard-inline">
  │  5. panel.webview.postMessage({ type: 'update', html })
  ▼
media/preview.js (runs in the webview/browser)
  │  Receives the message
  │  Sets document.getElementById('preview-code').innerHTML = html
  ▼
User sees syntax-highlighted Go code with guard lines dimmed
```

---

## What happens when you edit the source file?

```
User types in the .go source editor
  │
  ▼
VS Code fires vscode.workspace.onDidChangeTextDocument
  │
  ▼
extension.ts listener calls provider.handleDocumentChange(event)
  │
  ▼
GoPreviewProvider finds the panel for this document URI
  │
  ▼
GoPreviewProvider.pushUpdate() runs again → new HTML sent to webview
  │
  ▼
Preview updates live (no reload, no flicker)
```

---

## The transformer pipeline

`runTransformers()` in `src/transformers/index.ts` chains all enabled transformers:

```
source text
  │
  ├─ [if enabled] SingleStatementIfTransformer.transform(source)
  │    Returns: { code: transformedText, collapsedLineIndices: Set<number> }
  │
  ├─ [future] AnotherTransformer.transform(...)
  │
  ▼
{ code: finalText, collapsedLineIndices: mergedSet }
```

Each transformer:
1. Receives the current `code` string
2. Returns a new `code` string (with multi-line blocks collapsed)
3. Returns a `Set<number>` of **output** line indices that were collapsed

The line indices are 0-based and refer to lines in the *output* (not the original source). This matters when chaining multiple transformers.

---

## How `SingleStatementIfTransformer` works

It scans line by line looking for patterns like:

```go
    if err != nil {       ← line i:   starts with "if ... {"
        return err        ← line i+1: single return/break/continue
    }                     ← line i+2: closing "}" (or "} else {")
```

When found (and optionally followed by `} else if ...` or `} else {` chains), it:

1. Extracts all branches: `[{ header: "if err != nil", body: "return err" }]`
2. Builds a collapsed line: `"    if err != nil { return err }"`
3. Checks the collapsed line fits within 120 characters
4. Pushes the collapsed line to output and records its index in `collapsedLineIndices`
5. Skips the original 3 (or more) lines

**What does NOT collapse:**
- Any branch with more than one statement in the body
- The result would be longer than 120 characters
- Branches containing anything other than `return`, `break`, or `continue`

---

## The Webview HTML structure

```html
<html>
<head>
  <!-- CSP header — security sandbox -->
  <!-- preview.css — syntax token colours + guard-inline style -->
</head>
<body>
  <pre>
    <code id="preview-code" class="hljs language-go">
      <!-- This innerHTML is replaced on every update -->
      package main

      import "fmt"

      func foo(x int) error {
          result, err := bar(x)
          <span class="guard-inline">    if err != nil { return err }</span>
          fmt.Println(result)
          return nil
      }
    </code>
  </pre>
  <script src="preview.js"></script>  <!-- just listens for 'update' messages -->
</body>
</html>
```

The `<pre><code>` wrapper preserves whitespace. `innerHTML` replacement is fast and doesn't cause scroll position resets because we're updating the children of a stable element.

---

## Settings integration

`vscode.workspace.getConfiguration('goPreview.rules')` reads the user's settings at call time. When the user changes a setting in VS Code's Settings UI:

1. `vscode.workspace.onDidChangeConfiguration` fires
2. `extension.ts` calls `provider.handleConfigChange()`
3. All open preview panels re-render with the new settings

This means you can toggle a rule off in settings and see the preview immediately update.
