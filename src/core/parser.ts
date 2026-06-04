import { Parser, Language, Tree } from 'web-tree-sitter';
import * as fs from 'fs';
import * as path from 'path';

/**
 * vscode-free Go parser. The vscode layer (src/vscode/ParserService.ts) wraps
 * this with `__dirname` and an OutputChannel; tests can construct it directly
 * (or use {@link parseGo}) by pointing `wasmDir` at the bundled `out/` folder.
 */
export interface GoParserOptions {
  /** Directory containing web-tree-sitter.wasm and tree-sitter-go.wasm. */
  wasmDir: string;
  /** Reads a file as bytes. Defaults to fs.readFileSync. */
  readFile?: (filePath: string) => Uint8Array;
  /** Optional logger callback. */
  log?: (msg: string) => void;
}

function defaultReadFile(filePath: string): Uint8Array {
  return fs.readFileSync(filePath);
}

export class GoParser {
  private parser!: Parser;
  private readonly ready: Promise<void>;
  private readonly readFile: (filePath: string) => Uint8Array;

  constructor(private readonly opts: GoParserOptions) {
    this.readFile = opts.readFile ?? defaultReadFile;
    this.ready = this.init();
  }

  private async init(): Promise<void> {
    const { wasmDir, log } = this.opts;
    log?.(`loading WASM from ${wasmDir}`);
    await Parser.init({
      locateFile: (name: string) => path.join(wasmDir, name),
    });
    this.parser = new Parser();
    const lang = await Language.load(this.readFile(path.join(wasmDir, 'tree-sitter-go.wasm')));
    this.parser.setLanguage(lang);
    log?.('ready');
  }

  /** Resolves once the WASM language is loaded. */
  whenReady(): Promise<void> {
    return this.ready;
  }

  /**
   * Parses Go source into a `Tree`. Ownership transfers to the caller: the tree
   * lives on the WASM heap and MUST be freed with `tree.delete()` when no longer
   * needed (including intermediate trees that are discarded).
   */
  async parse(source: string): Promise<Tree> {
    await this.ready;
    return this.parser.parse(source)!;
  }
}

let sharedParser: GoParser | undefined;

/**
 * Convenience helper for parsing Go without wiring up a parser instance — handy
 * in tests. `wasmDir` defaults to this module's directory (i.e. the bundled
 * `out/` folder at runtime). The returned tree is owned by the caller.
 */
export async function parseGo(source: string, wasmDir: string = __dirname): Promise<Tree> {
  if (!sharedParser) sharedParser = new GoParser({ wasmDir });
  return sharedParser.parse(source);
}
