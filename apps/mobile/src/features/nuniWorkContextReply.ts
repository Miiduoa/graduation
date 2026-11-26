import { parseAssistantCalendarIntent } from '@campus/shared/src/assistantCalendarIntent';
import { parseSchoolInfoRead } from '@campus/shared/src/assistantPublicReadIntent';
import type { AssistantRoleProfile } from '@campus/shared/src/assistantRoleProfiles';
import { assistantRoleWorkServices } from '@campus/shared/src/assistantRoleTasks';
import { ASSISTANT_SERVICES, resolveAssistantServiceIntent, type AssistantServiceIntent } from '@campus/shared/src/assistantServices';
import { getSchoolContactAnswer } from '@campus/shared/src/schoolContactAnswer';
import type { AssistantServiceSelection } from '../services/assistantServiceNavigation';

type DeviceServiceReply = {
  source: 'device'; tool: 'open-service' | 'school-directory'; content: string;
  hasActions: false; serviceSelection?: AssistantServiceSelection;
};

export function serviceDirectoryReply(intent: AssistantServiceIntent, workContext = false): DeviceServiceReply {
  if (intent.kind === 'open') return {
    source: 'device', tool: 'open-service', hasActions: false,
    content: `可以從下方開啟${intent.service.label}，再接續處理。`,
    serviceSelection: { kind: 'open', serviceIds: [intent.service.id] },
  };
  return {
    source: 'device', tool: 'open-service', hasActions: false,
    content: workContext ? '選擇想使用的功能，再到對應服務接續處理。'
      : '選擇想使用的功能。查課表與已儲存成績也可以直接提問；送出申請、下單及發訊息仍在原服務確認。',
    serviceSelection: { kind: 'catalog', serviceIds: ASSISTANT_SERVICES.map(service => service.id) },
  };
}

/** A professional request must not fall through to private student or buyer readers. */
export function workContextReply(profile: AssistantRoleProfile, question: string, schoolId: string,
  schoolName?: string | null): DeviceServiceReply {
  const service = resolveAssistantServiceIntent(question);
  if (service) return serviceDirectoryReply(service, true);
  let contact = getSchoolContactAnswer(schoolId, question, schoolName);
  if (!contact) {
    const field = parseSchoolInfoRead(question)?.args.field;
    const fields = { address: '學校地址', phone: '學校總機', website: '學校官網', overview: '學校聯絡資訊' };
    if (field) contact = getSchoolContactAnswer(schoolId, fields[field], schoolName);
  }
  if (contact) return { content: contact, source: 'device', hasActions: false, tool: 'school-directory' };

  // Only a complete public service name resolves. A request to refund or publish
  // stays with the work context and cannot trigger the action here.
  const publicPage = resolveAssistantServiceIntent(question.replace(/^(?:請幫我|幫我|請)?(?:查詢|查看|查)/u, '開啟'));
  if (publicPage?.kind === 'open' && publicPage.service.access === 'public') return serviceDirectoryReply(publicPage, true);
  if (parseAssistantCalendarIntent(question)) return {
    source: 'device', tool: 'open-service', hasActions: false,
    content: '可以開啟個人行事曆，指定這筆行程的名稱與起訖時間。',
    serviceSelection: { kind: 'open', serviceIds: ['calendar'] },
  };
  return {
    source: 'device', tool: 'open-service', hasActions: false,
    content: `「${profile.label}」可依本人課表與個人行程找工作時段。這項要求請到下方服務接續處理。`,
    serviceSelection: { kind: 'open', serviceIds: [...assistantRoleWorkServices(profile.id)] },
  };
}
