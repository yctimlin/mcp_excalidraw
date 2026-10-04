import { parseArgs, CliUsageError } from '../args.js';
import { printJson } from '../util.js';
import { ensureCanvasRunning } from '../../core/spawn.js';
import {
  saveSnapshot,
  listSnapshots,
  getSnapshot,
  replaceElementsStrict
} from '../../core/canvas-client.js';

export async function snapshot(argv: string[]): Promise<void> {
  const { positionals } = parseArgs(argv, {});
  const [action, name] = positionals;

  await ensureCanvasRunning();

  switch (action) {
    case 'save': {
      if (!name) throw new CliUsageError('Usage: snapshot save <name>');
      const result = await saveSnapshot(name);
      printJson({ success: true, name, elements: result.elementCount, createdAt: result.createdAt });
      return;
    }
    case 'list': {
      const result = await listSnapshots();
      printJson(result.snapshots ?? []);
      return;
    }
    case 'restore': {
      if (!name) throw new CliUsageError('Usage: snapshot restore <name>');
      let snap;
      try {
        snap = await getSnapshot(name);
      } catch {
        throw new Error(`Snapshot "${name}" not found`);
      }
      // One atomic replace: a snapshot the server rejects leaves the canvas as is
      await replaceElementsStrict(snap.elements);
      printJson({ success: true, name, restored: snap.elements.length });
      return;
    }
    default:
      throw new CliUsageError('Usage: snapshot save|list|restore [name]');
  }
}
