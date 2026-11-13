export type CourseMaterialTextPart = { text: string; href?: string };

// Keep reading links identical on web and native, including punctuation in Chinese prose.
export function courseMaterialTextParts(text: string): CourseMaterialTextPart[] {
  const parts: CourseMaterialTextPart[] = [];
  let offset = 0;
  for (const match of text.matchAll(/https?:\/\/[^\s<>"'。，、；：！？）〉》」』】]+/gi)) {
    const start = match.index!;
    const candidate = match[0].replace(/[。，、；：！？）〉》」』】,.;!?)]+$/u, '');
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
