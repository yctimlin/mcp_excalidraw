import { z } from 'zod';

// Options accepted for Mermaid conversion (REST body, CLI via REST, MCP tool).
// Conversion is synchronous CPU work on the server's event loop, so the size
// limits can be lowered by callers but never raised past these ceilings.
export const MAX_MERMAID_EDGES = 1000;
export const MAX_MERMAID_TEXT_SIZE = 100_000;

const fontSize = z.string()
  .regex(/^\d+(\.\d+)?px$/, 'must be a pixel size like "20px"')
  .refine(value => {
    const px = parseFloat(value);
    return px >= 8 && px <= 72;
  }, 'must be between 8px and 72px');

export const MermaidConfigSchema = z.object({
  // Draw flowchart edges / state transitions as elbow arrows
  elbow: z.union([
    z.boolean(),
    z.object({ flowchart: z.boolean().optional(), state: z.boolean().optional() })
  ]).optional(),
  themeVariables: z.object({ fontSize: fontSize.optional() }).optional(),
  maxEdges: z.number().int().min(1).max(MAX_MERMAID_EDGES).optional(),
  maxTextSize: z.number().int().min(1).max(MAX_MERMAID_TEXT_SIZE).optional()
});

export type MermaidConversionConfig = z.infer<typeof MermaidConfigSchema>;

const KNOWN_KEYS = new Set(['elbow', 'themeVariables', 'maxEdges', 'maxTextSize']);
const KNOWN_THEME_KEYS = new Set(['fontSize']);

// Validate a config object. Unknown keys (including options of the old
// mermaid.js engine such as `startOnLoad` or `flowchart.curve`) are dropped, not
// fatal, and reported back so callers can see they had no effect. Throws a
// ZodError for invalid or out-of-range values.
export function parseMermaidConfig(input: unknown): { config?: MermaidConversionConfig; warnings: string[] } {
  if (input === undefined) return { warnings: [] };
  const config = MermaidConfigSchema.parse(input);
  const warnings: string[] = [];
  const raw = input as Record<string, unknown>;
  for (const key of Object.keys(raw)) {
    if (!KNOWN_KEYS.has(key)) warnings.push(`Ignored unsupported config key "${key}"`);
  }
  const theme = raw.themeVariables;
  if (theme && typeof theme === 'object') {
    for (const key of Object.keys(theme)) {
      if (!KNOWN_THEME_KEYS.has(key)) warnings.push(`Ignored unsupported config key "themeVariables.${key}"`);
    }
  }
  return { config, warnings };
}

export function describeConfigError(error: unknown): string {
  if (error instanceof z.ZodError) {
    return error.issues.map(issue => `${issue.path.join('.') || 'config'}: ${issue.message}`).join('; ');
  }
  return (error as Error).message;
}
