import { connectedServiceClauses } from '@campus/shared/src/assistantRoleReadIntent';
export { connectedServiceClauses } from '@campus/shared/src/assistantRoleReadIntent';
import { parseAssistantCalendarIntent } from '@campus/shared/src/assistantCalendarIntent';
import { parseLibraryCatalogRead } from '@campus/shared/src/assistantLibraryCatalog';
import { canonical, type Obj } from './contracts';
import { parsePublicSocialArguments, parsePublicSocialRead } from './publicSocial';
import { parseSchoolInfoArguments, parseSchoolInfoRead } from './schoolInfo';
import { roleWorkspaceRead } from './roleWorkspaceReads';

export type ConnectedServiceRead = {
  tool: 'get_public_social' | 'get_school_info' | 'get_library_catalog' | 'get_teaching_overview' | 'get_merchant_overview';
  args: Obj;
  serviceId: 'public-social' | 'school-info' | 'library' | 'classroom' | 'merchant';
  label: string;
};

export function connectedServiceRead(question: string): ConnectedServiceRead | null {
  const clause = question.trim().replace(/^先(?=查|看|幫我)/, '');
  const workspace = roleWorkspaceRead(clause);
  if (workspace) return workspace;
  // A fixed no-argument directory read; named schools and other requests stay unconsumed.
  if (parseLibraryCatalogRead(clause)) return { tool: 'get_library_catalog', args: {},
    serviceId: 'library', label: '查本校圖書館館藏入口' };
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


export function connectedServiceReadKey(read: Pick<ConnectedServiceRead, 'tool' | 'args'>): string {
  return read.tool + canonical(read.args);
}

/** A public post has no verified calendar/order contract. Explicit independent
 * plans remain possible; references to post content cannot supply action data. */
export function publicPostSourceReferenced(question: string, now = Date.now()): boolean {
  const text = question.normalize('NFKC');
  if (!/公開(?:交流|動態|貼文|看板)|跨校公開交流|社群|貼文/.test(text)) return false;
  const clauses = connectedServiceClauses(text);
  // An independently specified paper appointment supplies its own valid date,
  // times and exact title. Its ordinal is not a reference to a public post;
  // any source reference in another clause must still block proposals.
  const sourceText = clauses.length ? clauses.filter(clause => {
    const intent = parseAssistantCalendarIntent(clause, now);
    return intent?.kind !== 'draft' || !/^(?:讀|閱讀)第[一二三四五六七八九十0-9]+篇論文$/.test(intent.event.title);
  }).join('，') : text;
  return /第[一二三四五六七八九十0-9]+篇|(?:這|那|該|同一)篇|(?:把|將|依照|依據|根據|按照|照著|照|為|替|從|依|用).{0,40}(?:貼文|文章|動態)|(?:貼文|文章|動態)(?:裡|內|中|上)?(?:說|提到|寫|的)/.test(sourceText);
}

export function publicPostActionRequested(question: string, now = Date.now()): boolean {
  return publicPostSourceReferenced(question, now) && /安排|規劃|幫我排|排.{0,8}(?:行程|事件)|(?:變|轉|改)成.{0,8}(?:行程|事件)|新增|建立|加.{0,8}行事曆|點餐|下單|報名/.test(question.normalize('NFKC'));
}
