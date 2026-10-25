/** RFC 5545 TEXT values use escaped newlines and cannot contain control bytes. */
export function escapeIcsText(value: string): string {
  return value
    // eslint-disable-next-line no-control-regex -- Calendar text must not inject content lines.
    .replace(/[\u0000-\u0009\u000b-\u000c\u000e-\u001f\u007f]/g, '')
    .replace(/\\/g, '\\\\')
    .replace(/\r\n|\r|\n/g, '\\n')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,');
}

/** Fold at 75 UTF-8 octets without splitting a Unicode character. */
export function foldIcsLine(value: string): string {
  const lines: string[] = [];
  let current = '';
  let bytes = 0;
  for (const character of value) {
    const code = character.codePointAt(0)!;
    const size = code <= 0x7f ? 1 : code <= 0x7ff ? 2 : code <= 0xffff ? 3 : 4;
    if (bytes + size > 75) {
      lines.push(current);
      current = ' ' + character;
      bytes = 1 + size;
    } else {
      current += character;
      bytes += size;
    }
  }
  lines.push(current);
  return lines.join('\r\n');
}

export function utcIcsStamp(date: Date): string {
  return date.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
}
