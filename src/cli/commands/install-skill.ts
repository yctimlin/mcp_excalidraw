import fs from 'fs';
import path from 'path';
import os from 'os';
import { fileURLToPath } from 'url';
import { parseArgs, CliUsageError } from '../args.js';
import { printJson, note } from '../util.js';

const SKILL_NAME = 'excalidraw-skill';

// The published package layout is <root>/{dist,skills,...}; this module
// compiles to dist/cli/commands/, so the package root is three levels up.
// Resolving relative to the module path keeps this working from the npx
// cache and global installs alike.
function findSkillSource(): string {
  const packageRoot = fileURLToPath(new URL('../../..', import.meta.url));
  const source = path.join(packageRoot, 'skills', SKILL_NAME);
  if (!fs.existsSync(path.join(source, 'SKILL.md'))) {
    throw new Error(`Bundled skill not found at ${source} (broken install?)`);
  }
  return source;
}

function expandHome(input: string): string {
  if (input === '~') return os.homedir();
  if (input.startsWith(`~${path.sep}`)) return path.join(os.homedir(), input.slice(2));
  return input;
}

function resolveSkillsRoot(target: string): string {
  if (target === 'claude') return path.join(os.homedir(), '.claude', 'skills');
  if (target === 'codex') return path.join(os.homedir(), '.codex', 'skills');
  return path.resolve(expandHome(target));
}

function resolveTarget(target: string): { root: string; target: string; mode: string } {
  const root = resolveSkillsRoot(target);
  return { root, target: path.join(root, SKILL_NAME), mode: `target:${target}` };
}

function countFiles(dir: string): number {
  let count = 0;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) count += countFiles(path.join(dir, entry.name));
    else count++;
  }
  return count;
}

export async function installSkill(argv: string[]): Promise<void> {
  const { flags } = parseArgs(argv, {
    dir: { takesValue: true },
    target: { takesValue: true },
    'print-source': { takesValue: false }
  });
  const source = findSkillSource();

  if (flags['print-source'] === true) {
    printJson({
      success: true,
      skill: SKILL_NAME,
      source,
      files: countFiles(source)
    });
    return;
  }

  if (flags.dir !== undefined && flags.target !== undefined) {
    throw new CliUsageError('Use either --dir <skills-root> or --target <alias|skills-root>, not both');
  }

  const explicitDir = flags.dir as string | undefined;
  const targetSpec = (flags.target as string | undefined) ?? 'claude';
  const explicitRoot = explicitDir ? path.resolve(expandHome(explicitDir)) : undefined;
  const resolved = explicitRoot
    ? { root: explicitRoot, target: path.join(explicitRoot, SKILL_NAME), mode: 'dir' }
    : resolveTarget(targetSpec);
  const { root, target, mode } = resolved;

  // Replace, never overlay: stale files from older skill versions (e.g. the
  // pre-1.1 scripts/*.cjs helpers) must not survive an upgrade.
  let lstat: fs.Stats | undefined;
  try {
    lstat = fs.lstatSync(target);
  } catch { /* target does not exist yet */ }

  if (lstat?.isSymbolicLink()) {
    throw new Error(
      `${target} is a symlink; refusing to replace it. Remove it manually if you want the CLI to manage this install.`
    );
  }

  // Stage into a sibling temp dir, then swap
  fs.mkdirSync(root, { recursive: true });
  const staging = fs.mkdtempSync(path.join(root, `.${SKILL_NAME}-staging-`));

  try {
    fs.cpSync(source, staging, { recursive: true });
    if (lstat) {
      fs.rmSync(target, { recursive: true, force: true });
      note(`Replaced existing install at ${target}`);
    }
    fs.renameSync(staging, target);
  } catch (error) {
    fs.rmSync(staging, { recursive: true, force: true });
    throw error;
  }

  printJson({
    success: true,
    skill: SKILL_NAME,
    mode,
    root,
    target,
    files: countFiles(target)
  });
}
