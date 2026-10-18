import {
  applySenseAction,
  emptySenseState,
  parseSenseState,
  selectSenseCards,
  SENSE_EMPTY_TEXT,
  SENSE_HANDLE_PREVIEW,
  undoLastSenseAction,
  type SenseInputItem,
} from '@campus/shared/src/todaySense';

const now = new Date('2026-10-19T05:00:00.000Z');

const overdue: SenseInputItem = {
  id: 'hw-1',
  kind: 'assignment',
  courseId: 'cs101',
  courseName: '資料結構',
  title: '期末報告',
  dueAt: '2026-10-18T16:00:00.000Z',
};

test('triggers from live, overdue and due-soon signals with an explicit why', () => {
  const { cards } = selectSenseCards({
    now,
    state: emptySenseState(),
    items: [
      { ...overdue, id: 'live-1', kind: 'live', title: '課堂點名', dueAt: null },
      overdue,
      {
        ...overdue,
        id: 'soon',
        title: '習題三',
        dueAt: new Date(now.getTime() + 2 * 60 * 60 * 1000).toISOString(),
      },
    ],
  });
  expect(cards.map((card) => card.kind)).toEqual(['live_now', 'overdue', 'due_soon']);
  expect(cards[1].why).toContain('已過截止時間');
  expect(cards[1].why).toContain('台灣時間');
});

test('write-back, preview copy, undo and empty input stay honest', () => {
  const { cards } = selectSenseCards({ now, state: emptySenseState(), items: [overdue] });
  expect(cards[0].actions.find((action) => action.id === 'handle')?.preview).toBe(
    SENSE_HANDLE_PREVIEW,
  );
  const handled = applySenseAction(emptySenseState(), 'handle', cards[0], now);
  expect(selectSenseCards({ now, items: [overdue], state: handled }).cards).toEqual([]);
  const undone = undoLastSenseAction(handled, now);
  expect(undone.ok).toBe(true);
  if (undone.ok) {
    expect(selectSenseCards({ now, items: [overdue], state: undone.state }).cards).toHaveLength(1);
  }
  expect(selectSenseCards({ now, state: emptySenseState(), items: [] }).cards).toEqual([]);
  expect(parseSenseState('{not-json')).toEqual(emptySenseState());
  expect(SENSE_EMPTY_TEXT).toContain('不是範例');
});
