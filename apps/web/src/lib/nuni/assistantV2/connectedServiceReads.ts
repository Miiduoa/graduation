import { canonical, type Obj } from './contracts';
import { parsePublicSocialArguments, parsePublicSocialRead } from './publicSocial';
import { parseSchoolInfoArguments, parseSchoolInfoRead } from './schoolInfo';

export type ConnectedServiceRead = {
  tool: 'get_public_social' | 'get_school_info';
  args: Obj;
  serviceId: 'public-social' | 'school-info';
  label: string;
};

export function connectedServiceRead(question: string): ConnectedServiceRead | null {
  const clause = question.trim().replace(/^先(?=查|看|幫我)/, '');
  const social = parsePublicSocialRead(clause);
  if (social) return { tool: social.tool, args: { ...parsePublicSocialArguments(social.args) },
    serviceId: 'public-social', label: '查公開交流動態' };
  const school = parseSchoolInfoRead(clause);
  return school ? { tool: school.tool, args: { ...parseSchoolInfoArguments(school.args) },
    serviceId: 'school-info', label: '查學校公開資訊' } : null;
}

/** Only whole, explicit clauses authorize these fixed-campus reads. Unknown
 * filters remain unconsumed; a model cannot turn them into a broader query. */
export function connectedServiceReads(question: string): ConnectedServiceRead[] {
  const clauses = connectedServiceClauses(question);
  const reads = clauses.map(connectedServiceRead).filter((read): read is ConnectedServiceRead => read !== null);
  return reads.filter((read, index) => reads.findIndex(other =>
    other.tool === read.tool && canonical(other.args) === canonical(read.args)) === index);
}

export function connectedServiceClauses(question: string): string[] {
  if (!question.trim() || question.length > 1000 || /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/u.test(question) ||
      /不要|不用|不必|無須|不需要|先別|別幫|不是要|翻譯|假設|如果|例如|範例/.test(question)) return [];
  const text = question.normalize('NFKC').trim();
  const quotes: Record<string, string> = { '「': '」', '『': '』', '“': '”', '"': '"', "'": "'", '`': '`' };
  const clauses: string[] = [];
  let quote = '', part = '';
  for (let index = 0; index < text.length;) {
    const character = text[index];
    if (quote) {
      part += character;
      if (character === quote) quote = '';
      index++;
      continue;
    }
    if (quotes[character]) {
      quote = quotes[character];
      part += character;
      index++;
      continue;
    }
    const separator = /^(?:然後|接著|順便|並且|另外|同時|以及|也幫我|再幫我|並幫我|[，,；;。！!？?、和與])/.exec(text.slice(index));
    if (separator) {
      if (part.trim()) clauses.push(part.trim());
      part = '';
      index += separator[0].length;
    } else { part += character; index++; }
  }
  if (quote) return [];
  if (part.trim()) clauses.push(part.trim());
  if (!clauses.length || clauses.length > 12) return [];
  return clauses;
}

export function connectedServiceReadKey(read: Pick<ConnectedServiceRead, 'tool' | 'args'>): string {
  return read.tool + canonical(read.args);
}

/** A public post has no verified calendar/order contract. Explicit independent
 * plans remain possible; references to post content cannot supply action data. */
export function publicPostSourceReferenced(question: string): boolean {
  const text = question.normalize('NFKC');
  if (!/公開(?:交流|動態|貼文|看板)|跨校公開交流|社群|貼文/.test(text)) return false;
  return /第[一二三四五六七八九十0-9]+篇|(?:這|那|該|同一)篇|(?:把|將|依照|依據|根據|按照|照著|照|為|替|從|依|用).{0,40}(?:貼文|文章|動態)|(?:貼文|文章|動態)(?:裡|內|中|上)?(?:說|提到|寫|的)/.test(text);
}

export function publicPostActionRequested(question: string): boolean {
  return publicPostSourceReferenced(question) && /安排|規劃|幫我排|排.{0,8}(?:行程|事件)|(?:變|轉|改)成.{0,8}(?:行程|事件)|新增|建立|加.{0,8}行事曆|點餐|下單|報名/.test(question.normalize('NFKC'));
}
