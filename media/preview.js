// Runs inside the VS Code webview (browser context).
// Receives messages from the extension host and updates the DOM.

(function () {
  const container = document.getElementById('preview-container');

  window.addEventListener('message', ({ data }) => {
    if (data.type === 'update') {
      container.innerHTML = data.html;
      const pre = container.querySelector('pre');
      if (pre) {
        pre.style.tabSize = data.tabSize;
      }
    }
  });
})();
