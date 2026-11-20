import { getCrossRoleEffectsForIntent, runAIToolLayer } from '../../services/aiToolLayer';

describe('aiToolLayer assignment planning', () => {
  it('turns the dashboard study prompt into an executable sprint plan', () => {
    const result = runAIToolLayer({
      message: '請依我的作業、測驗、成績趨勢與可用時間，把今天最重要的作業拆成可執行步驟。',
      now: new Date('2026-05-05T08:00:00+08:00'),
      context: {
        schoolId: 'tw-pu',
        role: 'student',
        pendingAssignments: [
          {
            id: 'a-1',
            title: '統計學迴歸作業',
            groupName: '統計學（一）',
            dueAt: '2026-05-06T20:00:00+08:00',
          },
        ],
        gradesSummary: {
          courses: [{ name: '統計學（一）', grade: 72, credits: 3 }],
        },
      },
    });

    expect(result.handled).toBe(true);
    expect(result.intent).toBe('assignment_lookup');
    expect(result.answer).toContain('統計學迴歸作業');
    expect(result.answer).toContain('今天可執行步驟');
    expect(result.answer).toContain('成績線索');
  });

  it('does not claim there is no homework when assignment data is unavailable', () => {
    const result = runAIToolLayer({
      message: '今天最重要的作業幫我拆步驟',
      context: { schoolId: 'tw-pu', role: 'student', pendingAssignments: [] },
    });

    expect(result.handled).toBe(true);
    expect(result.answer).toContain('沒有拿到可驗證');
    expect(result.answer).not.toContain('目前沒有查到待繳作業');
  });
});

describe('aiToolLayer dorm repair copy', () => {
  it('does not claim the app files an official repair or work order', () => {
    const effects = getCrossRoleEffectsForIntent({
      role: 'student',
      intent: 'repair_status',
      message: '宿舍冷氣壞了幫我報修',
    });
    const blob = JSON.stringify(effects);
    expect(blob).toContain('報修備忘');
    expect(blob).toContain('學校管道');
    expect(blob).not.toMatch(/才能正式送出|提交報修|送出報修|工單|叫工人/);

    const result = runAIToolLayer({
      message: '宿舍冷氣壞了幫我報修',
      context: { schoolId: 'tw-pu', role: 'student', repairRequests: [] },
    });
    expect(result.answer).toContain('報修備忘');
    expect(result.answer).not.toMatch(/報修案件|工單|單號/);
  });
});
