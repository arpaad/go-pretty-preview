// Runs inside the VS Code webview (browser context).
(function () {
  const vscode = acquireVsCodeApi();
  const container = document.getElementById('preview-container');
  const tooltip = document.getElementById('hover-tooltip');

  let lineMap = [];
  let collapsedLines = new Set();
  let hoverTimer = null;

  // ── helpers ──────────────────────────────────────────────────────────────

  function getLineElements() {
    return container.querySelectorAll('.line');
  }

  function previewLineOf(el) {
    const lineEl = el.closest ? el.closest('.line') : null;
    if (!lineEl) return -1;
    return [...getLineElements()].indexOf(lineEl);
  }

  function colOf(spanEl) {
    const lineEl = spanEl.closest('.line');
    if (!lineEl) return 0;
    let col = 0;
    // Walk the subtree in document order, accumulating text content until
    // we reach spanEl. Handles tokens nested inside decoration wrapper spans
    // (e.g. <span class="pkg-faded"><span style="...">fmt</span></span>).
    function walk(node) {
      if (node === spanEl) return true;
      if (node.nodeType === 3 /* TEXT_NODE */) { col += node.textContent.length; return false; }
      for (let i = 0; i < node.childNodes.length; i++) {
        if (walk(node.childNodes[i])) return true;
      }
      return false;
    }
    walk(lineEl);
    return col;
  }

  function sourcePosOf(spanEl) {
    const previewLine = previewLineOf(spanEl);
    if (previewLine < 0) return null;
    const sourceLine = lineMap[previewLine] ?? previewLine;
    // Collapsed lines have been rewritten; column positions no longer map to source.
    // Fall back to column 0 so hover/definition still resolves at the line start.
    const col = collapsedLines.has(previewLine) ? 0 : colOf(spanEl);
    return { line: sourceLine, col };
  }

  // ── message handling ──────────────────────────────────────────────────────

  function applyLineDecorations(indices, cssClass) {
    const lines = getLineElements();
    indices.forEach(i => lines[i]?.classList.add(cssClass));
  }

  function applyLineNumbers() {
    const lineEls = [...getLineElements()];
    lineEls.forEach((el, i) => {
      el.setAttribute('data-line-nr', String((lineMap[i] ?? i) + 1));
    });
  }

  // ── scroll sync ───────────────────────────────────────────────────────────

  let scrollTimer = null;
  // Set to true while we are programmatically scrolling to avoid echoing back.
  let suppressPreviewScroll = false;

  window.addEventListener('message', ({ data }) => {
    if (data.type === 'update') {
      container.innerHTML = data.html;
      const pre = container.querySelector('pre');
      if (pre) pre.style.tabSize = data.tabSize;
      lineMap = data.lineMap ?? [];
      collapsedLines = new Set(data.collapsedLines ?? []);
      applyLineDecorations(data.fadedLines ?? [], 'line-faded');
      applyLineDecorations(data.highlightedLines ?? [], 'line-highlighted');
      applyLineNumbers();
      hideTooltip();
    }

    if (data.type === 'diagnostics') {
      applyDiagnostics(data.items ?? []);
    }

    if (data.type === 'hover-result') {
      if (data.html) {
        showTooltip(data.html, data.x, data.y);
      } else {
        hideTooltip();
      }
    }

    if (data.type === 'scroll-to-line') {
      suppressPreviewScroll = true;
      const lineEls = [...getLineElements()];
      lineEls[data.line]?.scrollIntoView({ block: 'start', behavior: 'instant' });
      setTimeout(() => { suppressPreviewScroll = false; }, 200);
    }
  });

  window.addEventListener('scroll', () => {
    if (suppressPreviewScroll) return;
    clearTimeout(scrollTimer);
    scrollTimer = setTimeout(() => {
      const lineEls = [...getLineElements()];
      // Find the first line element at or below the viewport top.
      let topLine = 0;
      for (let i = 0; i < lineEls.length; i++) {
        if (lineEls[i].getBoundingClientRect().top >= 0) {
          topLine = i;
          break;
        }
      }
      vscode.postMessage({ type: 'scroll-source', line: topLine });
    }, 120);
  }, { passive: true });

  // ── double-click: navigate to source ─────────────────────────────────────

  container.addEventListener('dblclick', e => {
    const lineEl = e.target.closest ? e.target.closest('.line') : null;
    if (!lineEl) return;
    const previewLine = [...getLineElements()].indexOf(lineEl);
    if (previewLine < 0) return;
    vscode.postMessage({ type: 'navigate', line: lineMap[previewLine] ?? previewLine });
  });

  // ── ctrl-held visual feedback ─────────────────────────────────────────────

  document.addEventListener('keydown', e => {
    if (e.key === 'Control' || e.key === 'Meta') container.classList.add('ctrl-held');
  });
  document.addEventListener('keyup', e => {
    if (e.key === 'Control' || e.key === 'Meta') container.classList.remove('ctrl-held');
  });
  window.addEventListener('blur', () => container.classList.remove('ctrl-held'));

  // ── ctrl+click: go to definition ─────────────────────────────────────────

  container.addEventListener('click', e => {
    if (!e.ctrlKey && !e.metaKey) return;
    const spanEl = e.target.closest ? e.target.closest('span[style]') : null;
    if (!spanEl) return;
    const pos = sourcePosOf(spanEl);
    if (!pos) return;
    e.preventDefault();
    vscode.postMessage({ type: 'definition', line: pos.line, col: pos.col });
  });

  // ── hover: show LSP tooltip ───────────────────────────────────────────────

  container.addEventListener('mousemove', e => {
    clearTimeout(hoverTimer);
    const spanEl = e.target.closest ? e.target.closest('span[style]') : null;
    if (!spanEl) {
      hideTooltip();
      return;
    }
    const x = e.clientX;
    const y = e.clientY;
    hoverTimer = setTimeout(() => {
      const pos = sourcePosOf(spanEl);
      if (!pos) return;
      vscode.postMessage({ type: 'hover', line: pos.line, col: pos.col, x, y });
    }, 350);
  });

  container.addEventListener('mouseleave', () => {
    clearTimeout(hoverTimer);
    hideTooltip();
  });

  function showTooltip(html, x, y) {
    tooltip.innerHTML = html;
    // Reset to (0,0) before measuring so it doesn't influence layout
    tooltip.style.left = '0px';
    tooltip.style.top = '0px';
    tooltip.style.display = 'block';

    // Force a layout pass so offsetWidth/Height are accurate
    const tipW = tooltip.offsetWidth;
    const tipH = tooltip.offsetHeight;
    const winW = window.innerWidth;
    const winH = window.innerHeight;
    const margin = 14;

    // Prefer right of cursor; flip left if it would overflow right edge
    let left = x + margin;
    if (left + tipW > winW - 8) left = x - tipW - margin;
    // Hard-clamp inside viewport — prevents escaping the webview into the editor column
    left = Math.max(8, Math.min(left, winW - tipW - 8));

    // Prefer below cursor; flip above if it would overflow bottom edge
    let top = y + margin;
    if (top + tipH > winH - 8) top = y - tipH - margin;
    top = Math.max(8, Math.min(top, winH - tipH - 8));

    tooltip.style.left = left + 'px';
    tooltip.style.top = top + 'px';
  }

  function hideTooltip() {
    tooltip.style.display = 'none';
  }

  // ── diagnostics ───────────────────────────────────────────────────────────

  function applyDiagnostics(items) {
    // Clear previous decorations
    for (const el of container.querySelectorAll('.diag-error,.diag-warning,.diag-info')) {
      el.classList.remove('diag-error', 'diag-warning', 'diag-info');
      el.removeAttribute('title');
    }

    const lineEls = [...getLineElements()];
    for (const { line, severity, message } of items) {
      const lineEl = lineEls[line];
      if (!lineEl) continue;
      const cls = severity === 0 ? 'diag-error' : severity === 1 ? 'diag-warning' : 'diag-info';
      lineEl.classList.add(cls);
      // Append to any existing title
      const prev = lineEl.getAttribute('title');
      lineEl.setAttribute('title', prev ? `${prev}\n${message}` : message);
    }
  }
})();
