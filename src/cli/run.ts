import { CliUsageError } from './args.js';
import { packageVersion } from '../core/version.js';
import * as server from './commands/server.js';
import * as elements from './commands/elements.js';
import * as scene from './commands/scene.js';
import { snapshot } from './commands/snapshot.js';
import { arrange } from './commands/arrange.js';
import { installSkill } from './commands/install-skill.js';

interface Command {
  handler: (argv: string[]) => Promise<void>;
  summary: string;
  usage: string;
}

const COMMANDS: Record<string, Command> = {
  start: { handler: server.start, summary: 'Start the canvas server (detached)', usage: 'start' },
  stop: { handler: server.stop, summary: 'Stop the canvas server', usage: 'stop' },
  status: { handler: server.status, summary: 'Canvas health, element count, browser clients', usage: 'status' },
  apply: { handler: elements.apply, summary: 'Apply a {create,update,delete} patch in one call', usage: 'apply [patch.json|-] (update entries accept direct fields or {id,set:{...}})' },
  add: { handler: elements.add, summary: 'Create elements from a JSON array', usage: 'add [elements.json] (or stdin) | add --one \'{"type":"rectangle",...}\'' },
  update: { handler: elements.update, summary: 'Update one element', usage: 'update <id> --set \'{"backgroundColor":"#ffc9c9"}\'' },
  delete: { handler: elements.del, summary: 'Delete elements by id', usage: 'delete <id> [<id> ...]' },
  get: { handler: elements.get, summary: 'Get one element by id', usage: 'get <id>' },
  query: { handler: elements.query, summary: 'Query elements (server + typed client-side filters)', usage: 'query [--type rectangle] [--bbox x0,y0,x1,y1] [--filter locked=true] [--filter-json \'{...}\']' },
  describe: { handler: scene.describe, summary: 'AI-readable scene description (plain text)', usage: 'describe' },
  screenshot: { handler: scene.screenshot, summary: 'Capture the canvas (needs an open browser tab)', usage: 'screenshot [--out file.png] [--format png|svg] [--no-background]' },
  export: { handler: scene.exportCmd, summary: 'Export the scene as .excalidraw JSON', usage: 'export [--out scene.excalidraw]' },
  import: { handler: scene.importCmd, summary: 'Import a .excalidraw file (merge by default)', usage: 'import [scene.excalidraw|-] [--replace] (or stdin)' },
  mermaid: { handler: scene.mermaid, summary: 'Render a Mermaid diagram onto the canvas (needs a browser tab)', usage: 'mermaid [diagram.mmd|-] (or stdin)' },
  snapshot: { handler: snapshot, summary: 'Save / list / restore named canvas snapshots', usage: 'snapshot save|list|restore [name]' },
  arrange: { handler: arrange, summary: 'Align, distribute, group, lock, duplicate elements', usage: 'arrange align|distribute|group|ungroup|lock|unlock|duplicate --ids a,b,c [--to left|horizontal|...]' },
  share: { handler: scene.share, summary: 'Export to a shareable excalidraw.com URL', usage: 'share' },
  clear: { handler: scene.clear, summary: 'Clear the whole canvas', usage: 'clear --yes' },
  'install-skill': { handler: installSkill, summary: 'Install the bundled agent skill', usage: 'install-skill [--target claude|codex|<dir>]' }
};

function printHelp(): void {
  const lines = [
    `mcp-excalidraw-server ${packageVersion()} — Excalidraw toolkit for AI coding agents`,
    '',
    'Usage:',
    '  mcp-excalidraw-server                  Run the MCP stdio server (for MCP clients)',
    '  mcp-excalidraw-server <command> [...]  Drive the canvas from the command line',
    '  excalidraw-canvas <command> [...]      Same CLI under its short alias',
    '',
    'Commands:',
    ...Object.entries(COMMANDS).map(([name, cmd]) => `  ${name.padEnd(14)} ${cmd.summary}`),
    '',
    'Conventions:',
    '  Results are JSON on stdout — except `describe` (plain text) and raw-content',
    '  output when --out is omitted (`export` scene JSON, `screenshot --format svg`).',
    '  Diagnostics go to stderr.',
    '  Exit codes: 0 ok, 1 error, 2 usage, 3 canvas unreachable, 4 browser tab required.',
    '  Canvas-driving commands auto-start the server (disable with EXCALIDRAW_NO_AUTOSTART=1).',
    '  Canvas URL comes from EXPRESS_SERVER_URL (default http://127.0.0.1:3000) or --url.',
    '',
    'Run `mcp-excalidraw-server help <command>` for per-command usage.'
  ];
  process.stdout.write(lines.join('\n') + '\n');
}

function exitCodeFor(error: unknown): number {
  if (error instanceof CliUsageError) return 2;
  const code = (error as any)?.code;
  if (code === 'CANVAS_UNREACHABLE') return 3;
  if (code === 'BROWSER_REQUIRED') return 4;
  return 1;
}

export async function runCli(argv: string[]): Promise<void> {
  const [name, ...rest] = argv;

  if (!name || name === 'help' || name === '--help' || name === '-h') {
    const topic = name === 'help' ? rest[0] : undefined;
    if (topic && COMMANDS[topic]) {
      process.stdout.write(`Usage: mcp-excalidraw-server ${COMMANDS[topic].usage}\n  ${COMMANDS[topic].summary}\n`);
    } else {
      printHelp();
    }
    return;
  }

  if (name === '--version' || name === '-v' || name === 'version') {
    process.stdout.write(packageVersion() + '\n');
    return;
  }

  const command = COMMANDS[name];
  if (!command) {
    process.stderr.write(`Unknown command "${name}". Run \`mcp-excalidraw-server help\` for the list.\n`);
    process.exitCode = 2;
    return;
  }

  try {
    await command.handler(rest);
  } catch (error) {
    if (!(error as any)?.quiet) {
      process.stderr.write(`Error: ${(error as Error).message}\n`);
    }
    if (error instanceof CliUsageError) {
      process.stderr.write(`Usage: mcp-excalidraw-server ${command.usage}\n`);
    }
    process.exitCode = exitCodeFor(error);
  }
}
