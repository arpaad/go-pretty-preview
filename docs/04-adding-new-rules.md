# 04 — Adding New Rules (Transformers)

This guide walks through adding a new visual rule to the preview. As an example we'll add **"dim module names"** — which reduces opacity on the package qualifier in `pkg.FuncName` calls so your eye focuses on the function name.

---

## Step 1: Create the transformer file

Create `src/transformers/dimModuleNames.ts`:

```typescript
import { Transformer, TransformOutput } from './types';

export class DimModuleNamesTransformer implements Transformer {
  readonly id = 'dimModuleNames';
  readonly label = 'Dim package qualifiers (pkg.Func → pkg.Func)';

  transform(source: string): TransformOutput {
    // This transformer only changes HTML rendering, not line structure,
    // so collapsedLineIndices stays empty.
    //
    // Replace "pkg.Func" with HTML that dims "pkg."
    // We use a placeholder approach: insert a special marker that
    // GoPreviewProvider will convert to a <span> after highlighting.
    //
    // For now, a simple regex approach on the highlighted HTML is used.
    // See GoPreviewProvider.buildHtml() for where post-processing happens.

    return { code: source, collapsedLineIndices: new Set() };
  }
}
```

> **Note:** Some rules (like dimming module names) are better applied as HTML post-processing *after* syntax highlighting, not as source text transformations. In that case, the `transform()` method returns the source unchanged, and you add the HTML post-processing step in `GoPreviewProvider.pushUpdate()`.

---

## Step 2: Register it in `src/transformers/index.ts`

```typescript
import { DimModuleNamesTransformer } from './dimModuleNames';

const allTransformers: Transformer[] = [
  new SingleStatementIfTransformer(),
  new DimModuleNamesTransformer(),   // ← add here
];
```

Transformers run in order. Put source-text transformers before HTML transformers.

---

## Step 3: Add a setting in `package.json`

Inside `contributes.configuration.properties`:

```jsonc
"goPreview.rules.dimModuleNames": {
  "type": "boolean",
  "default": false,
  "description": "Reduce opacity of package qualifiers (fmt., errors., etc.) to focus on function names"
}
```

The setting key must match the transformer's `id` property exactly — `runTransformers()` uses `config.get<boolean>(transformer.id)` to check if it's enabled.

---

## Step 4: Add CSS for the new visual effect

In `media/preview.css`:

```css
/* Dim package qualifiers — applies to spans injected by DimModuleNamesTransformer */
.pkg-qualifier {
  opacity: 0.4;
  transition: opacity 0.15s ease;
}
.pkg-qualifier:hover {
  opacity: 1;
}
```

---

## Step 5: Test it

1. `npm run build`
2. Press **F5** to open the Extension Development Host
3. Open a `.go` file, click the eye icon
4. Open Settings (`Ctrl+,`), search for "Go Pretty Preview"
5. Toggle your new rule on/off and watch the preview update

---

## Reference: the Transformer interface

```typescript
// src/transformers/types.ts

export interface TransformOutput {
  code: string;
  /** 0-indexed line numbers in the OUTPUT that are "guard" (collapsed) lines */
  collapsedLineIndices: Set<number>;
}

export interface Transformer {
  readonly id: string;    // must match the settings key exactly
  readonly label: string; // human-readable name (for future settings UI)
  transform(source: string): TransformOutput;
}
```

---

## Ideas for future rules

| Rule ID | Effect |
|---|---|
| `highlightErrors` | Color lines containing `err` or `error` in a soft red |
| `dimModuleNames` | Reduce opacity of `pkg.` qualifiers |
| `collapseLongImports` | Fold import blocks with > 5 entries to a single line |
| `showFuncSignatures` | Bold function signatures to make them easier to scan |
| `hideTestBoilerplate` | Dim `t.Helper()`, `t.Parallel()` calls in test files |
