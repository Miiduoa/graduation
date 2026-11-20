import { getToolById, matchTaskChain } from '../../data/puAIAgentData';

describe('offline agent routing', () => {
  it('routes broad student requests into task chains', () => {
    expect(matchTaskChain('我頭痛很不舒服')?.id).toBe('sick_day');
    expect(matchTaskChain('幫我訂午餐')?.id).toBe('lunch_order');
    expect(matchTaskChain('我要讀書準備考試')?.id).toBe('study_session');
    const dorm = matchTaskChain('宿舍冷氣壞了幫我報修');
    expect(dorm?.id).toBe('dorm_issue');
    expect(dorm?.description).toContain('報修備忘');
    expect(dorm?.description).not.toMatch(/工單|已提交報修|追蹤進度/);
    expect(dorm?.steps[0]?.label).toBe('存成報修備忘');
  });

  it('keeps action tools parameterized instead of plain Q&A', () => {
    expect(getToolById('order_meal')?.requiresConfirmation).toBe(true);
    expect(getToolById('set_reminder')?.requiresConfirmation).toBe(true);
    expect(getToolById('send_message')?.requiresConfirmation).toBe(true);
    expect(getToolById('request_leave')?.requiresConfirmation).toBe(true);
    expect(getToolById('report_repair')?.description).toContain('報修備忘');
    expect(getToolById('report_repair')?.description).not.toMatch(/工單|已提交報修/);
    expect(getToolById('report_repair')?.estimatedDuration).toBe('即時存成備忘，不會送到學校');
    expect(getToolById('report_repair')?.estimatedDuration).not.toMatch(/即時提交|1-3 天處理/);
    expect(getToolById('report_repair')?.parameters.find((p) => p.name === 'description')?.hint)
      .toBe('請寫清楚地點與狀況，方便你之後向學校通報');
    expect(
      getToolById('report_repair')?.parameters.some((p) => p.name === 'room' && p.required),
    ).toBe(true);
    expect(
      getToolById('reserve_seat')?.parameters.some((p) => p.name === 'time_slot' && p.required),
    ).toBe(true);
  });
});
