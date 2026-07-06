import { ServerElement } from '../types.js';

// Build an AI-readable description of the current canvas: element types,
// positions, connections, labels, spatial layout, and bounding box.
export function describeScene(allElements: ServerElement[]): string {
  if (allElements.length === 0) {
    return 'The canvas is empty. No elements to describe.';
  }

  // Count by type
  const typeCounts: Record<string, number> = {};
  for (const el of allElements) {
    typeCounts[el.type] = (typeCounts[el.type] || 0) + 1;
  }

  // Bounding box
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const el of allElements) {
    minX = Math.min(minX, el.x);
    minY = Math.min(minY, el.y);
    maxX = Math.max(maxX, el.x + (el.width || 0));
    maxY = Math.max(maxY, el.y + (el.height || 0));
  }

  // Build element descriptions sorted top-to-bottom, left-to-right
  const sorted = [...allElements].sort((a, b) => {
    const rowDiff = Math.floor(a.y / 50) - Math.floor(b.y / 50);
    return rowDiff !== 0 ? rowDiff : a.x - b.x;
  });

  const elementDescs: string[] = [];
  for (const el of sorted) {
    const parts: string[] = [];
    parts.push(`[${el.id}] ${el.type}`);
    parts.push(`at (${Math.round(el.x)}, ${Math.round(el.y)})`);
    if (el.width || el.height) {
      parts.push(`size ${Math.round(el.width || 0)}x${Math.round(el.height || 0)}`);
    }
    if (el.text) parts.push(`text: "${el.text}"`);
    if (el.label?.text) parts.push(`label: "${el.label.text}"`);
    if (el.backgroundColor && el.backgroundColor !== 'transparent') {
      parts.push(`bg: ${el.backgroundColor}`);
    }
    if (el.strokeColor && el.strokeColor !== '#000000') {
      parts.push(`stroke: ${el.strokeColor}`);
    }
    if (el.locked) parts.push('(locked)');
    if (el.groupIds && el.groupIds.length > 0) {
      parts.push(`groups: [${el.groupIds.join(', ')}]`);
    }
    elementDescs.push(`  ${parts.join(' | ')}`);
  }

  // Find connections (arrows)
  const arrows = allElements.filter(el => el.type === 'arrow');
  const connectionDescs: string[] = [];
  for (const arrow of arrows) {
    const arrowAny = arrow as any;
    if (arrowAny.startBinding?.elementId || arrowAny.endBinding?.elementId) {
      const from = arrowAny.startBinding?.elementId || '?';
      const to = arrowAny.endBinding?.elementId || '?';
      connectionDescs.push(`  ${from} --> ${to} (arrow: ${arrow.id})`);
    }
  }

  // Build description
  const lines: string[] = [];
  lines.push(`## Canvas Description`);
  lines.push(`Total elements: ${allElements.length}`);
  lines.push(`Types: ${Object.entries(typeCounts).map(([t, c]) => `${t}(${c})`).join(', ')}`);
  lines.push(`Bounding box: (${Math.round(minX)}, ${Math.round(minY)}) to (${Math.round(maxX)}, ${Math.round(maxY)}) = ${Math.round(maxX - minX)}x${Math.round(maxY - minY)}`);
  lines.push('');
  lines.push('### Elements (top-to-bottom, left-to-right):');
  lines.push(...elementDescs);

  if (connectionDescs.length > 0) {
    lines.push('');
    lines.push('### Connections:');
    lines.push(...connectionDescs);
  }

  // Groups
  const groupedElements = allElements.filter(el => el.groupIds && el.groupIds.length > 0);
  if (groupedElements.length > 0) {
    const groupMap: Record<string, string[]> = {};
    for (const el of groupedElements) {
      for (const gid of (el.groupIds || [])) {
        if (!groupMap[gid]) groupMap[gid] = [];
        groupMap[gid]!.push(el.id);
      }
    }
    lines.push('');
    lines.push('### Groups:');
    for (const [gid, ids] of Object.entries(groupMap)) {
      lines.push(`  Group ${gid}: [${ids.join(', ')}]`);
    }
  }

  return lines.join('\n');
}
