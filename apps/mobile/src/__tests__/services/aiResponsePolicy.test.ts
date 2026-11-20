import { runAIToolLayer } from '../../services/aiToolLayer';
import { shouldUseInstantToolLayerAnswer } from '../../services/aiResponsePolicy';

describe('aiResponsePolicy', () => {
  it('answers demo data lookup instantly when tool layer has enough local context', () => {
    const context = {
      schoolId: 'pu',
      userId: 'demo_student_kuchih',
      role: 'student' as const,
      appDataRecords: [
        {
          key: 'demo_persona',
          label: 'Demo 角色',
          text: '顧晉瑋，資訊管理學系學生',
          priority: 100,
        },
      ],
    };
    const result = runAIToolLayer({
      message: '查一下我的資料',
      context,
    });

    expect(result.handled).toBe(true);
    expect(shouldUseInstantToolLayerAnswer({ mode: 'auto', message: '查一下我的資料', result, context })).toBe(true);
  });

  it('keeps deep analysis and write intents on the thinking path', () => {
    const context = {
      schoolId: 'pu',
      userId: 'demo_student_kuchih',
      role: 'student' as const,
      appDataRecords: [{ key: 'demo', label: 'demo', text: '資料', priority: 1 }],
    };
    const dataResult = runAIToolLayer({ message: '深入分析我的目前狀態', context });
    const orderResult = runAIToolLayer({ message: '幫我點雞腿便當', context });

    expect(shouldUseInstantToolLayerAnswer({ mode: 'auto', message: '深入分析我的目前狀態', result: dataResult, context })).toBe(false);
    expect(shouldUseInstantToolLayerAnswer({ mode: 'auto', message: '幫我點雞腿便當', result: orderResult, context })).toBe(false);
  });
});
