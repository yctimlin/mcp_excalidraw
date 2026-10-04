import { CliUsageError } from './args.js';
import type { ExportImageOptions, ImageRenderer } from '../types.js';

// Flags shared by `screenshot` (live canvas) and `render` (a scene file).

export const IMAGE_FLAG_SPEC = {
  out: { takesValue: true },
  format: { takesValue: true },
  'no-background': { takesValue: false },
  renderer: { takesValue: true },
  dark: { takesValue: false },
  scale: { takesValue: true },
  padding: { takesValue: true },
  ids: { takesValue: true },
  frame: { takesValue: true },
  'no-embed-fonts': { takesValue: false }
} as const;

export const IMAGE_FLAG_USAGE =
  '[--format png|svg] [--no-background] [--dark] [--scale N] [--padding N] [--ids a,b,c] [--frame <id>] [--no-embed-fonts]';

type Flags = Record<string, string | boolean | string[] | undefined>;

// Repeatable flags arrive as arrays; the last occurrence wins here.
function scalar(value: string | boolean | string[] | undefined): string | boolean | undefined {
  return Array.isArray(value) ? value[value.length - 1] : value;
}

function numberFlag(flags: Flags, name: string): number | undefined {
  const raw = scalar(flags[name]);
  if (raw === undefined) return undefined;
  const value = Number(raw);
  if (!Number.isFinite(value)) throw new CliUsageError(`--${name} must be a number`);
  return value;
}

export function imageFormatFromFlags(flags: Flags, fallback: 'png' | 'svg' = 'png'): 'png' | 'svg' {
  const out = scalar(flags.out);
  const format = scalar(flags.format) ?? (typeof out === 'string' && out.toLowerCase().endsWith('.svg') ? 'svg' : fallback);
  if (format !== 'png' && format !== 'svg') throw new CliUsageError('--format must be png or svg');
  return format;
}

export function imageRendererFromFlags(flags: Flags): ImageRenderer {
  const renderer = scalar(flags.renderer) ?? 'auto';
  if (renderer !== 'auto' && renderer !== 'node' && renderer !== 'browser') {
    throw new CliUsageError('--renderer must be auto, node or browser');
  }
  return renderer;
}

export function imageOptionsFromFlags(flags: Flags, format: 'png' | 'svg'): ExportImageOptions {
  const idsRaw = scalar(flags.ids);
  const ids = typeof idsRaw === 'string'
    ? idsRaw.split(',').map(s => s.trim()).filter(Boolean)
    : undefined;
  if (ids && ids.length === 0) throw new CliUsageError('--ids needs at least one element id');
  const frameRaw = scalar(flags.frame);
  const frame = typeof frameRaw === 'string' ? frameRaw : undefined;
  if (ids && frame) throw new CliUsageError('--ids and --frame are mutually exclusive');

  return {
    format,
    background: !flags['no-background'],
    renderer: imageRendererFromFlags(flags),
    ...(flags.dark ? { dark: true } : {}),
    ...(numberFlag(flags, 'scale') !== undefined ? { scale: numberFlag(flags, 'scale') } : {}),
    ...(numberFlag(flags, 'padding') !== undefined ? { padding: numberFlag(flags, 'padding') } : {}),
    ...(ids ? { elementIds: ids } : {}),
    ...(frame ? { frameId: frame } : {}),
    ...(flags['no-embed-fonts'] ? { embedFonts: false } : {})
  };
}
