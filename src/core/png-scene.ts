import { deflateSync, inflateSync } from 'node:zlib';

const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
const SCENE_KEYWORD = Buffer.from('application/vnd.excalidraw+json\0', 'latin1');
// Match the canvas server's 10mb JSON request limit and bound inflation itself.
const MAX_SCENE_BYTES = 10 * 1024 * 1024;
// Allow worst-case JSON byte escaping, plus zlib framing/block overhead.
const MAX_METADATA_BYTES = MAX_SCENE_BYTES * 6 + 64 * 1024;

const CRC_TABLE = new Uint32Array(256);
for (let byte = 0; byte < CRC_TABLE.length; byte++) {
  let crc = byte;
  for (let bit = 0; bit < 8; bit++) {
    crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
  }
  CRC_TABLE[byte] = crc >>> 0;
}

interface PngChunk {
  type: string;
  start: number;
  end: number;
}

function crc32(data: Buffer, start: number, end: number): number {
  let crc = 0xffffffff;
  for (let index = start; index < end; index++) {
    crc = CRC_TABLE[(crc ^ data[index]!) & 0xff]! ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

export function isPng(data: Buffer): boolean {
  return data.length >= PNG_SIGNATURE.length
    && data.compare(PNG_SIGNATURE, 0, PNG_SIGNATURE.length, 0, PNG_SIGNATURE.length) === 0;
}

function parseChunks(png: Buffer): PngChunk[] {
  if (!isPng(png)) throw new Error('Invalid PNG signature');

  const chunks: PngChunk[] = [];
  let hasImageData = false;
  let start = PNG_SIGNATURE.length;
  while (start < png.length) {
    if (png.length - start < 12) throw new Error('Truncated PNG chunk');
    const length = png.readUInt32BE(start);
    if (length > 0x7fffffff) throw new Error('Invalid PNG chunk length');
    if (length > png.length - start - 12) throw new Error('Truncated PNG chunk data');
    const end = start + length + 12;
    const type = png.toString('latin1', start + 4, start + 8);
    if (!/^[A-Za-z]{4}$/.test(type)) throw new Error('Invalid PNG chunk type');
    if (crc32(png, start + 4, end - 4) !== png.readUInt32BE(end - 4)) {
      throw new Error(`Invalid PNG CRC for ${type} chunk`);
    }
    if (chunks.length === 0 && (type !== 'IHDR' || length !== 13)) {
      throw new Error('Invalid PNG: expected a 13-byte IHDR chunk first');
    }
    if (chunks.length > 0 && type === 'IHDR') throw new Error('Invalid PNG: duplicate IHDR chunk');
    if (type === 'IDAT') hasImageData = true;
    if (type === 'tEXt') {
      const text = png.subarray(start + 8, end - 4);
      const separator = text.indexOf(0);
      if (separator < 1 || separator > 79 || text.indexOf(0, separator + 1) !== -1) {
        throw new Error('Malformed PNG tEXt chunk');
      }
    }
    chunks.push({ type, start, end });
    if (type === 'IEND') {
      if (length !== 0) throw new Error('Invalid PNG: IEND chunk must be empty');
      if (!hasImageData) throw new Error('Invalid PNG: missing IDAT chunk');
      if (end !== png.length) throw new Error('Invalid PNG: data after IEND chunk');
      return chunks;
    }
    start = end;
  }
  throw new Error('Truncated PNG: missing IEND chunk');
}

function isSceneChunk(png: Buffer, chunk: PngChunk): boolean {
  return chunk.type === 'tEXt'
    && chunk.end - chunk.start - 12 >= SCENE_KEYWORD.length
    && png.compare(SCENE_KEYWORD, 0, SCENE_KEYWORD.length,
      chunk.start + 8, chunk.start + 8 + SCENE_KEYWORD.length) === 0;
}

export function embedPngScene(png: Buffer, sceneJson: string): Buffer {
  if (Buffer.byteLength(sceneJson, 'utf8') > MAX_SCENE_BYTES) {
    throw new Error('Embedded Excalidraw scene exceeds the 10 MiB import limit');
  }
  const chunks = parseChunks(png);
  // Excalidraw 0.18.1 data/encode.ts uses a zlib-wrapped UTF-8 deflate stream
  // represented as a binary string, not base64 or raw DEFLATE.
  const envelope = JSON.stringify({
    version: '1',
    encoding: 'bstring',
    compressed: true,
    encoded: deflateSync(sceneJson).toString('latin1')
  });
  const length = SCENE_KEYWORD.length + envelope.length;
  const sceneChunk = Buffer.allocUnsafe(length + 12);
  sceneChunk.writeUInt32BE(length, 0);
  sceneChunk.write('tEXt', 4, 'ascii');
  SCENE_KEYWORD.copy(sceneChunk, 8);
  // JSON.stringify leaves high-byte binary-string characters unescaped.
  // PNG tEXt stores Latin-1: UTF-8 here would corrupt native scene decoding.
  sceneChunk.write(envelope, 8 + SCENE_KEYWORD.length, 'latin1');
  sceneChunk.writeUInt32BE(crc32(sceneChunk, 4, length + 8), length + 8);

  const parts: Buffer[] = [PNG_SIGNATURE];
  let inserted = false;
  for (const chunk of chunks) {
    // Native getTEXtChunk reads only the first tEXt, regardless of its keyword.
    if (!inserted && (chunk.type === 'tEXt' || chunk.type === 'IEND')) {
      parts.push(sceneChunk);
      inserted = true;
    }
    if (!isSceneChunk(png, chunk)) parts.push(png.subarray(chunk.start, chunk.end));
  }
  return Buffer.concat(parts);
}

export function extractPngScene(png: Buffer): string {
  const chunk = parseChunks(png).find(candidate => isSceneChunk(png, candidate));
  if (!chunk) throw new Error('PNG has no embedded Excalidraw scene metadata');

  const textStart = chunk.start + 8 + SCENE_KEYWORD.length;
  if (chunk.end - 4 - textStart > MAX_METADATA_BYTES) {
    throw new Error('Embedded Excalidraw metadata exceeds the import size limit');
  }
  const text = png.toString('latin1', textStart, chunk.end - 4);
  let envelope: unknown;
  try {
    envelope = JSON.parse(text);
  } catch (error) {
    throw new Error('Malformed embedded Excalidraw metadata JSON', { cause: error });
  }
  if (!envelope || typeof envelope !== 'object' || Array.isArray(envelope)) {
    throw new Error('Malformed embedded Excalidraw metadata envelope');
  }
  const data = envelope as Record<string, unknown>;
  if (!('encoded' in data)) {
    // Before the binary-string envelope, native exports stored scene JSON directly.
    if (data.type !== 'excalidraw') throw new Error('Malformed legacy Excalidraw scene metadata');
    if (Buffer.byteLength(text, 'utf8') > MAX_SCENE_BYTES) {
      throw new Error('Embedded Excalidraw scene exceeds the 10 MiB import limit');
    }
    return text;
  }
  if (data.version !== '1' || data.encoding !== 'bstring'
    || typeof data.compressed !== 'boolean' || typeof data.encoded !== 'string') {
    throw new Error('Malformed or unsupported embedded Excalidraw metadata envelope');
  }
  for (let index = 0; index < data.encoded.length; index++) {
    if (data.encoded.charCodeAt(index) > 255) {
      throw new Error('Malformed Excalidraw binary-string metadata');
    }
  }
  if (!data.compressed && data.encoded.length > MAX_SCENE_BYTES) {
    throw new Error('Embedded Excalidraw scene exceeds the 10 MiB import limit');
  }
  let scene: Buffer = Buffer.from(data.encoded, 'latin1');
  if (data.compressed) {
    try {
      scene = inflateSync(scene, { maxOutputLength: MAX_SCENE_BYTES });
    } catch (error) {
      if (error instanceof Error && 'code' in error && error.code === 'ERR_BUFFER_TOO_LARGE') {
        throw new Error('Embedded Excalidraw scene exceeds the 10 MiB import limit', { cause: error });
      }
      throw new Error('Invalid compressed Excalidraw scene metadata', { cause: error });
    }
  }
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(scene);
  } catch (error) {
    throw new Error('Invalid UTF-8 in embedded Excalidraw scene metadata', { cause: error });
  }
}
