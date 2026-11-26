import { assistantTaskProfileForWorkContext, getAssistantRoleWorkflow, type AssistantWorkContext } from '@campus/shared/src/assistantRoleWorkflows';
import type { ResolvedDashboardRole } from './dashboardRole';
import type { AssistantExperience } from '@campus/shared/src/assistantExperiences';
import { getAssistantService } from '@campus/shared/src/assistantServices';

/** Chooses examples only; the assistant and destination still check account access. */
export function workspaceContextForRole(role: ResolvedDashboardRole): AssistantWorkContext {
  if (role === 'teacher' || role === 'ta') return 'teacher';
  if (role === 'vendor') return 'merchant';
  if (role === 'club_officer') return 'club';
  if (role === 'staff' || role === 'department' || role === 'admin') return 'staff';
  return 'student';
}

let draftSequence = 0;

/** A fresh draft handoff never sends the question or changes an account role. */
export function workspaceDraftParams(prompt: string, workContext: AssistantWorkContext) {
  return {
    prompt: prompt.trim().slice(0, 1000),
    taskProfile: assistantTaskProfileForWorkContext(workContext),
    draftEntryId: `workspace-${Date.now()}-${++draftSequence}`,
  };
}

/** The native assistant currently handles work reads through their real service
 * pages. Keep discovery faithful to those adapters rather than Web capability. */
export function mobileWorkspaceExperience(experience: AssistantExperience, platform: boolean): AssistantExperience {
  if (experience.id === 'next-class') return { ...experience, prompt: '下一堂課在哪裡' };
  if (experience.id === 'coursework-week') return { ...experience, prompt: '這禮拜有哪些待交作業' };
  if (experience.id === 'study-evening') return {
    ...experience, title: '把這週的課業排進生活', prompt: '幫我安排未來七天的課表與作業',
    description: '依已儲存的課表與可讀取的作業，準備未來七天的安排。',
  };
  if (experience.id === 'library') return {
    ...experience, prompt: '查圖書館館藏入口',
    description: '找到目前校園的官方館藏目錄，再查書籍與在架資訊。',
  };
  if (experience.workContext === 'all') {
    const service = getAssistantService(experience.serviceId);
    return { ...experience, prompt: `開啟${service?.label ?? '校園服務'}`,
      description: `找到${service?.label ?? '校園服務'}入口，在服務頁查看當次資料與可用操作。` };
  }
  if (experience.workContext === 'student') return experience;
  if (platform && experience.id === 'teaching-preparation') return {
    ...experience, prompt: '安排明天下午一小時備課',
    description: '依自己的課表與個人行程找備課時段，核對後再建立行程。',
  };
  if (platform && experience.id === 'club-planning') return experience;
  const service = getAssistantService(experience.serviceId);
  return {
    ...experience,
    prompt: `開啟${service?.label ?? '校園服務'}`,
    description: `開啟${service?.label ?? '校園服務'}，依目前帳號的資格查看資料並接續處理。`,
  };
}

export function mobileWorkspaceSuggestions(context: AssistantWorkContext, platform: boolean): readonly string[] {
  if (context === 'student') return ['下一堂課在哪裡', '這禮拜有哪些待交作業', '開啟所有服務'];
  const time = platform ? {
    teacher: '安排明天下午一小時備課', merchant: '安排明天下午半小時盤點',
    club: '安排明天下午一小時社團籌備', staff: '安排明天下午一小時行政會議', operator: '安排明天下午半小時維護檢查',
  }[context] : '開啟個人行事曆';
  const service = getAssistantService(getAssistantRoleWorkflow(context).services[0]?.id);
  return [`開啟${service?.label ?? '校園服務'}`, time, '查學校電話'];
}
