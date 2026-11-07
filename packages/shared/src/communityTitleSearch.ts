/** Shared literal-title contract for web and native history search. */
export const TITLE_SEARCH_PAGE_SIZE = 20;
export type TitleSearchPost = {
  id: string;
  schoolId: string;
  title: string;
  excerpt: string;
  anonymous: boolean;
};

export const invalidTitleSearch = () => Object.assign(
  new Error('請輸入 1 至 80 字的標題開頭。'), { code: 'invalid-argument' },
);

/** Preserve the stored title's case and Unicode form; only trim outside whitespace. */
export function parseTitlePrefix(value: string): string {
  if (typeof value !== 'string') throw invalidTitleSearch();
  const prefix = value.trim();
  const characters = Array.from(prefix);
  if (!characters.length || characters.length > 80 || characters.some((character) => {
    const code = character.codePointAt(0)!;
    return code < 32 || code === 127 || (code >= 0xd800 && code <= 0xdfff);
  })) throw invalidTitleSearch();
  return prefix;
}

/** Exclusive scalar successor; prefix + U+F8FF would omit emoji suffixes. */
export function titlePrefixUpperBound(prefix: string): string | null {
  const characters = Array.from(prefix);
  for (let index = characters.length - 1; index >= 0; index -= 1) {
    const code = characters[index].codePointAt(0)!;
    if (code === 0x10ffff) continue;
    const next = code === 0xd7ff ? 0xe000 : code + 1;
    return characters.slice(0, index).join('') + String.fromCodePoint(next);
  }
  return null;
}

/** A UI model, not a Firestore field projection or an authorization boundary. */
export function titleSearchPost(
  id: string, data: Record<string, unknown>, schoolId: string, prefix: string,
): TitleSearchPost | null {
  if (data.schoolId !== schoolId || typeof data.title !== 'string' ||
      !data.title.startsWith(prefix)) return null;
  return {
    id, schoolId, title: data.title,
    excerpt: typeof data.content === 'string' ? Array.from(data.content).slice(0, 160).join('') : '',
    anonymous: data.anonymous === true,
  };
}
