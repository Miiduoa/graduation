import { parse, type DefaultTreeAdapterMap } from 'parse5';
import {
  careerSafeUrl,
  careerHasSensitiveContent,
  careerHasTimelineKeyword,
  careerTimeline,
  emptyCareerFeed,
  type CareerAnnouncement,
  type CareerFeed,
  type CareerJob,
} from '@campus/shared/src/career';

type Node = DefaultTreeAdapterMap['node'];
function children(node: Node): Node[] {
  return 'childNodes' in node ? node.childNodes : [];
}
function text(node: Node): string {
  return ('value' in node ? node.value : children(node).map(text).join(' '))
    .replace(/\s+/g, ' ')
    .trim();
}
function attr(node: Node, key: string) {
  return 'attrs' in node ? (node.attrs.find((a) => a.name === key)?.value ?? '') : '';
}
function walk(node: Node, match: (n: Node) => boolean): Node[] {
  return [...(match(node) ? [node] : []), ...children(node).flatMap((n) => walk(n, match))];
}
export const CAREER_HTML_SOURCES = [
  { source: '職產處', url: 'https://cdif.pu.edu.tw/' },
  { source: '資管系', url: 'https://csim.pu.edu.tw/' },
] as const;
export const TAIWANJOBS_URL =
  'https://free.taiwanjobs.gov.tw/webservice_taipei/Webservice.ashx?zipno=433&count=10';
/** Rpage article identity lives in the path; no query or fragment is needed. */
function announcementUrl(value: string, source: (typeof CAREER_HTML_SOURCES)[number]): string {
  const safe = careerSafeUrl(value, new URL(source.url).hostname, source.url);
  if (!safe) return '';
  const url = new URL(safe);
  if (url.port || !/^\/p\/40[46]-\d+-\d+(?:,r\d+)?\.php$/.test(url.pathname)) return '';
  // Rebuild from approved fields so arbitrary URL metadata cannot enter the
  // public cache or be forwarded to an external calendar provider.
  return url.origin + url.pathname;
}
/** Rpage list metadata only. Never fetch, return or persist article bodies. */
export function parseCareerHtml(
  html: string,
  source: (typeof CAREER_HTML_SOURCES)[number],
): CareerAnnouncement[] {
  const root = parse(html);
  const seen = new Set<string>();
  const rows = walk(root, (n) => attr(n, 'class').split(' ').includes('d-txt'));
  if (!rows.length) throw new Error('announcement markup unavailable');
  return rows
    .flatMap((row) => {
      const link = walk(row, (n) => 'tagName' in n && n.tagName === 'a').find((n) =>
        /\/p\/40[46]-/.test(attr(n, 'href')),
      );
      if (!link) return [];
      const url = announcementUrl(attr(link, 'href'), source);
      // Apply the shared defense-in-depth policy before truncation and public caching.
      const fullTitle = text(link).normalize('NFKC');
      if (careerHasSensitiveContent(fullTitle)) return [];
      const title = fullTitle.slice(0, 300);
      if (!url || !title || seen.has(url)) return [];
      if (
        source.source === '資管系' &&
        !careerHasTimelineKeyword(title) &&
        !/工讀|職涯|面試/.test(title)
      )
        return [];
      seen.add(url);
      const dateNode = walk(row, (n) => attr(n, 'class').split(' ').includes('mdate'))[0];
      return [
        {
          title,
          url,
          date: dateNode ? (text(dateNode).match(/\d{4}-\d{2}-\d{2}/)?.[0] ?? '') : '',
          source: source.source,
        },
      ];
    })
    .slice(0, 40);
}
/** The official feed uses Chinese field suffixes and CDATA. Read only three fields, never job descriptions. */
export function parseTaiwanJobs(xml: string): CareerJob[] {
  if (!/<DataList[>\s]/i.test(xml)) throw new Error('invalid job feed');
  return [...xml.matchAll(/<Data>([\s\S]*?)<\/Data>/gi)]
    .flatMap(([, row]) => {
      function field(name: string) {
        const raw =
          row.match(
            new RegExp(`<${name}(?:（[^>]*）)?>([\\s\\S]*?)<\\/${name}(?:（[^>]*）)?>`, 'i'),
          )?.[1] ?? '';
        return raw.startsWith('<![CDATA[') ? raw.slice(9, -3).trim() : text(parse(raw));
      }
      const title = field('OCCU_DESC').slice(0, 200);
      const company = field('COMPNAME').slice(0, 200);
      const url = careerSafeUrl(field('URL_QUERY'), 'job.taiwanjobs.gov.tw');
      return title && url ? [{ title, company, url, source: '台灣就業通' as const }] : [];
    })
    .slice(0, 10);
}
// Preserve the original response.text().length limit (UTF-16 code units).
export const CAREER_SOURCE_LIMIT = 2_000_000;
// UTF-8 needs at most three bytes per code unit, plus an optional stripped BOM.
const CAREER_SOURCE_BYTE_LIMIT = CAREER_SOURCE_LIMIT * 3 + 3;
export async function getText(url: string) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10000);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      redirect: 'error',
      cache: 'no-store',
    });
    if (!response.ok || !response.body) throw new Error('source unavailable');
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let size = 0;
    let raw = '';
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > CAREER_SOURCE_BYTE_LIMIT) {
          controller.abort();
          await reader.cancel();
          throw new Error('oversized source');
        }
        raw += decoder.decode(value, { stream: true });
        if (raw.length > CAREER_SOURCE_LIMIT) {
          controller.abort();
          await reader.cancel();
          throw new Error('oversized source');
        }
      }
      raw += decoder.decode();
      if (raw.length > CAREER_SOURCE_LIMIT) {
        controller.abort();
        await reader.cancel();
        throw new Error('oversized source');
      }
      return raw;
    } finally {
      reader.releaseLock();
    }
  } finally {
    clearTimeout(timer);
  }
}
export async function loadCareerFeed(): Promise<CareerFeed> {
  const [results, jobs] = await Promise.all([
    Promise.allSettled(
      CAREER_HTML_SOURCES.map(async (source) => parseCareerHtml(await getText(source.url), source)),
    ),
    Promise.allSettled([getText(TAIWANJOBS_URL).then(parseTaiwanJobs)]),
  ]);
  const announcements = results.flatMap((r) => (r.status === 'fulfilled' ? r.value : []));
  return {
    ...emptyCareerFeed(),
    announcements,
    timeline: careerTimeline(announcements),
    jobs: jobs[0].status === 'fulfilled' ? jobs[0].value : [],
    jobsUnavailable: jobs[0].status === 'rejected',
    announcementsUnavailable: results.some((r) => r.status === 'rejected'),
  };
}
