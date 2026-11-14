export type CourseMaterialTextPart = { text: string; href?: string };

const closingBrackets: Record<string, string> = {
  ')': '(',
  ']': '[',
  '}': '{',
  '）': '（',
  '〉': '〈',
  '》': '《',
  '」': '「',
  '』': '『',
  '】': '【',
};

function trimTrailingPunctuation(value: string): string {
  // Balanced brackets belong to the URL; only excess closing brackets are prose.
  const balance: Record<string, number> = {};
  for (const [close, open] of Object.entries(closingBrackets)) {
    balance[close] = 0;
    for (const char of value) {
      if (char === close) balance[close]++;
      if (char === open) balance[close]--;
    }
  }
  let end = value.length;
  while (end > 0) {
    const char = value[end - 1];
    if (/[。，、；：！？,.;!?]/u.test(char)) {
      end--;
    } else if (closingBrackets[char] && balance[char] > 0) {
      balance[char]--;
      end--;
    } else {
      break;
    }
  }
  return value.slice(0, end);
}

// Keep reading links identical on web and native, including punctuation in Chinese prose.
export function courseMaterialTextParts(text: string): CourseMaterialTextPart[] {
  const parts: CourseMaterialTextPart[] = [];
  let offset = 0;
  for (const match of text.matchAll(/https?:\/\/[^\s<>"']+/gi)) {
    const start = match.index!;
    const candidate = trimTrailingPunctuation(match[0]);
    parts.push({ text: text.slice(offset, start) });
    let href: string | undefined;
    try {
      const url = new URL(candidate);
      if (['http:', 'https:'].includes(url.protocol) && !url.username && !url.password) {
        href = url.href;
      }
    } catch {
      // Invalid URLs remain readable text.
    }
    parts.push({ text: candidate, href });
    parts.push({ text: match[0].slice(candidate.length) });
    offset = start + match[0].length;
  }
  parts.push({ text: text.slice(offset) });
  return parts;
}
