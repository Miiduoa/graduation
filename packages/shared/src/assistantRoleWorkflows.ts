import type { AssistantRoleProfileId } from './assistantRoleProfiles';
import type { AssistantServiceId } from './assistantServices';

/** Presentation and task intent only. A selected context never grants a role,
 * school membership, course access or merchant workspace access. */
export type AssistantWorkContext = 'student' | 'teacher' | 'merchant' | 'club' | 'staff' | 'operator';

export type AssistantRoleWorkflow = {
  readonly id: AssistantWorkContext;
  readonly label: string;
  readonly purpose: string;
  readonly placeholder: string;
  readonly suggestions: readonly string[];
  readonly services: readonly { readonly id: AssistantServiceId; readonly label: string }[];
};

const workflows: readonly AssistantRoleWorkflow[] = [
  {
    id: 'student', label: '學生與個人',
    purpose: '把作業、課表、個人行程與校園生活接起來。',
    placeholder: '輸入問題',
    suggestions: ['這禮拜有什麼要交的', '下一堂課在哪，幾點', '中午吃什麼', '幫我排今晚寫作業'],
    services: [],
  },
  {
    id: 'teacher', label: '教師',
    purpose: '整理授課課程的作業、測驗與截止時間，也可接著安排備課行程。',
    placeholder: '例如：查我的授課概況，查近期活動',
    suggestions: [
      '查我的授課概況',
      '查我的授課概況，查近期活動',
      '查我的授課概況，幫我新增行程明天15:00到16:00備課',
    ],
    services: [{ id: 'classroom', label: '開啟授課課程' }],
  },
  {
    id: 'merchant', label: '店家',
    purpose: '核對授權門市的訂單與當班概況，也可一起查校園活動及聯絡資訊。',
    placeholder: '例如：查我的門市營運概況，查近期活動',
    suggestions: [
      '查我的門市營運概況',
      '查我的門市營運概況，查近期活動',
      '查我的門市營運概況，查學校電話',
    ],
    services: [{ id: 'merchant', label: '開啟店家工作區' }],
  },
  {
    id: 'club', label: '社團幹部',
    purpose: '查詢社團與校園活動；成員管理與活動發布請到社團工作區處理。',
    placeholder: '例如：查我的社團，查近期活動',
    suggestions: ['查我的社團，查近期活動'],
    services: [{ id: 'clubs', label: '開啟社團工作區' }],
  },
  {
    id: 'staff', label: '校務與課務',
    purpose: '查校園公告與聯絡資訊；請假核閱、課務申訴依原工作區的指派資格辦理。',
    placeholder: '例如：查校園公告，查學校電話',
    suggestions: ['查校園公告，查學校電話'],
    services: [{ id: 'leave-review', label: '開啟請假核閱' }, { id: 'teacher', label: '開啟課務申訴審核' }],
  },
  {
    id: 'operator', label: '平台管理',
    purpose: '查詢公開服務資訊；平台審核與管理操作請到管理工作區處理。',
    placeholder: '例如：查學校資訊，查公開交流',
    suggestions: ['查學校資訊，查公開交流'],
    services: [{ id: 'admin', label: '開啟平台管理' }],
  },
];

export const ASSISTANT_ROLE_WORKFLOWS: readonly AssistantRoleWorkflow[] = Object.freeze(
  workflows.map(workflow => Object.freeze({ ...workflow,
    suggestions: Object.freeze([...workflow.suggestions]),
    services: Object.freeze(workflow.services.map(service => Object.freeze({ ...service }))),
  })),
);

export function getAssistantRoleWorkflow(context: unknown): AssistantRoleWorkflow {
  return ASSISTANT_ROLE_WORKFLOWS.find(workflow => workflow.id === context) ?? ASSISTANT_ROLE_WORKFLOWS[0];
}

/** A prefilled, explicit task can choose its examples without treating a claim
 * such as "I am an administrator" as an authenticated role. */
export function assistantWorkContextFromQuestion(question: string): AssistantWorkContext {
  if (!question.trim() || question.length > 1000 ||
      /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]|不要|不用|不必|無須|不需要|先別|別幫|不是要|翻譯|假設|如果|例如|範例|[「」『』“”"'`]/u.test(question)) return 'student';
  const teacher = /查(?:詢)?(?:我的)?授課概況/.test(question);
  const merchant = /查(?:詢)?(?:我的)?門市營運概況/.test(question);
  return teacher === merchant ? 'student' : teacher ? 'teacher' : 'merchant';
}

/** Vocabulary mapping only; neither context grants account permissions. */
export function assistantTaskProfileForWorkContext(context: AssistantWorkContext): AssistantRoleProfileId {
  return context === 'staff' ? 'school' : context === 'operator' ? 'platform' : context;
}

export function assistantWorkContextForTaskProfile(profile: AssistantRoleProfileId): AssistantWorkContext {
  return profile === 'school' ? 'staff' : profile === 'platform' ? 'operator' : profile;
}
