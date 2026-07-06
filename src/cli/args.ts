// Minimal zero-dependency flag parser for the CLI.
//
// Supports: --flag value, --flag=value, boolean flags, and repeatable flags
// (declared via `repeatable`), plus positional arguments.

export class CliUsageError extends Error {
  readonly exitCode = 2;
}

export interface FlagSpec {
  // true when the flag consumes a value; false = boolean switch
  takesValue: boolean;
  // collect repeated occurrences into an array (e.g. --filter k=v --filter k2=v2)
  repeatable?: boolean;
}

export interface ParsedArgs {
  positionals: string[];
  flags: Record<string, string | boolean | string[]>;
}

export function parseArgs(argv: string[], spec: Record<string, FlagSpec>): ParsedArgs {
  const positionals: string[] = [];
  const flags: Record<string, string | boolean | string[]> = {};

  for (let i = 0; i < argv.length; i++) {
    const token = argv[i]!;

    if (!token.startsWith('--')) {
      positionals.push(token);
      continue;
    }

    let name = token.slice(2);
    let inlineValue: string | undefined;
    const eq = name.indexOf('=');
    if (eq !== -1) {
      inlineValue = name.slice(eq + 1);
      name = name.slice(0, eq);
    }

    const flagSpec = spec[name];
    if (!flagSpec) {
      throw new CliUsageError(`Unknown flag --${name}`);
    }

    let value: string | boolean;
    if (flagSpec.takesValue) {
      if (inlineValue !== undefined) {
        value = inlineValue;
      } else {
        const next = argv[i + 1];
        if (next === undefined) {
          throw new CliUsageError(`Flag --${name} requires a value`);
        }
        value = next;
        i++;
      }
    } else {
      if (inlineValue !== undefined) {
        throw new CliUsageError(`Flag --${name} does not take a value`);
      }
      value = true;
    }

    if (flagSpec.repeatable) {
      const existing = flags[name];
      if (Array.isArray(existing)) {
        existing.push(value as string);
      } else {
        flags[name] = [value as string];
      }
    } else {
      flags[name] = value;
    }
  }

  return { positionals, flags };
}

// Read all of stdin (for `add`, `import`, `mermaid`, ... piped input)
export async function readStdin(): Promise<string> {
  if (process.stdin.isTTY) {
    throw new CliUsageError('No stdin provided (pass a file argument or pipe input to stdin)');
  }

  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(chunk as Buffer);
  }
  return Buffer.concat(chunks).toString('utf-8');
}
