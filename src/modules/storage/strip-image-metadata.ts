/**
 * Убирает метаданные изображений (EXIF/GPS и т.п.) перед сохранением референсов заявок.
 * Без sharp: режем известные контейнеры JPEG / PNG / WebP.
 */

function stripJpegExif(buf: Buffer): Buffer {
  if (buf.length < 4 || buf[0] !== 0xff || buf[1] !== 0xd8) return buf;
  const out: number[] = [0xff, 0xd8];
  let i = 2;
  while (i + 3 < buf.length) {
    if (buf[i] !== 0xff) break;
    const marker = buf[i + 1]!;
    // SOS / EOI — дальше сырые данные, копируем остаток
    if (marker === 0xda || marker === 0xd9) {
      out.push(...buf.subarray(i));
      return Buffer.from(out);
    }
    // Standalone markers without length
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      out.push(0xff, marker);
      i += 2;
      continue;
    }
    const len = buf.readUInt16BE(i + 2);
    if (len < 2 || i + 2 + len > buf.length) {
      out.push(...buf.subarray(i));
      return Buffer.from(out);
    }
    // APP1 (EXIF/XMP) — выкидываем (здесь GPS)
    if (marker !== 0xe1) {
      out.push(...buf.subarray(i, i + 2 + len));
    }
    i += 2 + len;
  }
  if (i < buf.length) out.push(...buf.subarray(i));
  return Buffer.from(out);
}

function stripPngExif(buf: Buffer): Buffer {
  if (buf.length < 8) return buf;
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  if (!buf.subarray(0, 8).equals(sig)) return buf;
  const parts: Buffer[] = [sig];
  let i = 8;
  while (i + 12 <= buf.length) {
    const dataLen = buf.readUInt32BE(i);
    const type = buf.subarray(i + 4, i + 8).toString('ascii');
    const chunkEnd = i + 12 + dataLen;
    if (chunkEnd > buf.length) break;
    if (type !== 'eXIf') {
      parts.push(buf.subarray(i, chunkEnd));
    }
    i = chunkEnd;
    if (type === 'IEND') break;
  }
  return Buffer.concat(parts);
}

function stripWebpExif(buf: Buffer): Buffer {
  if (buf.length < 12) return buf;
  if (buf.subarray(0, 4).toString('ascii') !== 'RIFF' || buf.subarray(8, 12).toString('ascii') !== 'WEBP') {
    return buf;
  }
  const chunks: Buffer[] = [];
  let i = 12;
  while (i + 8 <= buf.length) {
    const type = buf.subarray(i, i + 4).toString('ascii');
    const size = buf.readUInt32LE(i + 4);
    let chunkTotal = 8 + size;
    if (size % 2 === 1) chunkTotal += 1; // pad byte
    if (i + chunkTotal > buf.length) break;
    if (type !== 'EXIF') {
      chunks.push(buf.subarray(i, i + chunkTotal));
    }
    i += chunkTotal;
  }
  const body = Buffer.concat(chunks);
  const out = Buffer.alloc(12 + body.length);
  buf.copy(out, 0, 0, 12);
  out.writeUInt32LE(4 + body.length, 4); // RIFF size = 'WEBP' + chunks
  body.copy(out, 12);
  return out;
}

/** Возвращает буфер без EXIF/GPS; при неизвестном типе — исходный. */
export function stripImageMetadata(buffer: Buffer, mimeType: string): Buffer {
  const m = mimeType.toLowerCase().split(';')[0]!.trim();
  try {
    if (m === 'image/jpeg' || m === 'image/jpg') return stripJpegExif(buffer);
    if (m === 'image/png') return stripPngExif(buffer);
    if (m === 'image/webp') return stripWebpExif(buffer);
  } catch {
    /* оставляем оригинал */
  }
  return buffer;
}
