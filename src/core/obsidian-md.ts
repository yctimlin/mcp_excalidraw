// Obsidian Excalidraw plugin file format (.excalidraw.md).
//
// The Obsidian Excalidraw plugin opens raw .excalidraw JSON only in a limited
// "compatibility mode" ("Convert to new format for full plugin functionality").
// Its native format is markdown: frontmatter, a "# Excalidraw Data" section
// whose "## Text Elements" entries expose each text element as an Obsidian
// block reference, and the scene JSON in a "## Drawing" code block — either
// plain ```json or lz-string ```compressed-json (the plugin's default).
//
// wrap mirrors the plugin's own id semantics (ExcalidrawData.
// findNewTextElementsInScene): a text element's block id IS its element id,
// and ids longer than 8 characters are renamed to a fresh 8-char id with
// every scene reference rewired — so files we write and files the plugin
// re-saves stay block-reference-compatible.

const ID_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
const BLOCK_ID_RE = /^[A-Za-z0-9_-]{1,8}$/;

export function isObsidianExcalidrawMd(content: string): boolean {
  // Raw scene JSON always starts with { or [ — never treat it as markdown,
  // even when a text element happens to contain the marker strings.
  const head = content.trimStart();
  if (head.startsWith('{') || head.startsWith('[')) return false;
  return content.includes('# Excalidraw Data') || /^---[\s\S]*?excalidraw-plugin:/m.test(content);
}

function nanoid8(used: Set<string>): string {
  let id: string;
  do {
    id = Array.from(
      { length: 8 },
      () => ID_ALPHABET[Math.floor(Math.random() * ID_ALPHABET.length)]
    ).join('');
  } while (used.has(id));
  return id;
}

function renameElementId(elements: any[], oldId: string, newId: string): void {
  for (const el of elements) {
    if (el.id === oldId) el.id = newId;
    if (Array.isArray(el.boundElements)) {
      for (const bound of el.boundElements) {
        if (bound.id === oldId) bound.id = newId;
      }
    }
    if (el.startBinding?.elementId === oldId) el.startBinding.elementId = newId;
    if (el.endBinding?.elementId === oldId) el.endBinding.elementId = newId;
    if (el.containerId === oldId) el.containerId = newId;
  }
}

export function wrapSceneAsObsidianMd(scene: Record<string, any>): string {
  if (!Array.isArray(scene.elements)) {
    throw new Error('Not an Excalidraw scene: missing elements array');
  }
  const wrapped = structuredClone(scene);
  wrapped.type = 'excalidraw';
  wrapped.version = 2;
  wrapped.files = wrapped.files ?? {};

  const used = new Set<string>(wrapped.elements.map((el: any) => el.id));
  const entries: string[] = [];
  for (const el of wrapped.elements) {
    if (el.type !== 'text' || el.isDeleted) continue;
    if (!BLOCK_ID_RE.test(el.id)) {
      const newId = nanoid8(used);
      used.add(newId);
      renameElementId(wrapped.elements, el.id, newId);
    }
    el.rawText = el.rawText && el.rawText !== '' ? el.rawText : (el.originalText ?? el.text ?? '');
    if (el.rawText !== '') entries.push(`${el.rawText} ^${el.id}`);
  }

  const textSection = entries.length ? entries.join('\n\n') + '\n' : '';
  return `---

excalidraw-plugin: parsed
tags: [excalidraw]

---
==⚠  Switch to EXCALIDRAW VIEW in the MORE OPTIONS menu of this document. ⚠==


# Excalidraw Data
## Text Elements
${textSection}
%%
## Drawing
\`\`\`json
${JSON.stringify(wrapped, null, '\t')}
\`\`\`
%%`;
}

export function extractSceneJsonFromObsidianMd(md: string): string {
  // The closing fence must sit at the start of a line: element text can
  // contain ``` inside the JSON strings, but a line of pretty-printed JSON
  // never begins with a backtick (this mirrors the plugin's own DRAWING_REG).
  const compressed = md.match(/\n##? Drawing\n[^`]*```compressed-json\n([\s\S]*?)\n```/);
  if (compressed) {
    const json = decompressFromBase64(compressed[1]!.replace(/\s/g, ''));
    if (!json) throw new Error('Failed to decompress the Drawing block');
    JSON.parse(json);
    return json;
  }
  const plain = md.match(/\n##? Drawing\n[^`]*```json\n([\s\S]*?)\n```/);
  if (plain) {
    JSON.parse(plain[1]!);
    return plain[1]!;
  }
  throw new Error('No Drawing block found — not an .excalidraw.md file?');
}

// lz-string decompressFromBase64 (pieroxy/lz-string, MIT), inlined to keep
// the package dependency-free.
const keyStrBase64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/=';
const f = String.fromCharCode;

function decompressFromBase64(input: string): string | null {
  if (input === '') return null;
  return _decompress(input.length, 32, (index) => keyStrBase64.indexOf(input.charAt(index)));
}

function _decompress(
  length: number,
  resetValue: number,
  getNextValue: (index: number) => number
): string | null {
  const dictionary: (string | number)[] = [];
  let enlargeIn = 4;
  let dictSize = 4;
  let numBits = 3;
  let entry: string;
  let w: string;
  let c: number;
  const result: string[] = [];
  const data = { val: getNextValue(0), position: resetValue, index: 1 };

  const readBits = (n: number): number => {
    let bits = 0;
    const maxpower = Math.pow(2, n);
    let power = 1;
    while (power !== maxpower) {
      const resb = data.val & data.position;
      data.position >>= 1;
      if (data.position === 0) {
        data.position = resetValue;
        data.val = getNextValue(data.index++);
      }
      bits |= (resb > 0 ? 1 : 0) * power;
      power <<= 1;
    }
    return bits;
  };

  for (let i = 0; i < 3; i += 1) dictionary[i] = i;

  let first: string;
  switch (readBits(2)) {
    case 0:
      first = f(readBits(8));
      break;
    case 1:
      first = f(readBits(16));
      break;
    default:
      return '';
  }
  dictionary[3] = first;
  w = first;
  result.push(first);
  while (true) {
    if (data.index > length) return '';
    switch ((c = readBits(numBits))) {
      case 0:
        dictionary[dictSize++] = f(readBits(8));
        c = dictSize - 1;
        enlargeIn--;
        break;
      case 1:
        dictionary[dictSize++] = f(readBits(16));
        c = dictSize - 1;
        enlargeIn--;
        break;
      case 2:
        return result.join('');
    }
    if (enlargeIn === 0) {
      enlargeIn = Math.pow(2, numBits);
      numBits++;
    }
    if (dictionary[c] !== undefined) {
      entry = dictionary[c] as string;
    } else if (c === dictSize) {
      entry = w + w.charAt(0);
    } else {
      return null;
    }
    result.push(entry);
    dictionary[dictSize++] = w + entry.charAt(0);
    enlargeIn--;
    w = entry;
    if (enlargeIn === 0) {
      enlargeIn = Math.pow(2, numBits);
      numBits++;
    }
  }
}
