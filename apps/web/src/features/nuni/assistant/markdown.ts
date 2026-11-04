import { formatDueInstant, isInternalPath } from './copy';
import type { DueItem } from './types';

export type Inline =
  | { type: 'text'; value: string }
  | { type: 'strong'; children: Inline[] }
  | { type: 'em'; children: Inline[] }
  | { type: 'code'; value: string }
  | { type: 'link'; href: string; label: string; path?: boolean };

export type Block =
  | { type: 'p'; children: Inline[] }
  | { type: 'h'; level: 1 | 2 | 3; children: Inline[] }
  | { type: 'ul'; items: { children: Inline[]; due?: DueItem }[] }
  | { type: 'ol'; items: { children: Inline[]; due?: DueItem }[] }
  | { type: 'quote'; children: Inline[] };

const PATH =
  /\/[a-z][a-z0-9-]*(?:\/[A-Za-z0-9._~-]*)*(?:\?[A-Za-z0-9._~+=&%/\-]{0,180})?(?:#[A-Za-z0-9._~-]{0,80})?/;

export function parseDueItem(raw: string): DueItem | null {
  const text = raw
    .replace(/^[-*・]+|\d+\.\s+/g, ' ')
    .replace(/[*_`]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!text) return null;
  const courseMatch = text.match(/[（(]([^）)]{1,40})[）)]/);
  const iso = text.match(/\d{4}-\d{2}-\d{2}T[0-9:.+Z-]+/);
  const ymd = text.match(/\d{4}-\d{2}-\d{2}(?:[ T][0-2]?\d[:：][0-5]\d)?/);
  const md = text.match(/(\d{1,2})[/／](\d{1,2})(?:日)?(?:\s*([0-2]?\d)[:：]([0-5]\d))?/);
  const homework = /作業|練習|測驗|考試|報告|截止|要交|due/i.test(text);
  let dueLabel = '';
  if (iso?.[0]) dueLabel = formatDueInstant(iso[0]);
  else if (ymd?.[0] && (homework || iso)) dueLabel = formatDueInstant(ymd[0].replace(' ', 'T'));
  else if (md && homework)
    dueLabel = formatDueInstant(
      `${md[1]}/${md[2]}${md[3] ? ` ${md[3]}:${md[4]}` : ''}`,
    );
  if (!dueLabel) return null;
  let title = text
    .replace(courseMatch?.[0] ?? '', ' ')
    .replace(iso?.[0] ?? '', ' ')
    .replace(/\d{4}-\d{2}-\d{2}(?:[T ][0-9:.+Z-]+)?/g, ' ')
    .replace(/(\d{1,2})[/／](\d{1,2})(?:日)?(?:\s*[0-2]?\d[:：][0-5]\d)?/g, ' ')
    .replace(/截止(?:時間)?|最急|要交|open|closed|submitted|pending|已查結果/gi, ' ')
    .replace(/[：:·•,，;；。！？]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  title = title.replace(/^(模擬|部分結果|寫作業|待繳作業|作業)[:：]?\s*/u, '').trim() || title;
  if (title.length < 2 || title.length > 80) return null;
  const course = courseMatch?.[1]?.trim();
  return { title, ...(course ? { course } : {}), dueLabel };
}

export function extractDueItems(answer: string): DueItem[] {
  const found: DueItem[] = [];
  const seen = new Set<string>();
  const push = (item: DueItem | null) => {
    if (!item || seen.has(item.title)) return;
    seen.add(item.title);
    found.push(item);
  };
  for (const line of answer.split(/\n+/)) {
    const body = line.replace(/^[-*・\d.]\s+/, '');
    if (/^[-*・]/.test(line) || /^\d+\./.test(line) || line.includes('・')) push(parseDueItem(body));
  }
  if (found.length) return found;
  for (const clause of answer.split(/[，；;\n]/)) push(parseDueItem(clause));
  return found;
}

function take(rest: string, pattern: RegExp): { match: RegExpMatchArray; at: number } | null {
  const match = rest.match(pattern);
  if (!match || match.index === undefined) return null;
  return { match, at: match.index };
}

export function parseInline(text: string): Inline[] {
  const out: Inline[] = [];
  let rest = text;
  while (rest) {
    const code = take(rest, /`([^`]+)`/);
    const mdLink = take(rest, /\[([^\]]+)\]\((\/[^)\s]+|https:\/\/[^)\s]+)\)/);
    const strong = take(rest, /\*\*([^*]+)\*\*|__([^_]+)__/);
    const em = take(rest, /(?<!\*)\*([^*]+)\*(?!\*)|(?<!_)_([^_]+)_(?!_)/);
    const path = take(
      rest,
      new RegExp('(?:^|[\\s（(「『、，。：:：])(' + PATH.source + ')(?=$|[\\s）)」』、，。！？])'),
    );
    const candidates = [
      code && { kind: 'code' as const, at: code.at, data: code },
      mdLink && { kind: 'link' as const, at: mdLink.at, data: mdLink },
      strong && { kind: 'strong' as const, at: strong.at, data: strong },
      em && { kind: 'em' as const, at: em.at, data: em },
      path && { kind: 'path' as const, at: path.at, data: path },
    ].filter((item): item is NonNullable<typeof item> => Boolean(item));
    const rank = { code: 0, link: 1, strong: 2, em: 3, path: 4 };
    candidates.sort((a, b) => a.at - b.at || rank[a.kind] - rank[b.kind]);
    const next = candidates[0];
    if (!next) {
      out.push({ type: 'text', value: rest });
      break;
    }
    if (next.at > 0) out.push({ type: 'text', value: rest.slice(0, next.at) });
    const m = next.data.match;
    if (next.kind === 'code') {
      out.push({ type: 'code', value: m[1] });
      rest = rest.slice(next.at + m[0].length);
      continue;
    }
    if (next.kind === 'link') {
      const href = m[2];
      if (isInternalPath(href)) out.push({ type: 'link', href, label: m[1], path: true });
      else out.push({ type: 'text', value: m[1] || href });
      rest = rest.slice(next.at + m[0].length);
      continue;
    }
    if (next.kind === 'strong') {
      out.push({ type: 'strong', children: parseInline(m[1] || m[2]) });
      rest = rest.slice(next.at + m[0].length);
      continue;
    }
    if (next.kind === 'em') {
      out.push({ type: 'em', children: parseInline(m[1] || m[2]) });
      rest = rest.slice(next.at + m[0].length);
      continue;
    }
    const full = m[0];
    const href = m[1];
    const prefix = full.startsWith(href) ? '' : full.slice(0, full.length - href.length);
    if (prefix) out.push({ type: 'text', value: prefix });
    if (isInternalPath(href)) out.push({ type: 'link', href, label: '', path: true });
    else out.push({ type: 'text', value: href });
    rest = rest.slice(next.at + full.length);
  }
  return mergeText(out);
}

function mergeText(items: Inline[]): Inline[] {
  const out: Inline[] = [];
  for (const item of items) {
    const last = out[out.length - 1];
    if (item.type === 'text' && last?.type === 'text') last.value += item.value;
    else out.push(item);
  }
  return out;
}

export function parseBlocks(source: string): Block[] {
  const lines = source.replace(/\r\n/g, '\n').split('\n');
  const blocks: Block[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) {
      i += 1;
      continue;
    }
    const heading = /^(#{1,3})\s+(.+)$/.exec(line);
    if (heading) {
      blocks.push({
        type: 'h',
        level: heading[1].length as 1 | 2 | 3,
        children: parseInline(heading[2]),
      });
      i += 1;
      continue;
    }
    if (/^>\s?/.test(line)) {
      const quoted: string[] = [];
      while (i < lines.length && /^>\s?/.test(lines[i])) {
        quoted.push(lines[i].replace(/^>\s?/, ''));
        i += 1;
      }
      blocks.push({ type: 'quote', children: parseInline(quoted.join(' ')) });
      continue;
    }
    if (/^[-*・]\s+/.test(line)) {
      const items: { children: Inline[]; due?: DueItem }[] = [];
      while (i < lines.length && /^[-*・]\s+/.test(lines[i])) {
        const body = lines[i].replace(/^[-*・]\s+/, '');
        items.push({ children: parseInline(body), due: parseDueItem(body) ?? undefined });
        i += 1;
      }
      blocks.push({ type: 'ul', items });
      continue;
    }
    if (/^\d+\.\s+/.test(line)) {
      const items: { children: Inline[]; due?: DueItem }[] = [];
      while (i < lines.length && /^\d+\.\s+/.test(lines[i])) {
        const body = lines[i].replace(/^\d+\.\s+/, '');
        items.push({ children: parseInline(body), due: parseDueItem(body) ?? undefined });
        i += 1;
      }
      blocks.push({ type: 'ol', items });
      continue;
    }
    const para: string[] = [];
    while (
      i < lines.length &&
      lines[i].trim() &&
      !/^(#{1,3}\s+|[-*・]\s+|\d+\.\s+|>\s?)/.test(lines[i])
    ) {
      para.push(lines[i]);
      i += 1;
    }
    blocks.push({ type: 'p', children: parseInline(para.join('\n')) });
  }
  return blocks;
}
