import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';
import { CampusPlanComparisonCard } from '../screens/CampusPlanComparisonCard';
import type { CampusPlanComparison } from '../services/campusPlanComparison';

jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));

const LONG_TITLE = '資料庫系統期末專題：跨校資料交換、課程整合與權限隔離的完整驗證報告';

function comparison(overrides: Partial<CampusPlanComparison> = {}): CampusPlanComparison {
  return {
    previousCheckedAt: '2026-11-06T15:58:00.000Z',
    currentCheckedAt: '2026-11-06T16:05:00.000Z',
    comparableDates: 2,
    unchangedAssignments: 1,
    limitations: ['僅核對兩次計畫都有的日期與可辨識作業，未列出不代表已繳交。'],
    changes: [{
      id: 'deadline-change', category: 'assignment', kind: 'changed', title: LONG_TITLE,
      before: '11/8 23:59 截止', after: '11/7 18:00 截止',
      detail: '截止時間提早了，請到課程頁確認最新繳交要求。', route: '/classroom',
    }],
    ...overrides,
  };
}

function manyChanges(): CampusPlanComparison {
  return comparison({
    changes: Array.from({ length: 7 }, (_, index) => ({
      id: 'change-' + index, category: 'timetable', kind: 'changed',
      title: '課表調整 ' + (index + 1), before: '第 3–4 節', after: '第 5–6 節',
      detail: '請核對課程頁的正式上課時間。', route: '/timetable',
    })),
  });
}

test('shows Taiwan timestamps, complete change details and the exact comparison scope', () => {
  const input = comparison();
  const view = render(<CampusPlanComparisonCard comparison={input} disabled={false} />);
  expect(view.getByRole('header', { name: '這次調整了什麼' })).toBeTruthy();
  expect(view.getByText('原計畫整理：2026/11/06 23:58（台灣時間）')).toBeTruthy();
  expect(view.getByText('本次整理：2026/11/07 00:05（台灣時間）')).toBeTruthy();
  expect(view.getByText('可比對日期：2 個共同日期。')).toBeTruthy();
  expect(view.getByText('1 項作業摘要與原計畫相同。')).toBeTruthy();
  expect(view.getByText('有 1 項變動或需要核對的內容。')).toBeTruthy();
  expect(view.getByText(LONG_TITLE).props.numberOfLines).toBeUndefined();
  expect(view.getByText('11/8 23:59 截止')).toBeTruthy();
  expect(view.getByText('11/7 18:00 截止')).toBeTruthy();
  expect(view.getByText(input.changes[0].detail)).toBeTruthy();
  expect(view.getByText(/處理進度不會自動帶入/)).toBeTruthy();
  expect(view.queryByRole('button', { name: '查看原計畫' })).toBeNull();
});

test('opens the original only when requested and does not alter the comparison', () => {
  const input = comparison();
  const original = JSON.stringify(input);
  const onOpenOriginal = jest.fn();
  const view = render(<CampusPlanComparisonCard comparison={input} disabled={false} onOpenOriginal={onOpenOriginal} />);
  expect(onOpenOriginal).not.toHaveBeenCalled();
  fireEvent.press(view.getByRole('button', { name: '查看原計畫' }));
  expect(onOpenOriginal).toHaveBeenCalledTimes(1);
  expect(onOpenOriginal).toHaveBeenCalledWith();
  expect(JSON.stringify(input)).toBe(original);
});

test('previews five changes and exposes an accessible expand and collapse action', () => {
  const view = render(<CampusPlanComparisonCard comparison={manyChanges()} disabled={false} />);
  expect(view.getByText('課表調整 5')).toBeTruthy();
  expect(view.queryByText('課表調整 6')).toBeNull();
  const expand = view.getByRole('button', { name: '查看全部 7 項' });
  // Native normalizes ARIA into accessibilityState; browser QA checks the DOM attribute.
  expect(expand.props.accessibilityState.expanded).toBe(false);
  fireEvent.press(expand);
  expect(view.getByText('課表調整 7')).toBeTruthy();
  const collapse = view.getByRole('button', { name: '收起調整清單' });
  expect(collapse.props.accessibilityState.expanded).toBe(true);
  fireEvent.press(collapse);
  expect(view.queryByText('課表調整 6')).toBeNull();
  expect(view.queryByText('課表調整 7')).toBeNull();
});

test('disabled actions neither reveal more changes nor open the original', () => {
  const input = manyChanges();
  const onOpenOriginal = jest.fn();
  const view = render(<CampusPlanComparisonCard comparison={input} disabled onOpenOriginal={onOpenOriginal} />);
  fireEvent.press(view.getByRole('button', { name: '查看全部 7 項' }));
  fireEvent.press(view.getByRole('button', { name: '查看原計畫' }));
  expect(view.queryByText('課表調整 6')).toBeNull();
  expect(onOpenOriginal).not.toHaveBeenCalled();

  view.rerender(<CampusPlanComparisonCard comparison={input} disabled={false} onOpenOriginal={onOpenOriginal} />);
  fireEvent.press(view.getByRole('button', { name: '查看全部 7 項' }));
  view.rerender(<CampusPlanComparisonCard comparison={input} disabled onOpenOriginal={onOpenOriginal} />);
  fireEvent.press(view.getByRole('button', { name: '收起調整清單' }));
  expect(view.getByText('課表調整 7')).toBeTruthy();
  expect(onOpenOriginal).not.toHaveBeenCalled();
});

test('does not turn an older plan with unavailable detail into an unchanged result', () => {
  const limitation = '這份舊計畫沒有逐日資料，請到課表與課程頁重新核對。';
  const view = render(<CampusPlanComparisonCard comparison={comparison({
    previousCheckedAt: '2026-11-06', currentCheckedAt: 'invalid',
    comparableDates: 0, unchangedAssignments: 0, changes: [], limitations: [limitation],
  })} disabled={false} />);
  expect(view.getByText('目前沒有足夠資料可比對，請先查看下方說明。')).toBeTruthy();
  expect(view.getByText('沒有可共同核對的日期。')).toBeTruthy();
  expect(view.getByText('原計畫整理：時間未確認（台灣時間）')).toBeTruthy();
  expect(view.getByText('本次整理：時間未確認（台灣時間）')).toBeTruthy();
  expect(view.getByText(limitation)).toBeTruthy();
  expect(view.queryByText(/沒有變動|沒有差異|沒有列出可確認的調整/)).toBeNull();
});

test('keeps missing items and incomplete sources explicit without implying completion', () => {
  const input = comparison({
    comparableDates: 0, unchangedAssignments: 0,
    changes: [
      { id: 'not-listed', category: 'assignment', kind: 'missing', title: LONG_TITLE,
        before: '原計畫列有這份作業', detail: '本次摘要未列出，不能判定已繳交或已取消。' },
      { id: 'unavailable', category: 'source', kind: 'unverifiable', title: '作業資料尚未完整',
        detail: '請重新同步資料，再核對這份作業。' },
    ],
  });
  const view = render(<CampusPlanComparisonCard comparison={input} disabled={false} />);
  expect(view.getByText('本次未列出')).toBeTruthy();
  expect(view.getByText('待核對')).toBeTruthy();
  expect(view.getByText('本次摘要未列出，不能判定已繳交或已取消。')).toBeTruthy();
  expect(view.getByText('請重新同步資料，再核對這份作業。')).toBeTruthy();
  expect(view.getByText(input.limitations[0])).toBeTruthy();
  expect(view.queryByText('本次計畫')).toBeNull();
});

test('qualifies a comparison without listed changes and still displays limitations', () => {
  const input = comparison({ changes: [] });
  const view = render(<CampusPlanComparisonCard comparison={input} disabled={false} />);
  expect(view.getByText('這次沒有列出可確認的調整；僅涵蓋下方比對範圍。')).toBeTruthy();
  expect(view.getByText(input.limitations[0])).toBeTruthy();
  expect(view.queryByRole('button', { name: /查看全部/ })).toBeNull();
});

test('a new comparison starts collapsed and keeps limitations visible below the preview', () => {
  const input = manyChanges();
  const view = render(<CampusPlanComparisonCard comparison={input} disabled={false} />);
  expect(view.getByText(input.limitations[0])).toBeTruthy();
  fireEvent.press(view.getByRole('button', { name: '查看全部 7 項' }));
  expect(view.getByText('課表調整 7')).toBeTruthy();

  view.rerender(<CampusPlanComparisonCard comparison={manyChanges()} disabled={false} />);
  expect(view.queryByText('課表調整 6')).toBeNull();
  expect(view.getByRole('button', { name: '查看全部 7 項' }).props.accessibilityState.expanded).toBe(false);
});
