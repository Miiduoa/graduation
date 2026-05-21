import { DEMO_EXAM_BENTO_MERCHANT_ID } from '../../data/demoMerchants';
import { buildAIAppContext, emptyAIAppRuntimeData } from '../../services/aiAppContext';
import {
  buildDemoAIAppDataRecords,
  enrichDemoAIAppRuntimeData,
  resolveEffectiveDemoAIUser,
} from '../../services/demoAiContext';

const DEMO_UIDS = [
  'demo_student_kuchih',
  'demo_teacher_chang',
  'demo_ta_lin',
  'demo_admin_huang',
  'demo_admin_sys',
  'demo_club_wei',
  'demo_cafeteria',
  'demo_alumni_chang',
  'demo_guest',
];

describe('demo AI role context', () => {
  it.each(DEMO_UIDS)('%s exposes role records to the AI assistant', (uid) => {
    const records = buildDemoAIAppDataRecords(uid);
    const allText = records.map((record) => `${record.label}\n${record.text}`).join('\n');

    expect(records.some((record) => record.key === 'demo_persona')).toBe(true);
    expect(records.some((record) => record.key === 'demo_menu')).toBe(true);
    expect(allText).toContain('口試 Demo 便當店');
  });

  it('buildAIAppContext seeds student courses, assignments, life data, and dining data', () => {
    const context = buildAIAppContext({
      schoolId: 'pu',
      userId: 'demo_student_kuchih',
      role: 'student',
      runtimeData: emptyAIAppRuntimeData(),
    });
    const recordText = context.appDataRecords?.map((record) => record.text).join('\n') ?? '';

    expect(context.userName).toBe('顧晉瑋');
    expect(context.courses?.length).toBeGreaterThanOrEqual(5);
    expect(context.pendingAssignments?.length).toBeGreaterThan(0);
    expect(context.menus?.some((menu) => menu.cafeteria === '口試 Demo 便當店')).toBe(true);
    expect(recordText).toContain('宜真樓');
    expect(recordText).toContain('深入淺出資料庫設計');
    expect(recordText).toContain('PU-M-2025-887');
    expect(recordText).toContain('中央健保署');
  });

  it('splits demo life data into searchable records for role-specific questions', () => {
    const studentRecords = buildDemoAIAppDataRecords('demo_student_kuchih');
    const teacherRecords = buildDemoAIAppDataRecords('demo_teacher_chang');
    const vendorRecords = buildDemoAIAppDataRecords('demo_cafeteria');

    expect(studentRecords.some((record) => record.key === 'demo_life_library')).toBe(true);
    expect(studentRecords.some((record) => record.key === 'demo_life_parking')).toBe(true);
    expect(studentRecords.map((record) => record.text).join('\n')).toContain('Clean Architecture');
    expect(teacherRecords.some((record) => record.key === 'demo_life_office')).toBe(true);
    expect(teacherRecords.map((record) => record.text).join('\n')).toContain('officeHours');
    expect(vendorRecords.some((record) => record.key === 'demo_life_merchant_contract')).toBe(true);
    expect(vendorRecords.map((record) => record.text).join('\n')).toContain('口試 Demo 便當店');
  });

  it('keeps non-course demo roles isolated while still providing public dining data', () => {
    for (const uid of ['demo_cafeteria', 'demo_alumni_chang', 'demo_guest']) {
      const context = buildAIAppContext({
        schoolId: 'pu',
        userId: uid,
        runtimeData: emptyAIAppRuntimeData(),
      });

      expect(context.courses).toEqual([]);
      expect(context.menus?.some((menu) => menu.cafeteria === '口試 Demo 便當店')).toBe(true);
    }
  });

  it('enriches vendor runtime data with assigned merchant orders', async () => {
    const data = await enrichDemoAIAppRuntimeData(emptyAIAppRuntimeData(), 'demo_cafeteria');
    const orderText = JSON.stringify(data.orders);

    expect(data.orders.length).toBeGreaterThan(0);
    expect(orderText).toContain(DEMO_EXAM_BENTO_MERCHANT_ID);
    expect(orderText).toContain('顧晉瑋');
    expect(data.notifications.length).toBeGreaterThan(0);
    expect(data.conversations.length).toBeGreaterThan(0);
  });

  it('resolves demo role identities even without a Firebase auth user', () => {
    const teacher = resolveEffectiveDemoAIUser({ demoRole: 'teacher' });
    expect(teacher.uid).toBe('demo_teacher_chang');
    expect(teacher.signedInForAI).toBe(true);
    expect(teacher.agentRole).toBe('faculty');
    expect(teacher.campusRole).toBe('teacher');
    expect(teacher.appContextRole).toBe('faculty');

    const ta = resolveEffectiveDemoAIUser({ demoRole: 'ta' });
    expect(ta.uid).toBe('demo_ta_lin');
    expect(ta.agentRole).toBe('faculty');
    expect(ta.campusRole).toBe('teacher');

    const vendor = resolveEffectiveDemoAIUser({ demoRole: 'vendor' });
    expect(vendor.uid).toBe('demo_cafeteria');
    expect(vendor.agentRole).toBe('vendor');
    expect(vendor.campusRole).toBe('vendor');
    expect(vendor.appContextRole).toBe('vendor');

    const guest = resolveEffectiveDemoAIUser({ demoRole: 'guest' });
    expect(guest.uid).toBe('demo_guest');
    expect(guest.signedInForAI).toBe(true);
    expect(guest.agentRole).toBe('guest');
    expect(guest.appContextRole).toBe('guest');

    const alumni = resolveEffectiveDemoAIUser({ demoRole: 'alumni' });
    expect(alumni.uid).toBe('demo_alumni_chang');
    expect(alumni.agentRole).toBe('alumni');
    expect(alumni.appContextRole).toBe('guest');
  });

  it('does not replace a real authenticated user with the stored demo role fallback', () => {
    const real = resolveEffectiveDemoAIUser({
      profile: {
        uid: 'real-user-1',
        role: 'student',
        displayName: '真實學生',
        schoolId: 'pu',
      },
      demoRole: 'guest',
    });

    expect(real.uid).toBe('real-user-1');
    expect(real.displayName).toBe('真實學生');
    expect(real.isDemo).toBe(false);
    expect(real.appContextRole).toBe('student');
  });
});
