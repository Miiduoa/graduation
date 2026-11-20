/* eslint-disable @typescript-eslint/no-explicit-any */

jest.mock('../../firebase', () => ({
  getFirebaseApp: jest.fn(() => ({})),
  hasUsableFirebaseConfig: jest.fn(() => false),
}));

import { mockSource } from '../../data/mockSource';
import { setDataSource } from '../../data/source';
import { autonomousQuery, type AgentQueryResult, resetAdaptiveLearnedPatternsForTests } from '../../services/aiLocalAgent';

const STUDENT_CTX = {
  userId: 'wide-coverage-user',
  schoolId: 'pu',
  role: 'student' as const,
  isOnline: true,
};

const TEACHER_CTX = {
  ...STUDENT_CTX,
  userId: 'wide-coverage-teacher',
  role: 'teacher' as const,
};

const ADMIN_CTX = {
  ...STUDENT_CTX,
  userId: 'wide-coverage-admin',
  role: 'admin' as const,
};

beforeEach(() => {
  resetAdaptiveLearnedPatternsForTests();
});

function observedTools(result: AgentQueryResult): Set<string> {
  return new Set([
    ...result.intents.map((i) => i.tool),
    ...result.results.map((r) => r.tool),
    ...result.executedActions.map((a) => a.tool),
    ...result.failedActions.map((a) => a.tool),
  ]);
}

async function expectRoutes(message: string, tools: string[], ctx = STUDENT_CTX): Promise<void> {
  const result = await autonomousQuery(message, ctx);
  const seen = observedTools(result);
  for (const tool of tools) {
    expect(seen.has(tool)).toBe(true);
  }
}

describe('AI 代理廣泛情境覆蓋', () => {
  beforeEach(() => {
    setDataSource(mockSource as any);
  });

  it.each([
    ['下一堂課到底在哪我快迷路了', ['query_courses']],
    ['期末成績到底出來沒啊', ['query_grades']],
    ['deadline 全部列出來我腦袋空白', ['query_assignments']],
    ['期中考時間到底是哪天', ['query_exams']],
    ['這門課成績比例到底怎麼算分', ['query_score_items']],
    ['討論區最近有沒有新貼文', ['query_discussions']],
    ['老師上傳的 PPT 跟講義在哪', ['query_materials']],
    ['這堂課助教名單有嗎', ['query_course_members']],
    ['作業詳情跟提交紀錄幫我看一下', ['query_homework_detail']],
    ['老師公告是不是又發新的', ['query_course_announcements']],
    ['到底哪堂課最會點名', ['query_courses', 'query_attendance']],
    ['我是幾年級哪個系啊', ['query_student_info']],
    ['學分還差多少才能畢業', ['analyze_credits']],
    ['我這樣會不會被二一', ['predict_gpa']],
    ['颱風停課公告有出來嗎', ['query_announcements']],
    ['校慶有什麼活動不無聊', ['query_events']],
    ['雞腿飯是啥有沒有賣', ['query_menus']],
    ['餓到不行但我選擇困難', ['recommend_lunch']],
    ['圖書館座位現在有空嗎', ['query_library']],
    ['校車現在要等多久', ['query_bus']],
    ['未讀通知先撈出來', ['query_notifications']],
    ['今天下午行程幫我瞄一下', ['query_calendar']],
    ['剛剛誰一直密我', ['query_conversations']],
    ['口袋還剩多少錢', ['query_orders']],
    ['洗衣機現在有空嗎', ['query_dorm_info']],
    ['健康紀錄跟掛號紀錄幫我查', ['query_health_records']],
    ['借的書過期了沒', ['query_loans']],
    ['退選紀錄幫我看', ['query_enrollments']],
    ['我現在整體狀態怎麼樣', ['comprehensive_analysis']],
    ['今日懶人包直接給我', ['daily_briefing']],
    ['你到底會幹嘛', ['assistant_help']],
  ])('read routes: %s', async (message, tools) => {
    await expectRoutes(message, tools);
  });

  it.each([
    ['通知小敏明天會議改 10 點', ['send_message']],
    ['幫我加一個明天晚上讀書計畫到行事曆', ['create_calendar_event']],
    ['幫我報名校慶活動', ['register_event']],
    ['幫我 book 一下圖書館位子', ['reserve_library_seat']],
    ['幫我借《人工智慧》這本書', ['borrow_book']],
    ['幫我續借快到期的書', ['renew_book']],
    ['通知全部標成已讀', ['mark_notifications_read']],
    ['宿舍冷氣壞掉了幫我報修', ['create_repair_request']],
    ['幫我繳交作業', ['submit_assignment']],
    ['我要選資料結構這門課', ['enroll_course']],
    ['我要退選資料結構', ['drop_course']],
    ['取消圖書館座位預約', ['cancel_seat_reservation']],
    ['幫我還書', ['return_book']],
    ['取消報名校慶活動', ['unregister_event']],
    ['我要幫今天的微積分課簽到', ['check_in_attendance']],
    ['身體不太舒服想掛個號', ['create_health_appointment']],
    ['我要預約洗衣機', ['reserve_washing_machine']],
    ['I lost my wallet 在圖書館附近', ['create_lost_found']],
    ['加入讀書會 ABC123', ['join_group']],
    ['在讀書會 ABC123 發文說有人要一起刷題嗎', ['create_group_post']],
    ['我已經領包裹了幫我確認', ['confirm_package_pickup']],
    ['幫我請病假', ['request_leave']],
    ['幫我訂午餐', ['create_order']],
    ['取消最後一筆訂單', ['cancel_order']],
    ['幫我印一下期中報告.pdf 黑白兩份', ['create_print_job']],
    ['這個雞腿飯給五分', ['rate_menu_item']],
    ['修改行程讀書計畫到明天晚上', ['update_calendar_event']],
    ['刪除行程讀書計畫', ['delete_calendar_event']],
  ])('write routes: %s', async (message, tools) => {
    await expectRoutes(message, tools);
  });

  it.each([
    ['開始這堂課點名', ['start_attendance'], TEACHER_CTX],
    ['建立作業 HW1 明天截止', ['create_assignment'], TEACHER_CTX],
    ['批改學生作業給 90 分', ['grade_submission'], TEACHER_CTX],
    ['發布公告「停課提醒」明天全校停課', ['create_announcement'], ADMIN_CTX],
  ])('privileged routes: %s', async (message, tools, ctx) => {
    await expectRoutes(message, tools, ctx);
  });

  it('學生身分不可直接使用教師/管理者代理工具', async () => {
    const result = await autonomousQuery('發布公告「停課提醒」明天全校停課', STUDENT_CTX);
    const seen = observedTools(result);

    expect(seen.has('create_announcement')).toBe(false);
    expect(result.executedActions.some((a) => a.tool === 'create_announcement')).toBe(false);
  });

  it('查退選紀錄只能查詢，不可真的退選', async () => {
    const result = await autonomousQuery('退選紀錄幫我看', STUDENT_CTX);

    expect(result.results.some((r) => r.tool === 'query_enrollments')).toBe(true);
    expect(result.executedActions.some((a) => a.tool === 'drop_course')).toBe(false);
  });

  it('明確退選時不可同時誤判成選課', async () => {
    const result = await autonomousQuery('我要退選資料結構', STUDENT_CTX);

    expect(observedTools(result).has('drop_course')).toBe(true);
    expect(result.executedActions.some((a) => a.tool === 'enroll_course')).toBe(false);
  });

  it('通知全部已讀不可誤發訊息給「全部」', async () => {
    const result = await autonomousQuery('通知全部標成已讀', STUDENT_CTX);

    expect(observedTools(result).has('mark_notifications_read')).toBe(true);
    expect(result.executedActions.some((a) => a.tool === 'send_message')).toBe(false);
  });
});
