#!/usr/bin/env node
// Sync the canonical skill (skills/excalidraw-skill) to the repo-local agent
// copy (.agents/skills/excalidraw-skill, which .claude/skills symlinks to).
//
// skills/ is the single source of truth: it is published to npm and installed
// by `mcp-excalidraw-server install-skill`. Edit there, then run:
//   npm run sync:skills

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const repoRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const canonical = path.join(repoRoot, 'skills', 'excalidraw-skill');
const agentCopy = path.join(repoRoot, '.agents', 'skills', 'excalidraw-skill');
const claudeLink = path.join(repoRoot, '.claude', 'skills', 'excalidraw-skill');

if (!fs.existsSync(path.join(canonical, 'SKILL.md'))) {
  console.error(`Canonical skill not found at ${canonical}`);
  process.exit(1);
}

// Replace (not overlay) so deleted files don't linger in the agent copy
fs.rmSync(agentCopy, { recursive: true, force: true });
fs.mkdirSync(path.dirname(agentCopy), { recursive: true });
fs.cpSync(canonical, agentCopy, { recursive: true });
console.log(`Synced ${canonical} -> ${agentCopy}`);

// Verify the .claude symlink still points into .agents
try {
  const linkTarget = fs.readlinkSync(claudeLink);
  const resolved = path.resolve(path.dirname(claudeLink), linkTarget);
  if (resolved !== agentCopy) {
    console.warn(`Warning: ${claudeLink} points to ${resolved}, expected ${agentCopy}`);
  } else {
    console.log(`Verified symlink ${claudeLink} -> ${linkTarget}`);
  }
} catch {
  console.warn(`Warning: ${claudeLink} is not a symlink (or missing); .claude may hold a stale copy.`);
}
