import { getOfficialLibrary } from './officialLibraries';
import { getPublicSchoolInfo } from './publicSchoolInfo';
import { toPublicSchoolId } from './schoolIds';

export type AssistantLibraryCatalog = {
  name: string;
  websiteUrl: string;
  catalogUrl: string;
  hoursUrl?: string;
};

function officialLink(raw: string): boolean {
  try {
    const link = new URL(raw);
    return raw.length <= 800 && !/[\s\p{Cc}\p{Cf}]/u.test(raw) && link.protocol === 'https:' && !!link.hostname && !link.username && !link.password;
  } catch {
    return false;
  }
}

/** Project only public directory fields for the bound school, never its patron account URL. */
export function getAssistantLibraryCatalog(schoolId: string): AssistantLibraryCatalog | null {
  const id = toPublicSchoolId(schoolId);
  // The MOE name and the official catalog resolver also identify documented
  // canonical/legacy pairs such as nchu/tw-nchu; display names are never input.
  const library = getOfficialLibrary(id, getPublicSchoolInfo(id)?.name);
  if (!library || !library.name.trim() || library.name.length > 120 || /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/u.test(library.name) ||
      !officialLink(library.websiteUrl) || !officialLink(library.catalogUrl)) return null;
  const { name, websiteUrl, catalogUrl, hoursUrl } = library;
  return { name, websiteUrl, catalogUrl, ...(hoursUrl && officialLink(hoursUrl) ? { hoursUrl } : {}) };
}

/** A catalog destination request. A title, loan, availability or live hours question
 * needs a different data source and cannot be reduced to this directory read. */
export function parseLibraryCatalogRead(question: string): { tool: 'get_library_catalog'; args: Record<string, never> } | null {
  if (typeof question !== 'string' || !question.trim() || question.length > 140 ||
      /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/u.test(question)) return null;
  const text = question.normalize('NFKC').trim().replace(/[。.!！?？]+$/, '').replace(/\s+/g, '');
  const subject = text.replace(/^(?:麻煩你|麻煩|請問|請)/, '')
    .replace(/^(?:幫我|替我|我想)/, '')
    .replace(/^(?:查一下|看一下|查詢|查看|查|看)/, '');
  const catalog = /^(?:(?:本校|學校|所選校園|目前校園)(?:的)?)?(?:(?:圖書館|校圖)的?)?(?:官方)?館藏(?:查詢)?(?:入口|網址|連結|目錄)(?:是什麼|在哪裡|在哪)?(?:嗎|呢)?$/;
  return catalog.test(subject) ? { tool: 'get_library_catalog', args: {} } : null;
}
