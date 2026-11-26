import type { AssistantServiceId } from './assistantServices';
import type { AssistantWorkContext } from './assistantRoleWorkflows';

/** Discovery describes a useful starting point. It neither grants a role nor
 * executes a request; destinations retain their own identity and access checks. */
export const ASSISTANT_EXPERIENCE_CATEGORIES = [
  { id: 'plan', label: '安排一天', description: '從課表與待辦開始，留出自己的時間。' },
  { id: 'study', label: '處理課業', description: '找到課程、作業與接下來要準備的事。' },
  { id: 'campus', label: '探索校園', description: '查地點、找資源，安排課堂以外的生活。' },
  { id: 'connect', label: '參與交流', description: '接住校園消息，找到一起參與的人。' },
  { id: 'work', label: '進入工作', description: '從自己的授課、門市或管理工作開始。' },
] as const;

export type AssistantExperienceCategory = (typeof ASSISTANT_EXPERIENCE_CATEGORIES)[number]['id'];
export type AssistantExperience = {
  readonly id: string;
  readonly title: string;
  readonly description: string;
  readonly category: AssistantExperienceCategory;
  readonly workContext: AssistantWorkContext | 'all';
  /** An existing supported question, copied into a draft only. */
  readonly prompt: string;
  readonly serviceId: AssistantServiceId;
  readonly keywords: string;
};

export const ASSISTANT_EXPERIENCES: readonly AssistantExperience[] = [
  {
    id: 'next-class', title: '下一堂課，從容出發',
    description: '先核對上課時間與教室，再打開課表查看。',
    category: 'plan', workContext: 'student',
    prompt: '下一堂課在哪，幾點', serviceId: 'timetable', keywords: '課表 教室 timetable next class schedule',
  },
  {
    id: 'study-evening', title: '留一段時間，把作業完成',
    description: '整理今晚的準備安排，核對內容後再決定要不要加入行程。',
    category: 'plan', workContext: 'student',
    prompt: '幫我排今晚寫作業', serviceId: 'calendar', keywords: '作業 讀書 規劃 行事曆 study plan homework calendar',
  },
  {
    id: 'coursework-week', title: '這週，先處理哪份作業',
    description: '查看可讀取的作業與期限，接著回到課程處理。',
    category: 'study', workContext: 'student',
    prompt: '這禮拜有什麼要交的', serviceId: 'classroom', keywords: '作業 截止 教材 課程 assignment deadline coursework',
  },
  {
    id: 'library', title: '找一本書，找一個新想法',
    description: '從圖書館與館藏查詢開始，接著查看書籍資訊。',
    category: 'study', workContext: 'all',
    prompt: '查圖書館館藏入口', serviceId: 'library', keywords: '圖書館 館藏 書 library books resources',
  },
  {
    id: 'campus-map', title: '先找到地方，再出發',
    description: '查看目前校園的地點，在地圖接著找路。',
    category: 'campus', workContext: 'all',
    prompt: '開啟校園地圖', serviceId: 'map', keywords: '地點 校園 地圖 map navigation location',
  },
  {
    id: 'lunch', title: '午餐，換一個選擇',
    description: '從校園餐廳與菜單找靈感，再查看店家的開放資訊。',
    category: 'campus', workContext: 'all',
    prompt: '中午吃什麼', serviceId: 'cafeteria', keywords: '餐廳 午餐 菜單 food lunch cafeteria',
  },
  {
    id: 'campus-bus', title: '出門前，看看公車',
    description: '找到站牌與路線，確認當次到站資訊。',
    category: 'campus', workContext: 'all',
    prompt: '查公車', serviceId: 'bus', keywords: '交通 公車 站牌 bus transit travel',
  },
  {
    id: 'campus-events', title: '找一場想參加的活動',
    description: '探索近期活動與講座，再到詳情查看時間和報名方式。',
    category: 'connect', workContext: 'all',
    prompt: '查近期活動', serviceId: 'events', keywords: '活動 講座 報名 events join campus',
  },
  {
    id: 'campus-announcements', title: '接住今天的校園消息',
    description: '查看公告與原始來源，找到需要留意的事。',
    category: 'connect', workContext: 'all',
    prompt: '查校園公告', serviceId: 'announcements', keywords: '公告 消息 通知 announcements news updates',
  },
  {
    id: 'public-community', title: '看看大家正在聊什麼',
    description: '找到公開交流入口，依帳號資格閱讀與參與。',
    category: 'connect', workContext: 'all',
    prompt: '查公開交流', serviceId: 'public-social', keywords: '社群 交流 貼文 community social connect',
  },
  {
    id: 'teaching-overview', title: '掌握授課進度',
    description: '先整理自己的授課概況，再回到課程處理作業與測驗。',
    category: 'work', workContext: 'teacher',
    prompt: '查我的授課概況', serviceId: 'classroom', keywords: '教師 老師 授課 批改 teacher teaching classroom',
  },
  {
    id: 'teaching-preparation', title: '替備課留一段時間',
    description: '從授課概況接續安排備課；建立行程前會先核對。',
    category: 'plan', workContext: 'teacher',
    prompt: '查我的授課概況，安排明天下午一小時備課', serviceId: 'calendar', keywords: '老師 教師 備課 教案 teacher preparation calendar',
  },
  {
    id: 'merchant-overview', title: '掌握今天的門市',
    description: '核對已授權門市的營運概況，接著查看工作區。',
    category: 'work', workContext: 'merchant',
    prompt: '查我的門市營運概況', serviceId: 'merchant', keywords: '店家 商家 門市 訂單 merchant shop orders',
  },
  {
    id: 'merchant-campus', title: '把門市與校園動態接起來',
    description: '一起查看門市概況與近期活動，作為當班安排的參考。',
    category: 'work', workContext: 'merchant',
    prompt: '查我的門市營運概況，查近期活動', serviceId: 'merchant', keywords: '商家 店家 活動 營運 merchant events operations',
  },
  {
    id: 'club-events', title: '從社團找到下一場活動',
    description: '查看自己的社團與近期活動，管理工作回到社團頁接續。',
    category: 'work', workContext: 'club',
    prompt: '查我的社團，查近期活動', serviceId: 'clubs', keywords: '社團 幹部 活動 club events',
  },
  {
    id: 'club-planning', title: '為社團籌備排出時間',
    description: '先提出個人籌備時段，核對後再加入行程。',
    category: 'plan', workContext: 'club',
    prompt: '安排明天下午一小時社團籌備', serviceId: 'calendar', keywords: '社團 籌備 行程 club planning calendar',
  },
  {
    id: 'staff-information', title: '找到校務的下一個窗口',
    description: '一起查公告與聯絡資訊，核閱工作由原工作區接續。',
    category: 'work', workContext: 'staff',
    prompt: '查校園公告，查學校電話', serviceId: 'school-info', keywords: '行政 校務 職員 聯絡 電話 staff office contact',
  },
  {
    id: 'platform-services', title: '從公開服務檢視平台',
    description: '查看學校資訊與公開交流；管理操作回到平台工作區。',
    category: 'work', workContext: 'operator',
    prompt: '查學校資訊，查公開交流', serviceId: 'admin', keywords: '平台 管理 管理員 platform operator admin',
  },
];

export function filterAssistantExperiences({
  category = 'all', workContext = 'all', query = '',
}: {
  category?: AssistantExperienceCategory | 'all';
  workContext?: AssistantWorkContext | 'all';
  query?: string;
} = {}): readonly AssistantExperience[] {
  const terms = query.normalize('NFKC').trim().toLocaleLowerCase().split(/\s+/u).filter(Boolean);
  return ASSISTANT_EXPERIENCES.filter((experience) => {
    if (category !== 'all' && experience.category !== category) return false;
    if (workContext !== 'all' && experience.workContext !== 'all' && experience.workContext !== workContext) return false;
    const text = `${experience.title} ${experience.description} ${experience.prompt} ${experience.keywords}`
      .normalize('NFKC').toLocaleLowerCase();
    return terms.every((term) => text.includes(term));
  });
}
