/**
 * 2026-11-12 研究所口試示範資料（與真實校園租戶隔離）。
 *
 * 僅供 /demo/oral-exam 與手機「口試示範工作區」使用。
 * 不開啟學號登入、線上點餐或校務連線；不含真實學號、成績或密碼。
 */

export const ORAL_EXAM_TENANT_ID = 'nuni-oral-exam';
export const ORAL_EXAM_TAG = '2026-11-12';
export const ORAL_EXAM_SCHOOL_NAME = '示範大學（口試專用）';
export const ORAL_EXAM_SCHOOL_SHORT_NAME = '示範大學';
export const ORAL_EXAM_WEB_PATH = '/demo/oral-exam';
export const ORAL_EXAM_PRODUCTION_URL = 'https://nuni.tw/demo/oral-exam';
export const ORAL_EXAM_STORAGE_KEY = 'nuni.oralExamDemo.v1';

export type OralExamRole = 'student' | 'teacher' | 'school_admin' | 'merchant' | 'ops';

export const ORAL_EXAM_ROLES: readonly OralExamRole[] = [
  'student',
  'teacher',
  'school_admin',
  'merchant',
  'ops',
] as const;

export type OralExamAccount = {
  role: OralExamRole;
  uid: string;
  displayName: string;
  title: string;
  department: string;
  demoId: string;
  email: string;
  webHref: string;
  entryHint: string;
  clicks: readonly [string, string, string];
};

export const ORAL_EXAM_ACCOUNTS: readonly OralExamAccount[] = [
  {
    role: 'student',
    uid: 'oral-exam-student-wang',
    displayName: '示範學生王小明',
    title: '學生',
    department: '資訊管理學系三年級',
    demoId: 'DEMO1140001',
    email: 'student.wang@nuni-oral-exam.example',
    webHref: `${ORAL_EXAM_WEB_PATH}?role=student`,
    entryHint: '網頁選「學生」；手機點「口試示範工作區」再選學生。',
    clicks: ['打開課表看資料結構', '繳交鏈結串列作業', '對進行中的點名按簽到'],
  },
  {
    role: 'teacher',
    uid: 'oral-exam-teacher-lin',
    displayName: '示範教師林佳蓉',
    title: '教師',
    department: '資訊管理學系',
    demoId: 'DEMO-T-88001',
    email: 'teacher.lin@nuni-oral-exam.example',
    webHref: `${ORAL_EXAM_WEB_PATH}?role=teacher`,
    entryHint: '網頁選「教師」；手機同一工作區切到教師。',
    clicks: ['打開成績冊批改王小明', '開啟本堂點名', '核准病假申請'],
  },
  {
    role: 'school_admin',
    uid: 'oral-exam-school-admin-chen',
    displayName: '示範校務陳志明',
    title: '校方管理員',
    department: '教務處（僅示範租戶）',
    demoId: 'DEMO-A-77001',
    email: 'school.admin@nuni-oral-exam.example',
    webHref: `${ORAL_EXAM_WEB_PATH}?role=school_admin`,
    entryHint: '網頁選「校方」；權限只涵蓋示範大學租戶。',
    clicks: ['發布校園公告', '查看行事曆活動', '核對示範人員名冊'],
  },
  {
    role: 'merchant',
    uid: 'oral-exam-merchant-huang',
    displayName: '示範店長黃阿英',
    title: '店家',
    department: '示範中餐部',
    demoId: 'DEMO-M-66001',
    email: 'merchant.huang@nuni-oral-exam.example',
    webHref: `${ORAL_EXAM_WEB_PATH}?role=merchant`,
    entryHint: '網頁選「店家」；線上點餐旗標維持關閉，只展示菜單與備餐單。',
    clicks: ['查看今日菜單', '把備餐中訂單標為可取餐', '核對過敏原標示'],
  },
  {
    role: 'ops',
    uid: 'oral-exam-ops-wu',
    displayName: '示範營運吳平台',
    title: '平台營運',
    department: 'nuni 平台營運（僅示範租戶）',
    demoId: 'DEMO-O-55001',
    email: 'ops.wu@nuni-oral-exam.example',
    webHref: `${ORAL_EXAM_WEB_PATH}?role=ops`,
    entryHint: '網頁選「平台營運」；看不到其他學校或真實使用者。',
    clicks: ['打開示範租戶健康面板', '查看店家與課班摘要', '確認其他租戶為空白'],
  },
];

export function getOralExamAccount(role: OralExamRole): OralExamAccount {
  const account = ORAL_EXAM_ACCOUNTS.find((item) => item.role === role);
  if (!account) throw new Error(`unknown oral exam role: ${role}`);
  return account;
}

export function parseOralExamRole(value: string | null | undefined): OralExamRole {
  return ORAL_EXAM_ROLES.find((role) => role === value) ?? 'student';
}

export const ORAL_EXAM_COURSES = [
  {
    id: 'oral-exam-course-ds',
    code: 'IM301',
    name: '資料結構',
    instructor: '示範教師林佳蓉',
    room: '資訊館 302',
    day: '週一',
    period: '1–2 節 08:10–10:00',
    credits: 3,
  },
  {
    id: 'oral-exam-course-db',
    code: 'IM303',
    name: '資料庫系統',
    instructor: '示範教師林佳蓉',
    room: '資訊館 205',
    day: '週三',
    period: '3–4 節 10:10–12:00',
    credits: 3,
  },
  {
    id: 'oral-exam-course-os',
    code: 'IM302',
    name: '作業系統',
    instructor: '示範教師周文彥',
    room: '工學館 108',
    day: '週二',
    period: '5–6 節 13:10–15:00',
    credits: 3,
  },
] as const;

export const ORAL_EXAM_ASSIGNMENTS = [
  {
    id: 'oral-exam-hw-list',
    courseId: 'oral-exam-course-ds',
    courseName: '資料結構',
    title: '作業三：鏈結串列反轉',
    due: '2026-11-14 23:59',
    points: 100,
    studentStatus: '待繳交',
  },
  {
    id: 'oral-exam-hw-er',
    courseId: 'oral-exam-course-db',
    courseName: '資料庫系統',
    title: '作業二：ER 圖與正規化',
    due: '2026-11-12 23:59',
    points: 100,
    studentStatus: '已繳交，待批改',
  },
] as const;

export const ORAL_EXAM_GRADEBOOK = [
  {
    studentName: '示範學生王小明',
    demoId: 'DEMO1140001',
    hw2: 82,
    hw3: null as number | null,
    attendance: '出席 9 / 10',
    final: null as number | null,
  },
  {
    studentName: '示範學生林宏志',
    demoId: 'DEMO1140002',
    hw2: 91,
    hw3: 88,
    attendance: '出席 10 / 10',
    final: null as number | null,
  },
  {
    studentName: '示範學生陳雅婷',
    demoId: 'DEMO1140003',
    hw2: 74,
    hw3: 80,
    attendance: '出席 8 / 10',
    final: null as number | null,
  },
] as const;

export const ORAL_EXAM_ATTENDANCE = {
  courseName: '資料結構',
  sessionTitle: '2026-11-12 第 1–2 節點名',
  status: '進行中',
  present: ['示範學生林宏志', '示範學生陳雅婷'],
  waiting: ['示範學生王小明'],
} as const;

export const ORAL_EXAM_LEAVE = {
  id: 'oral-exam-leave-1',
  studentName: '示範學生王小明',
  courseName: '作業系統',
  reason: '感冒發燒，醫師建議在家休息一日',
  date: '2026-11-13',
  status: '待審核',
} as const;

export const ORAL_EXAM_CALENDAR = [
  {
    id: 'oral-exam-cal-midterm',
    title: '114-1 期中考週',
    when: '2026-11-17（一）至 11-21（五）',
    place: '各科原教室',
    source: '教務處',
  },
  {
    id: 'oral-exam-cal-clubfair',
    title: '社團博覽會',
    when: '2026-11-15（六）10:00–16:00',
    place: '學生活動中心前廣場',
    source: '課外活動組',
  },
  {
    id: 'oral-exam-cal-network',
    title: '校園網路維護',
    when: '2026-11-16（日）02:00–05:00',
    place: '全校',
    source: '電子計算機中心',
  },
] as const;

export const ORAL_EXAM_ANNOUNCEMENTS = [
  {
    id: 'oral-exam-ann-1',
    title: '【教務處】期中考週教室異動與補考申請',
    body: '期中考期間請依各科公告教室應考。因病缺考須於考試當日 17:00 前完成請假，並於三日內檢附證明辦理補考。',
    source: '教務處課務組',
    publishedAt: '2026-11-10 09:00',
  },
  {
    id: 'oral-exam-ann-2',
    title: '【資管系】專題期中發表時程',
    body: '資訊管理學系三年級專題期中發表訂於 11 月 19 日下午於資訊館 1 樓國際會議廳舉行。',
    source: '資訊管理學系',
    publishedAt: '2026-11-09 14:30',
  },
] as const;

export const ORAL_EXAM_CLUB = {
  id: 'oral-exam-club-coding',
  name: '程式設計社',
  officers: '示範社長魏廷安',
  nextEvent: '11/15 社團博覽會擺攤，歡迎路過挑戰解題。',
} as const;

export const ORAL_EXAM_FEED = [
  {
    id: 'oral-exam-post-1',
    author: '示範社長魏廷安',
    body: '博覽會攤位需要兩位輪班。已排示範學生王小明 10:00–12:00。',
    time: '昨天 21:14',
  },
  {
    id: 'oral-exam-post-2',
    author: '示範學生林宏志',
    body: '今晚 19:30 在資訊館 205 複習正規化，帶筆電即可。',
    time: '今天 11:02',
  },
] as const;

export const ORAL_EXAM_STORIES = [
  { id: 'oral-exam-story-1', author: '程式設計社', caption: '博覽會海報完成' },
  { id: 'oral-exam-story-2', author: '示範學生陳雅婷', caption: '圖書館閉館前最後一題' },
] as const;

export const ORAL_EXAM_DMS = [
  {
    id: 'oral-exam-dm-1',
    from: '示範教師林佳蓉',
    preview: '作業三可用遞迴或迭代，測資會包含空串列。',
  },
  {
    id: 'oral-exam-dm-2',
    from: '示範學生林宏志',
    preview: '今晚複習你要來嗎？我訂了 205。',
  },
] as const;

export const ORAL_EXAM_MENU = [
  {
    id: 'oral-exam-menu-curry',
    name: '咖哩雞腿飯',
    price: 90,
    note: '可調辣；無花生。示範菜單，不能線上付款。',
    available: true,
  },
  {
    id: 'oral-exam-menu-veg',
    name: '什錦蔬菜飯',
    price: 75,
    note: '全素；含大豆製品。',
    available: true,
  },
  {
    id: 'oral-exam-menu-tea',
    name: '無糖紅茶',
    price: 25,
    note: '冰／熱可選。',
    available: true,
  },
] as const;

export const ORAL_EXAM_ORDERS = [
  {
    id: 'oral-exam-order-1',
    customer: '示範學生王小明',
    items: '咖哩雞腿飯 ×1、無糖紅茶 ×1',
    status: '備餐中',
    pickup: '中餐部窗口 A',
    note: '正式環境未開放線上點餐；此為預先備好的示範訂單。',
  },
  {
    id: 'oral-exam-order-2',
    customer: '示範學生陳雅婷',
    items: '什錦蔬菜飯 ×1',
    status: '可取餐',
    pickup: '中餐部窗口 A',
    note: '示範訂單。',
  },
] as const;

export const ORAL_EXAM_LOST_FOUND = [
  {
    id: 'oral-exam-lf-1',
    type: '拾獲',
    title: '黑色無線耳機盒',
    place: '圖書館 3 樓自修室',
    when: '2026-11-11 16:40',
    status: '待認領',
  },
  {
    id: 'oral-exam-lf-2',
    type: '遺失',
    title: '資管系識別證套',
    place: '學生活動中心',
    when: '2026-11-10 12:10',
    status: '協尋中',
  },
] as const;

export const ORAL_EXAM_AI_CONTEXT = {
  student:
    '示範學生王小明，資管系三年級。今日 08:10 資料結構；作業三鏈結串列 11/14 截止；點名進行中尚未簽到；中餐部有一筆備餐中示範訂單。',
  teacher:
    '示範教師林佳蓉授課資料結構、資料庫系統。成績冊有一份王小明待批改作業；11/12 第 1–2 節點名進行中；一筆 11/13 病假待審。',
  school_admin: '示範大學租戶公告兩則、行事曆三筆。人員名冊僅含標示 demo:true 的口試帳號。',
  merchant: '示範中餐部今日菜單三道；兩筆預先備好的示範訂單。線上點餐旗標為關。',
  ops: '僅能檢視 nuni-oral-exam 租戶。真實學校、真實使用者與正式訂單不在此工作區。',
} as const;

export const ORAL_EXAM_ADMIN_PEOPLE = ORAL_EXAM_ACCOUNTS.map((account) => ({
  name: account.displayName,
  role: account.title,
  demoId: account.demoId,
  scope: 'nuni-oral-exam',
}));

export const ORAL_EXAM_OPS_SNAPSHOT = {
  tenant: ORAL_EXAM_TENANT_ID,
  school: ORAL_EXAM_SCHOOL_NAME,
  taggedDocuments: '僅 demo:true 且 oralExamTag=2026-11-12',
  otherTenantsVisible: false,
  onlineOrdering: false,
  studentIdLogin: false,
  schoolConnections: false,
} as const;

export type OralExamPlayState = {
  assignmentSubmitted: boolean;
  attendanceCheckedIn: boolean;
  leaveRequested: boolean;
  leaveApproved: boolean;
  gradePublished: boolean;
  orderReady: boolean;
  announcementPosted: boolean;
  storyPosted: boolean;
  dmSent: boolean;
  lostFoundClaimed: boolean;
};

export const ORAL_EXAM_PLAY_DEFAULT: OralExamPlayState = {
  assignmentSubmitted: false,
  attendanceCheckedIn: false,
  leaveRequested: false,
  leaveApproved: false,
  gradePublished: false,
  orderReady: false,
  announcementPosted: false,
  storyPosted: false,
  dmSent: false,
  lostFoundClaimed: false,
};

export function emptyOralExamPlayState(): OralExamPlayState {
  return { ...ORAL_EXAM_PLAY_DEFAULT };
}

export type OralExamSeedDocument = {
  path: string;
  data: Record<string, unknown>;
};

export function buildOralExamSeedDocuments(): OralExamSeedDocument[] {
  const stamp = {
    demo: true,
    oralExamTag: ORAL_EXAM_TAG,
    tenantId: ORAL_EXAM_TENANT_ID,
    schoolId: ORAL_EXAM_TENANT_ID,
  };
  const docs: OralExamSeedDocument[] = [
    {
      path: `schools/${ORAL_EXAM_TENANT_ID}`,
      data: {
        ...stamp,
        id: ORAL_EXAM_TENANT_ID,
        name: ORAL_EXAM_SCHOOL_NAME,
        shortName: ORAL_EXAM_SCHOOL_SHORT_NAME,
        directoryVisible: false,
        placeholder: true,
        features: ['announcements', 'events', 'cafeteria', 'lostFound', 'calendar'],
      },
    },
  ];
  for (const item of ORAL_EXAM_ANNOUNCEMENTS) {
    docs.push({
      path: `schools/${ORAL_EXAM_TENANT_ID}/announcements/${item.id}`,
      data: { ...stamp, ...item },
    });
  }
  for (const item of ORAL_EXAM_CALENDAR) {
    docs.push({
      path: `schools/${ORAL_EXAM_TENANT_ID}/events/${item.id}`,
      data: { ...stamp, ...item },
    });
  }
  docs.push({
    path: `cafeterias/oral-exam-cafe-1`,
    data: {
      ...stamp,
      id: 'oral-exam-cafe-1',
      name: '示範中餐部',
      merchantMode: 'info_only',
      orderingEnabled: false,
      reviewStatus: 'demo',
    },
  });
  for (const item of ORAL_EXAM_MENU) {
    docs.push({
      path: `cafeteriaMenus/${item.id}`,
      data: { ...stamp, ...item, cafeteriaId: 'oral-exam-cafe-1' },
    });
  }
  for (const item of ORAL_EXAM_ORDERS) {
    docs.push({
      path: `demoOrders/${item.id}`,
      data: { ...stamp, ...item, cafeteriaId: 'oral-exam-cafe-1' },
    });
  }
  for (const item of ORAL_EXAM_LOST_FOUND) {
    docs.push({
      path: `lostFoundItems/${item.id}`,
      data: { ...stamp, ...item },
    });
  }
  docs.push({
    path: `groups/${ORAL_EXAM_CLUB.id}`,
    data: { ...stamp, ...ORAL_EXAM_CLUB, type: 'club' },
  });
  for (const course of ORAL_EXAM_COURSES) {
    docs.push({
      path: `schools/${ORAL_EXAM_TENANT_ID}/courses/${course.id}`,
      data: { ...stamp, ...course },
    });
  }
  for (const assignment of ORAL_EXAM_ASSIGNMENTS) {
    docs.push({
      path: `schools/${ORAL_EXAM_TENANT_ID}/assignments/${assignment.id}`,
      data: { ...stamp, ...assignment },
    });
  }
  docs.push({
    path: `schools/${ORAL_EXAM_TENANT_ID}/attendance/${ORAL_EXAM_ATTENDANCE.sessionTitle.replace(/\s+/g, '-')}`,
    data: { ...stamp, ...ORAL_EXAM_ATTENDANCE },
  });
  docs.push({
    path: `schools/${ORAL_EXAM_TENANT_ID}/leaveRequests/${ORAL_EXAM_LEAVE.id}`,
    data: { ...stamp, ...ORAL_EXAM_LEAVE },
  });
  for (const account of ORAL_EXAM_ACCOUNTS) {
    docs.push({
      path: `schools/${ORAL_EXAM_TENANT_ID}/demoDirectory/${account.uid}`,
      data: {
        ...stamp,
        uid: account.uid,
        displayName: account.displayName,
        role: account.role,
        demoId: account.demoId,
        email: account.email,
      },
    });
  }
  return docs;
}

export function oralExamSeedSummary(): {
  tenantId: string;
  tag: string;
  documentCount: number;
  paths: string[];
} {
  const documents = buildOralExamSeedDocuments();
  return {
    tenantId: ORAL_EXAM_TENANT_ID,
    tag: ORAL_EXAM_TAG,
    documentCount: documents.length,
    paths: documents.map((doc) => doc.path),
  };
}
