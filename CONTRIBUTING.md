# Contributing to Go Pretty Preview

Thanks for your interest! Contributions of all kinds are welcome — new preview rules, bug fixes, docs improvements, or feedback via issues.

## Getting started

```bash
git clone https://github.com/Luckyman42/vscode-go-preview.git
cd vscode-go-preview
npm install
```

Press `F5` in VS Code to open an **Extension Development Host** — a separate VS Code window with the extension loaded live. Changes take effect after `npm run build` (or `npm run watch` for continuous rebuild).

## Project layout

```
src/
  transformers/    Each file = one preview rule
  GoPreviewProvider.ts
  extension.ts
media/             Webview HTML shell, CSS, JS
docs/              Architecture docs
```

## Adding a new preview rule

The most common contribution is a new **transformer** — a function that rewrites Go source text before it reaches the syntax highlighter.

See [docs/04-adding-new-rules.md](docs/04-adding-new-rules.md) for the full walkthrough.

Short version:
1. Create `src/transformers/yourRuleName.ts` implementing `Transformer`
2. Register it in `src/transformers/index.ts`
3. Add a `goPreview.rules.yourRuleName` setting in `package.json` so users can toggle it
4. Document it in `README.md`

## Pull request guidelines

- Keep PRs focused — one feature or fix per PR
- Add or update the relevant section in `README.md` if your change is user-visible
- Run `npm run build` and verify the extension loads without errors before opening a PR
- PR title format: `feat: ...`, `fix: ...`, `docs: ...`, `refactor: ...`

## Reporting bugs

Use the [Bug Report](.github/ISSUE_TEMPLATE/bug_report.md) issue template and include:
- The Go code snippet that produces the wrong output (a minimal example is ideal)
- What the preview shows vs. what you expected
- VS Code version and OS

## Suggesting new rules

Open a [Feature Request](.github/ISSUE_TEMPLATE/feature_request.md) issue describing:
- The Go pattern you want simplified
- How you'd expect it to look in the preview
- Why it improves readability

## Code style

- TypeScript strict mode is on — no `any` without a comment explaining why
- No comments that just restate what the code does
- Keep transformer logic pure (input string → output string); side effects live in `GoPreviewProvider`
