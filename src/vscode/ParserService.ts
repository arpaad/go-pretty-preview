import * as vscode from 'vscode';
import { Tree } from 'web-tree-sitter';
import { GoParser } from '../core/parser';

let instance: ParserService | undefined;
let log: vscode.OutputChannel | undefined;

function getLog(): vscode.OutputChannel {
  if (!log) log = vscode.window.createOutputChannel('Go Pretty Preview');
  return log;
}

/**
 * Thin vscode wrapper around the vscode-free {@link GoParser}: supplies the WASM
 * directory (`__dirname` of the bundle, where esbuild copies the .wasm files) and
 * an OutputChannel logger.
 */
export class ParserService {
  private readonly parser: GoParser;

  private constructor() {
    this.parser = new GoParser({
      wasmDir: __dirname,
      log: (msg) => getLog().appendLine(`[ParserService] ${msg}`),
    });
    this.parser
      .whenReady()
      .catch((err) => getLog().appendLine(`[ParserService] init failed: ${err}`));
  }

  static getInstance(): ParserService {
    if (!instance) instance = new ParserService();
    return instance;
  }

  /**
   * Parses Go source. The caller takes ownership of the returned `Tree` and MUST
   * free it with `tree.delete()` when done.
   */
  parse(source: string): Promise<Tree> {
    return this.parser.parse(source);
  }
}
