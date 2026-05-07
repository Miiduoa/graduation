import { getToolById, matchTaskChain } from '../../data/puAIAgentData';

describe('offline agent routing', () => {
  it('routes broad student requests into task chains', () => {
    expect(matchTaskChain('我頭痛很不舒服')?.id).toBe('sick_day');
    expect(matchTaskChain('幫我訂午餐')?.id).toBe('lunch_order');
    expect(matchTaskChain('我要讀書準備考試')?.id).toBe('study_session');
    expect(matchTaskChain('宿舍冷氣壞了幫我報修')?.id).toBe('dorm_issue');
  });

  it('keeps action tools parameterized instead of plain Q&A', () => {
    expect(getToolById('order_meal')?.requiresConfirmation).toBe(true);
    expect(getToolById('set_reminder')?.requiresConfirmation).toBe(true);
    expect(getToolById('send_message')?.requiresConfirmation).toBe(true);
    expect(getToolById('request_leave')?.requiresConfirmation).toBe(true);
    expect(
      getToolById('report_repair')?.parameters.some((p) => p.name === 'room' && p.required),
    ).toBe(true);
    expect(
      getToolById('reserve_seat')?.parameters.some((p) => p.name === 'time_slot' && p.required),
    ).toBe(true);
  });
});
