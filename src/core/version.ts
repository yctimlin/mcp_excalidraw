import fs from 'fs';
import { fileURLToPath } from 'url';

// Single source of truth for the package version (MCP server metadata,
// CLI --version): read package.json so it can never drift from npm again.
export function packageVersion(): string {
  try {
    const pkgPath = fileURLToPath(new URL('../../package.json', import.meta.url));
    return JSON.parse(fs.readFileSync(pkgPath, 'utf-8')).version;
  } catch {
    return 'unknown';
  }
}
