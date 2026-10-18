import { describe, expect, it } from 'vitest';
import {
  applySenseAction,
  DUE_SOON_MS,
  emptySenseState,
  formatSenseRecord,
  parseSenseState,
  selectSenseCards,
  SENSE_EMPTY_TEXT,
  SENSE_HANDLE_PREVIEW,
  SENSE_SNOOZE_PREVIEW,
  SENSE_UNSIGNED_TEXT,
  senseStorageKey,
  SNOOZE_MS,
  undoLastSenseAction,
  type SenseInputItem,
} from '@campus/shared/src/todaySense';

const now = new Date('2026-10-19T05:00:00.000Z');

function item(overrides: Partial<SenseInputItem> = {}): SenseInputItem {
  return {
    id: 'hw-1',
    kind: 'assignment',
    courseId: 'cs101',
    courseName: '資料結構',
    title: '期末報告',
    dueAt: '2026-10-18T16:00:00.000Z',
    href: '/course/cs101#assignment-hw-1',
    ...overrides,
  };
}

describe('感知觸發條件', () => {
  it('進行中點名、已過截止、24 小時內截止會出卡，並寫明依據與觸發時間', () => {
    const { cards } = selectSenseCards({
      now,
      state: emptySenseState(),
      items: [
        item({ id: 'live-1', kind: 'live', title: '課堂點名', dueAt: null }),
        item({ id: 'late', title: '期末報告', dueAt: '2026-10-18T16:00:00.000Z' }),
        item({
          id: 'soon',
          title: '習題三',
          dueAt: new Date(now.getTime() + 2 * 60 * 60 * 1000).toISOString(),
        }),
        item({
          id: 'later',
          title: '遠期作業',
          dueAt: new Date(now.getTime() + DUE_SOON_MS + 60_000).toISOString(),
        }),
      ],
    });
    expect(cards.map((card) => card.kind)).toEqual(['live_now', 'overdue', 'due_soon']);
    expect(cards[0].why).toContain('進行中的點名時段');
    expect(cards[0].why).toContain('台灣時間');
    expect(cards[1].why).toContain('已過截止時間');
    expect(cards[2].why).toContain('24 小時內截止');
    expect(cards.some((card) => card.title === '遠期作業')).toBe(false);
  });

  it('沒有符合規則的資料時是空清單，不是範例卡', () => {
    const { cards } = selectSenseCards({ now, state: emptySenseState(), items: [] });
    expect(cards).toEqual([]);
    expect(SENSE_EMPTY_TEXT).toContain('不是範例');
    expect(SENSE_UNSIGNED_TEXT).toContain('登入後');
  });
});

describe('預覽、寫回與撤銷', () => {
  it('移出與稍後都先有預覽文案，確認後才改本機狀態且可撤銷', () => {
    const { cards } = selectSenseCards({
      now,
      state: emptySenseState(),
      items: [item()],
    });
    const card = cards[0];
    expect(card.actions.find((action) => action.id === 'handle')?.preview).toBe(
      SENSE_HANDLE_PREVIEW,
    );
    expect(card.actions.find((action) => action.id === 'snooze')?.preview).toBe(
      SENSE_SNOOZE_PREVIEW,
    );

    const handled = applySenseAction(emptySenseState(), 'handle', card, now);
    expect(handled.handled[card.id]?.at).toBe(now.toISOString());
    expect(handled.lastRecord?.reversible).toBe(true);
    expect(formatSenseRecord(handled.lastRecord)).toContain('可撤銷');
    expect(selectSenseCards({ now, items: [item()], state: handled }).cards).toEqual([]);

    const undone = undoLastSenseAction(handled, new Date(now.getTime() + 1000));
    expect(undone.ok).toBe(true);
    if (!undone.ok) return;
    expect(selectSenseCards({ now, items: [item()], state: undone.state }).cards).toHaveLength(1);
    expect(undone.state.lastRecord?.reversible).toBe(false);
    expect(undoLastSenseAction(undone.state, now).ok).toBe(false);

    const snoozed = applySenseAction(emptySenseState(), 'snooze', card, now);
    const duringSnooze = new Date(now.getTime() + SNOOZE_MS - 1000);
    const afterSnooze = new Date(now.getTime() + SNOOZE_MS + 1000);
    expect(selectSenseCards({ now: duringSnooze, items: [item()], state: snoozed }).cards).toEqual(
      [],
    );
    expect(
      selectSenseCards({ now: afterSnooze, items: [item()], state: snoozed }).cards,
    ).toHaveLength(1);
  });

  it('壞掉的儲存內容當成空狀態，鍵值跟帳號走', () => {
    expect(parseSenseState('{')).toEqual(emptySenseState());
    expect(parseSenseState('{"version":2}')).toEqual(emptySenseState());
    expect(senseStorageKey('alice', 'pu')).toContain('todaySense');
    expect(senseStorageKey('alice', 'pu')).toContain('u:alice');
    expect(senseStorageKey('alice', 'pu')).not.toBe(senseStorageKey('bob', 'pu'));
  });
});
