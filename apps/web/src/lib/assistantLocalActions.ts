'use client';

import {
  ASSISTANT_SERVICES,
  resolveAssistantServiceIntent,
  type AssistantServiceId,
} from '@campus/shared/src/assistantServices';
import {
  formatImportedAcademicSummary,
  parseImportedAcademicIntent,
  summarizeImportedAcademics,
} from '@campus/shared/src/importedAcademicSummary';
import { readPersonalImports, type PersonalImportScope } from './personalImports';

export type LocalAssistantResult = {
  kind: 'services' | 'academics' | 'personal';
  content: string;
  serviceIds: AssistantServiceId[];
};

/** The caller supplies its verified account scope; text never selects an owner or school. */
export function canAnswerAssistantLocally(question: string): boolean {
  return !!resolveAssistantServiceIntent(question) || !!parseImportedAcademicIntent(question);
}

export function answerAssistantLocally(
  question: string,
  scope: PersonalImportScope,
  options: { preferCampusReads?: boolean } = {},
): LocalAssistantResult | null {
  const service = resolveAssistantServiceIntent(question);
  if (service?.kind === 'catalog') {
    return {
      kind: 'services',
      content: '可以從下方選擇服務，或直接說「開啟圖書館」「帶我到課程與作業」。查詢資料與送出操作會依各服務目前接通的能力及帳號權限處理。',
      serviceIds: ASSISTANT_SERVICES.map((item) => item.id),
    };
  }
  if (service?.kind === 'open') {
    return {
      kind: 'services',
      content: service.service.summary,
      serviceIds: [service.service.id],
    };
  }
  const academic = parseImportedAcademicIntent(question);
  if (!academic) return null;
  if (options.preferCampusReads && !/匯入|儲存|保存/.test(question)) return null;
  const base = {
    schoolId: scope.schoolId,
    fetchedAt: new Date().toISOString(),
    academicYear: academic.academicYear,
    semester: academic.semester,
  };
  // Only the established, currently signed-in storage namespace may be read.
  const authenticated = /^(?:platform|school):[^\s:][^\r\n]{0,199}$/.test(scope.owner);
  let result;
  try {
    result = summarizeImportedAcademics({
      ...base,
      records: authenticated ? readPersonalImports(scope) : null,
      availability: authenticated ? 'available' : 'unavailable',
    });
  } catch {
    result = summarizeImportedAcademics({ ...base, records: null, availability: 'unavailable' });
  }
  return {
    kind: 'academics',
    content: '這次查看的是此帳號在這個瀏覽器保存的個人匯入紀錄。\n' + formatImportedAcademicSummary(result),
    serviceIds: ['import', 'credits'],
  };
}
