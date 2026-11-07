/**
 * Search is deliberately limited to already-loaded, public feed fields.
 * A blank-separated query requires every term to appear, in any field/order.
 * Width folding is explicit so the behavior is consistent in Web and Hermes.
 */
function foldSearchWidth(text: string): string {
  return text
    .replace(/[\uFF01-\uFF5E]/g, (char) => String.fromCharCode(char.charCodeAt(0) - 0xFEE0))
    .replace(/\u3000/g, ' ')
    .toLowerCase();
}

export function campusFeedSearchTerms(search: string): string[] {
  const normalized = foldSearchWidth(search).trim();
  return normalized ? normalized.split(/\s+/u) : [];
}

export function matchesCampusFeedSearchTerms(
  terms: readonly string[],
  publicFields: readonly unknown[],
): boolean {
  if (terms.length === 0) return true;
  const text = foldSearchWidth(publicFields.filter((item): item is string => typeof item === 'string').join(' '));
  return terms.every((term) => text.includes(term));
}
