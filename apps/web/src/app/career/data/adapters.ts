import { parse, type DefaultTreeAdapterMap } from 'parse5';
import {
  careerSafeUrl,
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
/** Normalize decoded titles before matching, including separators inserted between letters. */
function hasPersonalAcademicData(title: string): boolean {
  const normalized = title
    .normalize('NFKC')
    .toLowerCase()
    .replace(/学/g, '學')
    .replace(/号/g, '號')
    .replace(/绩/g, '績')
    .replace(/数/g, '數')
    .replace(/[^\p{L}\p{N}]/gu, '');
  // Conservatively omit the whole announcement, never publish a partially redacted title.
  if (
    /學號|成績|等第|評分|評量|分數|績點|平均|均分|總分|總評|名單|名冊|錄取|榜單|student(?:id|number)|grades?|scores?|gpa|gradepointaverage|academicaverage|weightedaverage|average\d/.test(
      normalized,
    )
  )
    return true;
  // Remove public dates first. A standalone letter grade is withheld even without
  // a result label: identifying names are not limited to a fixed surname list.
  const dateFree = title
    .normalize('NFKC')
    .replace(/(?<!\d)(?:20\d{2}|1[01]\d)[年/.-]\d{1,2}[月/.-]\d{1,2}日?(?!\d)/g, '');
  const compact = dateFree.toLowerCase().replace(/[\s\p{Cf}]/gu, '');
  if (/(?<![a-z0-9])[a-f][+-]?(?![a-z0-9])/i.test(dateFree)) return true;
  // Name-like text immediately followed by a numeric result is also private,
  // including spaced digits, decimal results and fractions. Do not treat event
  // durations such as「30 分鐘」as grades.
  const nameAndScore = compact
    .replace(/[^\p{L}\p{N}./]/gu, '')
    .replace(/\d+(?:\.\d+)?(?:分鐘|小時|學分|場|名|人|元|年度|年|月|日|天|週|周|時)/g, '');
  if (/(?:[\p{Script=Han}]{2,}|[a-z]{2,})\d{1,3}(?:\.\d+)?(?:分)?(?!\d)/u.test(nameAndScore))
    return true;
  // Results may precede the identifying name as well. Use the same unit-stripped
  // text so ordinary public quantities (30 分鐘、500 元、104 人) stay readable.
  if (/(?<!\d)\d{1,3}(?:\.\d+)?(?:分)?(?:[\p{Script=Han}]{2,}|[a-z]{2,})/u.test(nameAndScore))
    return true;
  // Chinese numeric scores and standalone Chinese result levels are private too.
  // Strip separators consistently, but keep duration units such as「九十分鐘」public.
  if (
    /[零〇一二三四五六七八九十百兩壹貳參肆伍陸柒捌玖拾佰]+(?:點[零〇一二三四五六七八九]+)?分(?!鐘)/u.test(
      compact,
    )
  )
    return true;
  if (
    /(?:^|[^\p{L}\p{N}])(?:優|優等|甲|乙|丙|丁|戊|甲等|乙等|丙等|丁等|及格|不及格)(?=$|[^\p{L}\p{N}])/u.test(
      dateFree,
    )
  )
    return true;
  // Student identifiers can mix letters and digits rather than contain eight
  // consecutive digits (for example S411A1234).
  const identifiers = dateFree
    .replace(/[^\p{L}\p{N}]/gu, '')
    .match(/(?<![a-z0-9])[a-z][a-z0-9]{7,}(?![a-z0-9])/gi);
  if (identifiers?.some((value) => /\d/.test(value))) return true;
  // Dates are public metadata; other long numeric identifiers may be student IDs.
  const withoutDates = dateFree.replace(/[^\p{L}\p{N}]/gu, '');
  return /\d{8,}/.test(withoutDates) || /\d+(?:[.．]\d+)?\s*分(?!鐘)/.test(title.normalize('NFKC'));
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
      // Inspect the complete decoded title before truncation so sensitive fields
      // cannot slip into the public feed (including its timeline and cache).
      // Reject grade-related titles regardless of punctuation, names or score format.
      const fullTitle = text(link).normalize('NFKC');
      if (hasPersonalAcademicData(fullTitle)) return [];
      const title = fullTitle.slice(0, 300);
      if (!url || !title || seen.has(url)) return [];
      if (source.source === '資管系' && !/實習|工讀|職涯|徵才|就業|求職|履歷|面試/.test(title))
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
async function getText(url: string) {
  const response = await fetch(url, {
    signal: AbortSignal.timeout(10000),
    redirect: 'error',
    cache: 'no-store',
  });
  if (!response.ok) throw new Error('source unavailable');
  const raw = await response.text();
  if (raw.length > 2_000_000) throw new Error('oversized source');
  return raw;
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
