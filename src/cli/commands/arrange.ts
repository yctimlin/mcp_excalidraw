import { parseArgs, CliUsageError } from '../args.js';
import { printJson } from '../util.js';
import { ensureCanvasRunning } from '../../core/spawn.js';
import {
  alignElements,
  distributeElements,
  setElementsLocked,
  groupElements,
  ungroupElements,
  duplicateElements,
  Alignment,
  Direction
} from '../../core/geometry.js';

const ALIGNMENTS = new Set(['left', 'center', 'right', 'top', 'middle', 'bottom']);
const DIRECTIONS = new Set(['horizontal', 'vertical']);

function parseIds(value: unknown, usage: string): string[] {
  if (typeof value !== 'string' || !value.trim()) {
    throw new CliUsageError(usage);
  }
  return value.split(',').map(s => s.trim()).filter(Boolean);
}

export async function arrange(argv: string[]): Promise<void> {
  const { positionals, flags } = parseArgs(argv, {
    ids: { takesValue: true },
    to: { takesValue: true },
    group: { takesValue: true },
    offset: { takesValue: true }
  });

  const op = positionals[0];
  await ensureCanvasRunning();

  switch (op) {
    case 'align': {
      const ids = parseIds(flags.ids, 'Usage: arrange align --ids a,b,c --to left|center|right|top|middle|bottom');
      const to = flags.to as string | undefined;
      if (!to || !ALIGNMENTS.has(to)) {
        throw new CliUsageError('arrange align requires --to left|center|right|top|middle|bottom');
      }
      printJson(await alignElements(ids, to as Alignment));
      return;
    }
    case 'distribute': {
      const ids = parseIds(flags.ids, 'Usage: arrange distribute --ids a,b,c --to horizontal|vertical');
      const to = flags.to as string | undefined;
      if (!to || !DIRECTIONS.has(to)) {
        throw new CliUsageError('arrange distribute requires --to horizontal|vertical');
      }
      printJson(await distributeElements(ids, to as Direction));
      return;
    }
    case 'group': {
      const ids = parseIds(flags.ids, 'Usage: arrange group --ids a,b,c');
      printJson(await groupElements(ids));
      return;
    }
    case 'ungroup': {
      const groupId = flags.group as string | undefined;
      if (!groupId) throw new CliUsageError('Usage: arrange ungroup --group <groupId>');
      printJson(await ungroupElements(groupId));
      return;
    }
    case 'lock':
    case 'unlock': {
      const locked = op === 'lock';
      const ids = parseIds(flags.ids, `Usage: arrange ${op} --ids a,b,c`);
      const result = await setElementsLocked(ids, locked);
      printJson({ [locked ? 'locked' : 'unlocked']: true, ...result });
      return;
    }
    case 'duplicate': {
      const ids = parseIds(flags.ids, 'Usage: arrange duplicate --ids a,b,c [--offset 20,20]');
      let offsetX = 20, offsetY = 20;
      if (typeof flags.offset === 'string') {
        const parts = flags.offset.split(',').map(s => Number(s.trim()));
        if (parts.length !== 2 || parts.some(Number.isNaN)) {
          throw new CliUsageError('--offset expects "x,y"');
        }
        [offsetX, offsetY] = parts as [number, number];
      }
      const result = await duplicateElements(ids, offsetX, offsetY);
      printJson({
        success: true,
        count: result.duplicates.length,
        offsetX: result.offsetX,
        offsetY: result.offsetY,
        elements: result.canvasElements
      });
      return;
    }
    default:
      throw new CliUsageError('Usage: arrange align|distribute|group|ungroup|lock|unlock|duplicate ...');
  }
}
