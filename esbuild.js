const esbuild = require('esbuild');
const fs = require('fs');
const path = require('path');

const isWatch = process.argv.includes('--watch');
const isProduction = process.argv.includes('--production');

const buildOptions = {
  entryPoints: ['src/vscode/extension.ts'],
  bundle: true,
  outfile: 'out/extension.js',
  external: ['vscode'],
  format: 'cjs',
  platform: 'node',
  sourcemap: !isProduction,
  minify: isProduction,
  // esbuild picks the ESM entry of web-tree-sitter (web-tree-sitter.js) and
  // converts it to CJS, leaving import.meta.url as undefined which breaks
  // createRequire() inside the Emscripten-generated WASM loader.
  // Force the CJS entry which uses __filename/__dirname instead.
  alias: {
    'web-tree-sitter': path.resolve(__dirname, 'node_modules/web-tree-sitter/web-tree-sitter.cjs'),
  },
};

function copyWasmAssets() {
  fs.copyFileSync(
    path.join('node_modules', 'web-tree-sitter', 'web-tree-sitter.wasm'),
    path.join('out', 'web-tree-sitter.wasm')
  );
  fs.copyFileSync(
    path.join('node_modules', 'tree-sitter-go', 'tree-sitter-go.wasm'),
    path.join('out', 'tree-sitter-go.wasm')
  );
}

if (isWatch) {
  esbuild.context(buildOptions).then(ctx => {
    ctx.watch();
    copyWasmAssets();
    console.log('Watching for changes...');
  });
} else {
  esbuild.build(buildOptions).then(() => {
    copyWasmAssets();
    console.log('Build complete.');
  });
}
