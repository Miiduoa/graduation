export function matchesCampusContent(query: string, fields: Array<string | undefined>): boolean {
  const normalize = (value: string) => value.normalize('NFKC').toLocaleLowerCase('zh-TW');
  const terms = normalize(query).trim().split(/\s+/).filter(Boolean);
  if (!terms.length) return true;
  const content = normalize(fields.filter(Boolean).join(' '));
  return terms.every((term) => content.includes(term));
}
