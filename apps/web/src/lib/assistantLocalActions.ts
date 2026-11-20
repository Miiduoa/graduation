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
import { answerLocalSchedule, parseLocalScheduleIntent } from './assistantLocalSchedule';

export type LocalAssistantResult = {
  kind: 'services' | 'academics' | 'personal' | 'schedule';
  content: string;
  serviceIds: AssistantServiceId[];
  courseworkTargets?: import('./assistantCoursework').AssistantCourseworkTarget[];
};

/** The caller supplies its verified account scope; text never selects an owner or school. */
export function canAnswerAssistantLocally(question: string): boolean {
  return !!resolveAssistantServiceIntent(question) || !!parseImportedAcademicIntent(question) || !!parseLocalScheduleIntent(question);
}

export function answerAssistantLocally(
  question: string,
  scope: PersonalImportScope,
  options: { preferCampusReads?: boolean; deferMissingSchedule?: boolean } = {},
): LocalAssistantResult | null {
  const service = resolveAssistantServiceIntent(question);
  if (service?.kind === 'catalog') {
    return {
      kind: 'services',
      content: '可以直接問「我今天有什麼課」「下一堂課在哪裡」「明天有什麼行程」，我會整理這台裝置保存的資料。也能查詢已接通的課務與餐點資訊，支援的代辦會先讓你核對並確認；可用範圍依帳號權限處理。需要自己操作時，也可以說「開啟圖書館」或選下方服務。',
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
  const schedule = parseLocalScheduleIntent(question);
  if (schedule) {
    if (options.preferCampusReads) return null;
    const result = answerLocalSchedule(schedule, scope);
    if (options.deferMissingSchedule && result.availability === 'missing') return null;
    return { kind: 'schedule', content: result.content, serviceIds: result.serviceIds };
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
