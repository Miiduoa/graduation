/** Whole-clause public read intents shared by the composer, role guidance and
 * runtime readers. Recognition selects a tool; it never grants access, changes
 * the selected campus or turns source text into an executable instruction. */
type PublicCampusKind = 'announcements' | 'events';
type PublicCampusTool = 'get_campus_announcements' | 'get_campus_events';
type Obj = Record<string, unknown>;
type SchoolInfoField = 'overview' | 'address' | 'phone' | 'website';
type SchoolInfoArguments = { field?: SchoolInfoField };
type PublicSocialArguments = { limit?: number };

export function parsePublicCampusRead(question: string): {
  kind: PublicCampusKind;
  tool: PublicCampusTool;
  args: Obj;
} | null {
  if (typeof question !== 'string' || !question.trim() || question.length > 120 ||
      /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/u.test(question)) return null;
  let value = question.normalize('NFKC').trim().replace(/[。！？!?]+$/, '').replace(/\s+/g, '');
  value = value.replace(/^(?:(?:麻煩你|麻煩|請問|請|幫我|替我|我想|想|查詢|查看|查一下|看一下|列出|顯示|查|看|看看|核對|有什麼|有哪些|目前的|目前|最近的|最近|最新的|最新|近期的|近期))*/, '');
  value = value.replace(/(?:目前|最近|最新|近期)?(?:有哪些|有什麼|資訊|資料)?(?:嗎|呢)?$/, '');
  const kind = /^(?:校園|學校)?公告$/.test(value) ? 'announcements'
    : /^(?:校園|學校)?活動$/.test(value) ? 'events' : null;
  return kind ? { kind, tool: kind === 'announcements' ? 'get_campus_announcements' : 'get_campus_events', args: {} } : null;
}

export function parseSchoolInfoRead(question: string): { tool: 'get_school_info'; args: SchoolInfoArguments } | null {
  if (typeof question !== 'string' || !question.trim() || question.length > 160 ||
      /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/u.test(question)) return null;
  let value = question.normalize('NFKC').trim().replace(/[。！？!?]+$/, '').trim();
  value = value.replace(/^(?:(?:請問|麻煩你|麻煩|請|幫我|替我|我想)\s*)+/, '');
  value = value.replace(/^(?:(?:查詢|查看|查一下|看一下|看看|列出|顯示|查|看)\s*)+/, '');
  const match = /^(?:(?:我|我們)的)?(?:學校|本校|目前學校|所選學校)(?:的)?(資訊|基本資料|聯絡資訊|地址|電話|總機|總機電話|官網|官方網站)(?:(?:是|有)?(?:什麼|多少|哪個)|在哪裡|在哪|為何)?(?:嗎|呢)?$/.exec(value);
  if (!match) return null;
  const field: SchoolInfoField = /地址/.test(match[1]) ? 'address'
    : /電話|總機/.test(match[1]) ? 'phone' : /官網|官方網站/.test(match[1]) ? 'website' : 'overview';
  return { tool: 'get_school_info', args: { field } };
}

export function parsePublicSocialRead(question: string): {
  tool: 'get_public_social'; args: PublicSocialArguments;
} | null {
  if (typeof question !== 'string' || !question.trim() || question.length > 120 ||
      /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/u.test(question)) return null;
  let value = question.normalize('NFKC').trim().replace(/[。！？!?]+$/, '').replace(/\s+/g, '');
  value = value.replace(/^(?:(?:麻煩你|麻煩|請問|請|幫我|替我|我想|想|查詢|查看|查一下|看一下|看看|查|看|列出|顯示|核對|目前的|目前|最近的|最近|最新的|最新))*/, '');
  value = value.replace(/(?:有哪些|有什麼|資訊|資料)?(?:嗎|呢)?$/, '');
  return /^(?:(?:本校|所選校園|目前校園|校園)的?)?(?:公開交流|公開動態|公開貼文|公開看板(?:動態|貼文)|跨校公開交流)$/.test(value)
    ? { tool: 'get_public_social', args: {} } : null;
}
