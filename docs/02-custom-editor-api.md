# 02 — Webview & Custom Editor API

## What is a Webview?

A **Webview** is an embedded browser window inside VS Code. It lets you display arbitrary HTML/CSS/JavaScript — a full web page — in a panel, sidebar, or editor tab.

This is how the Go Preview works: when you click the eye icon, the extension creates a Webview panel and sends rendered HTML into it.

---

## Creating a Webview Panel

```typescript
const panel = vscode.window.createWebviewPanel(
  'goPreview',              // internal ID (unique per view type)
  'Preview: main.go',       // title shown in the tab
  vscode.ViewColumn.Beside, // open to the right of the current editor
  {
    enableScripts: true,    // allow JavaScript in the webview
    localResourceRoots: [   // which local folders the webview can load files from
      vscode.Uri.joinPath(context.extensionUri, 'media'),
    ],
  }
);

// Set the HTML content
panel.webview.html = `<html><body>Hello</body></html>`;
```

`ViewColumn.Beside` means "open in a new column to the right". Other options: `One`, `Two`, `Active`, etc.

---

## Security: Content Security Policy (CSP)

Webviews are sandboxed. VS Code recommends adding a CSP header to prevent XSS and limit what the webview can do:

```html
<meta http-equiv="Content-Security-Policy"
  content="default-src 'none';
           style-src  ${webview.cspSource};
           script-src 'nonce-ABC123';">
```

Key rules:
- `default-src 'none'` — block everything by default
- `style-src ${webview.cspSource}` — allow CSS loaded from `localResourceRoots`
- `script-src 'nonce-XYZ'` — allow only scripts with a matching `nonce` attribute

A **nonce** is a random string generated per page load. You include it in the CSP header AND in the script tag:

```html
<script nonce="ABC123" src="${scriptUri}"></script>
```

Without a nonce, VS Code will block the script from running.

---

## Loading local files (CSS, JS)

You can't use regular file paths inside a webview. You must convert them with `webview.asWebviewUri()`:

```typescript
// Wrong:  href="/home/user/dev/go_preview/media/preview.css"
// Right:
const cssUri = webview.asWebviewUri(
  vscode.Uri.joinPath(context.extensionUri, 'media', 'preview.css')
);
// cssUri looks like: vscode-resource:/path/to/media/preview.css
```

This special `vscode-resource:` URI is only resolvable inside webviews.

---

## Messaging: Extension Host ↔ Webview

The extension host (Node.js) and the webview (browser) run in separate contexts. They communicate via messages.

**Extension host → Webview:**
```typescript
panel.webview.postMessage({ type: 'update', html: '<code>...' });
```

**Webview → Extension host:**
```javascript
// Inside media/preview.js (browser context)
const vscode = acquireVsCodeApi();
vscode.postMessage({ type: 'requestRefresh' });
```

**Extension host receiving from webview:**
```typescript
panel.webview.onDidReceiveMessage(msg => {
  if (msg.type === 'requestRefresh') { ... }
});
```

In this project, we only send messages in one direction (extension → webview), so `acquireVsCodeApi()` isn't needed in the preview JS.

---

## Panel lifecycle

```typescript
// Called when the user closes the tab
panel.onDidDispose(() => {
  // clean up — remove from your panels Map, cancel subscriptions, etc.
});

// Reveal an existing panel instead of creating a duplicate
panel.reveal(vscode.ViewColumn.Beside);
```

---

## CustomReadonlyEditorProvider (alternative approach)

Instead of a WebviewPanel, VS Code also has `CustomReadonlyEditorProvider`. The difference:

| `WebviewPanel` | `CustomReadonlyEditorProvider` |
|---|---|
| Opens as a separate panel | Replaces the default editor for that file |
| You control when it opens | VS Code opens it automatically (if `priority: "default"`) |
| Simpler to implement | More integrated with VS Code's editor system |

This project uses `WebviewPanel` opened by a command (simpler, non-disruptive). A future enhancement could register a `CustomReadonlyEditorProvider` with `priority: "default"` to auto-open for `.go` files.
