// Shared boundary for browser and server OSM JSON responses.
// RFC 8259 §8.1 requires UTF-8 for interoperable JSON. Keep older Overpass
// responses without a Content-Type, and ignore unrelated MIME parameters.
// An explicitly incompatible charset must not be treated as verified geometry.
export function isSupportedUtf8JsonMediaType(declared: string | null): boolean {
  if (declared === null) return true;
  // Semicolons inside quoted profile parameters do not start another
  // parameter; a plain split(';') could interpret fake charset text there.
  const fields: string[] = [];
  let field = '';
  let quoted = false;
  let escaped = false;
  for (const char of declared) {
    if (quoted && escaped) {
      escaped = false;
      field += char;
    } else if (quoted && char === '\\') {
      escaped = true;
      field += char;
    } else if (char === '"') {
      quoted = !quoted;
      field += char;
    } else if (char === ';' && !quoted) {
      fields.push(field.trim());
      field = '';
    } else {
      field += char;
    }
  }
  if (quoted) return false;
  fields.push(field.trim());
  if (!/^application\/(?:json|[a-z0-9!#$%&'*+.^_`|~-]+\+json)$/i.test(fields[0])) return false;
  for (const parameter of fields.slice(1)) {
    if (!/^charset(?=\s|=|$)/i.test(parameter)) continue;
    const match = /^charset\s*=\s*(?:"([^"]*)"|([a-z0-9_-]+))\s*$/i.exec(parameter);
    if (!match || (match[1] ?? match[2]).toLowerCase() !== 'utf-8') return false;
  }
  return true;
}
