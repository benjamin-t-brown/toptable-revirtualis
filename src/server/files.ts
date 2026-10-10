const MAX_UPLOAD = 8 * 1024 * 1024;

export function maxUploadBytes(): number {
  return MAX_UPLOAD;
}

function startsWith(buf: Buffer, bytes: number[]): boolean {
  if (buf.length < bytes.length) return false;
  return bytes.every((byte, index) => buf[index] === byte);
}

function ascii(buf: Buffer, start: number, text: string): boolean {
  return buf.toString('ascii', start, start + text.length) === text;
}

function detect(buf: Buffer): string | null {
  if (startsWith(buf, [0xff, 0xd8, 0xff])) return 'image/jpeg';
  if (startsWith(buf, [0x89, 0x50, 0x4e, 0x47])) return 'image/png';
  if (startsWith(buf, [0x47, 0x49, 0x46, 0x38])) return 'image/gif';
  if (ascii(buf, 0, 'RIFF') && ascii(buf, 8, 'WEBP')) return 'image/webp';
  if (ascii(buf, 0, 'RIFF') && ascii(buf, 8, 'WAVE')) return 'audio/wav';
  if (ascii(buf, 0, 'OggS')) return 'audio/ogg';
  if (ascii(buf, 0, 'ID3')) return 'audio/mpeg';
  if (buf.length >= 2 && buf[0] === 0xff && ((buf[1] ?? 0) & 0xe0) === 0xe0) return 'audio/mpeg';
  return null;
}

function normalizeDeclared(mime: string): string {
  const lower = mime.toLowerCase().split(';')[0]?.trim() ?? '';
  if (lower === 'image/jpg' || lower === 'image/pjpeg') return 'image/jpeg';
  if (lower === 'audio/mp3' || lower === 'audio/mpeg3') return 'audio/mpeg';
  if (lower === 'audio/wave' || lower === 'audio/x-wav') return 'audio/wav';
  if (lower === 'audio/x-ogg' || lower === 'application/ogg') return 'audio/ogg';
  return lower;
}

export function sniff(buf: Buffer, declared: string): string | null {
  if (buf.length === 0 || buf.length > MAX_UPLOAD) return null;
  const detected = detect(buf);
  if (!detected) return null;
  if (normalizeDeclared(declared) !== detected) return null;
  return detected;
}

export function sniffImage(buf: Buffer): string | null {
  if (buf.length === 0 || buf.length > MAX_UPLOAD) return null;
  const detected = detect(buf);
  if (detected === 'image/jpeg' || detected === 'image/png' || detected === 'image/gif' || detected === 'image/webp') {
    return detected;
  }
  return null;
}
