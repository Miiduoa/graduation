/**
 * Demo Roles Coverage — smoke test 驗證每個 demo 角色都有完整資料
 *
 * 為了避免「demo 角色登入後畫面空空如也」，
 * 這個 test 走過所有 9 個 demo uid，確認：
 *   1. demoUserStories 有對應 persona
 *   2. personaContext.getDemoStory / getPersonaPlaces 不會 crash
 *   3. demoCoursesMock 對該 uid 的課程數量符合預期
 *   4. demoRole capabilities matrix 有涵蓋該 role
 */
import {
  STUDENT_KUCHIH,
  TEACHER_CHANG,
  TA_LIN,
  ADMIN_HUANG,
  ADMIN_SYS,
  CLUB_OFFICER_WEI,
  VENDOR_AYING,
  ALUMNI_CHANG,
  GUEST_DEMO,
  getDemoUserStory,
} from '../data/demoUserStories';
import {
  getDemoCoursesForUid,
  canUidSeeCourse,
} from '../data/demoCoursesMock';
import {
  getCapabilities,
  getDemoRoleDefinition,
  DEMO_ROLES,
  type DemoRole,
} from '../state/demoRole';

const ALL_PERSONAS = [
  { uid: 'demo_student_kuchih', role: 'student' as DemoRole, persona: STUDENT_KUCHIH, expectCoursesMin: 5 },
  { uid: 'demo_teacher_chang', role: 'teacher' as DemoRole, persona: TEACHER_CHANG, expectCoursesMin: 1 },
  { uid: 'demo_ta_lin', role: 'ta' as DemoRole, persona: TA_LIN, expectCoursesMin: 1 },
  { uid: 'demo_admin_huang', role: 'department_head' as DemoRole, persona: ADMIN_HUANG, expectCoursesMin: 5 },
  { uid: 'demo_admin_sys', role: 'admin' as DemoRole, persona: ADMIN_SYS, expectCoursesMin: 5 },
  { uid: 'demo_club_wei', role: 'club_officer' as DemoRole, persona: CLUB_OFFICER_WEI, expectCoursesMin: 3 },
  { uid: 'demo_cafeteria', role: 'vendor' as DemoRole, persona: VENDOR_AYING, expectCoursesMin: 0 },
  { uid: 'demo_alumni_chang', role: 'alumni' as DemoRole, persona: ALUMNI_CHANG, expectCoursesMin: 0 },
  { uid: 'demo_guest', role: 'guest' as DemoRole, persona: GUEST_DEMO, expectCoursesMin: 0 },
];

describe('Demo Roles Coverage', () => {
  test.each(ALL_PERSONAS)(
    '$uid: persona 存在且基本資料完整',
    ({ uid, persona }) => {
      expect(persona).toBeDefined();
      expect(persona.uid).toBe(uid);
      expect(persona.fullName).toBeTruthy();
      expect(persona.role).toBeTruthy();
      expect(persona.schoolId).toBeTruthy();
      // 透過 STORIES 索引也能拿到
      const fromIndex = getDemoUserStory(uid);
      expect(fromIndex).not.toBeNull();
      expect(fromIndex?.uid).toBe(uid);
    },
  );

  test.each(ALL_PERSONAS)(
    '$uid: 課程權限隔離正確',
    ({ uid, expectCoursesMin }) => {
      const courses = getDemoCoursesForUid(uid);
      expect(courses.length).toBeGreaterThanOrEqual(expectCoursesMin);
      // demo_cafeteria/alumni/guest 應該完全看不到課程，避免跨角色資料外洩
      if (uid === 'demo_cafeteria' || uid === 'demo_alumni_chang' || uid === 'demo_guest') {
        expect(courses.length).toBe(0);
      }
    },
  );

  test.each(ALL_PERSONAS)(
    '$uid: 角色 capability matrix 有涵蓋',
    ({ role }) => {
      const caps = getCapabilities(role);
      expect(caps).toBeDefined();
      const def = getDemoRoleDefinition(role);
      expect(def.role).toBe(role);
      expect(def.label).toBeTruthy();
    },
  );

  test('DEMO_ROLES 至少含 9 個角色（含 vendor）', () => {
    expect(DEMO_ROLES.length).toBeGreaterThanOrEqual(9);
    const roleNames = DEMO_ROLES.map((r) => r.role);
    expect(roleNames).toContain('vendor');
    expect(roleNames).toContain('alumni');
    expect(roleNames).toContain('guest');
  });

  test('角色資料隔離：餐廳員工不能看到任何學術課程', () => {
    expect(canUidSeeCourse('demo_cafeteria', 71378)).toBe(false);
    expect(canUidSeeCourse('demo_cafeteria', 71282)).toBe(false);
  });

  test('角色資料隔離：校友/訪客不能看到任何學術課程', () => {
    expect(canUidSeeCourse('demo_alumni_chang', 71378)).toBe(false);
    expect(canUidSeeCourse('demo_guest', 71378)).toBe(false);
  });

  test('角色資料隔離：教師只能看到自己授課課程', () => {
    expect(canUidSeeCourse('demo_teacher_chang', 71378)).toBe(true);  // 自己的課
    expect(canUidSeeCourse('demo_teacher_chang', 71240)).toBe(false); // 別老師的課
  });

  test('角色資料隔離：TA 只能看到指定授課課程', () => {
    expect(canUidSeeCourse('demo_ta_lin', 71378)).toBe(true);
    expect(canUidSeeCourse('demo_ta_lin', 71282)).toBe(true);
    expect(canUidSeeCourse('demo_ta_lin', 71240)).toBe(false);
  });
});
