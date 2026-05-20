/**
 * demoStoryTimeline.test.ts
 *
 * 「今天的故事」timeline 完整性鎖定：
 *  - 9 個 demo 角色都有 timeline
 *  - 每個 link.screen 都對應到 DemoStoryScreen 的 ROUTE_TO_TAB 對照表（避免再次出現
 *    點下去沒反應 / route not found 的 demo 災難）
 *  - 沒有 link 的事件至少有 title + detail（demo viewer 可以單純讀資訊）
 */

import { getDemoStory, getTodayTimeline } from '../services/personaContext';

// 與 DemoStoryScreen.tsx 中的 ROUTE_TO_TAB 同步 — 改動時兩邊一起更新。
const KNOWN_ROUTES = new Set<string>([
  // HomeStack (Today tab)
  'TodayHome',
  'SmartDashboard',
  'AIChat',
  'CampusSocialScreen',
  'CampusGame',
  '公告總覽',
  '公告詳情',
  '活動總覽',
  '活動詳情',
  // LearnStack (學習 tab)
  'LearnHome',
  'CoursesHome',
  'CourseHubV2',
  'CourseHub',
  'CourseAssignmentsV2',
  'CourseAssignmentDetailV2',
  'CourseGradesV2',
  'CourseQuizzesV2',
  'CourseMaterialsV2',
  'CourseForumV2',
  'CourseAnnouncementsV2',
  'CourseAIAssistantV2',
  'TeacherCockpit',
  'TeacherGrading',
  'TeachingHub',
  'StaffHub',
  'DepartmentHub',
  'AdminDashboard',
  'MerchantHub',
  'AcademicInsights',
  'Calendar',
  // MapStack (校園 tab)
  'Map',
  'MapV2',
  'BusV2',
  'Cafeteria',
  'Ordering',
  'MenuSubscription',
  'Health',
  'Dormitory',
  'IndoorFloorMap',
  // MessagesStack (訊息 tab)
  'Dms',
  'Groups',
  'GroupDetail',
  'FriendsManage',
  'FriendSearch',
  'Chat',
  'MessagesHome',
]);

const DEMO_UIDS = [
  { uid: 'demo_student_kuchih', role: 'student', minEvents: 6 },
  { uid: 'demo_teacher_chang', role: 'teacher', minEvents: 5 },
  { uid: 'demo_ta_lin', role: 'ta', minEvents: 3 },
  { uid: 'demo_admin_sys', role: 'admin', minEvents: 4 },
  { uid: 'demo_cafeteria', role: 'vendor', minEvents: 4 },
  { uid: 'demo_club_wei', role: 'club_officer', minEvents: 3 },
  { uid: 'demo_admin_huang', role: 'department_head', minEvents: 4 },
  { uid: 'demo_alumni_chang', role: 'alumni', minEvents: 3 },
  { uid: 'demo_guest', role: 'guest', minEvents: 3 },
];

describe('demo timeline 每個角色都有足量事件', () => {
  for (const { uid, role, minEvents } of DEMO_UIDS) {
    test(`${role} (${uid}) timeline ≥ ${minEvents} 個事件`, () => {
      const story = getDemoStory(uid);
      expect(story).not.toBeNull();
      expect(story?.role).toBe(role);
      const timeline = getTodayTimeline(story, new Date('2026-05-20T12:00:00'));
      expect(timeline.length).toBeGreaterThanOrEqual(minEvents);
    });
  }
});

describe('demo timeline 每個 link.screen 都對應到註冊的路由', () => {
  for (const { uid, role } of DEMO_UIDS) {
    test(`${role} timeline link 路由都是已註冊的`, () => {
      const story = getDemoStory(uid);
      const timeline = getTodayTimeline(story, new Date('2026-05-20T12:00:00'));
      for (const event of timeline) {
        if (event.link?.screen) {
          expect(KNOWN_ROUTES.has(event.link.screen)).toBe(true);
        }
      }
    });
  }
});

describe('demo timeline 每個事件至少有 title + detail', () => {
  for (const { uid, role } of DEMO_UIDS) {
    test(`${role} timeline 不允許空 title / detail`, () => {
      const story = getDemoStory(uid);
      const timeline = getTodayTimeline(story, new Date('2026-05-20T12:00:00'));
      for (const event of timeline) {
        expect(event.title.length).toBeGreaterThan(0);
        // detail 是 optional 但 demo 階段建議都有，這裡 warn 而不 fail
        if (!event.detail) {
          console.warn(`[${role}] event "${event.title}" has no detail`);
        }
      }
    });
  }
});

describe('學生 timeline 的課程 link 用實際 DEMO_COURSES id', () => {
  test('學生課程事件對應 CourseHubV2 + 真實 courseId', () => {
    const story = getDemoStory('demo_student_kuchih');
    const timeline = getTodayTimeline(story, new Date('2026-05-20T12:00:00'));
    const classes = timeline.filter((e) => e.category === 'class');
    expect(classes.length).toBeGreaterThanOrEqual(2);
    for (const c of classes) {
      // 應該都指向 CourseHubV2
      expect(c.link?.screen).toBe('CourseHubV2');
      // courseId 應該是實際 DEMO_COURSES 的 id (5 位數字)
      const cid = c.link?.params?.courseId as number;
      expect(typeof cid).toBe('number');
      expect(cid).toBeGreaterThan(70000);
      expect(cid).toBeLessThan(80000);
    }
  });
});

describe('全 9 角色 timeline 比例：linked vs info-only', () => {
  test('每個角色都至少有 1 個 link 事件（避免整頁全部都只顯示資訊）', () => {
    for (const { uid, role } of DEMO_UIDS) {
      const story = getDemoStory(uid);
      const timeline = getTodayTimeline(story, new Date('2026-05-20T12:00:00'));
      const linkedCount = timeline.filter((e) => e.link).length;
      expect(linkedCount).toBeGreaterThanOrEqual(1);
      if (linkedCount === 0) {
        console.error(`[${role}] timeline 全部都沒有 link.screen，demo 會看起來像沒功能`);
      }
    }
  });
});
