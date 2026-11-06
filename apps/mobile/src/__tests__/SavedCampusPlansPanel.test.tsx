import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';
import { SavedCampusPlansPanel } from '../screens/SavedCampusPlansPanel';
import { CampusAssignmentReminderAction } from '../screens/CampusAssignmentReminderAction';
import type { SavedCampusPlan } from '../services/savedCampusPlans';

jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));
jest.mock('../screens/CampusAssignmentReminderAction', () => ({ CampusAssignmentReminderAction: jest.fn(() => null) }));

function savedPlan(id = 'saved-one'): SavedCampusPlan {
  return {
    id,
    question: '今天要先處理哪些作業？',
    savedAt: '2026-11-06T16:05:00.000Z',
    updatedAt: '2026-11-06T16:05:00.000Z',
    completedStepIds: [],
    plan: {
      title: '今日優先行動',
      checkedAt: '2026-11-06T15:58:00.000Z',
      overview: '依本機課表與先前同步的資料整理。',
      content: '三個需要核對的項目。',
      limitations: ['作業仍需到原課程頁確認。'],
      steps: [
        { id: 'assignment-0', title: '資料庫報告', detail: '核對作業截止時間與繳交要求。',
          dueAt: '2026-11-06T15:59:00.000Z', groupName: '資料庫',
          evidence: 'authorized-assignments', priority: 'urgent', route: '/classroom' },
        { id: 'timetable-review', title: '核對下週課表', detail: '查看已保存課程。',
          evidence: 'saved-timetable', priority: 'normal', route: '/timetable' },
        { id: 'announcement-review', title: '核對最新校園通知', detail: '確認校方是否有更新。',
          evidence: 'authorized-announcements', priority: 'verify', route: '/announcements' },
      ],
    },
  };
}

function props(plans: SavedCampusPlan[] = []) {
  return {
    plans, loading: false, busy: false, error: '',
    onRetry: jest.fn(), onDelete: jest.fn(), onToggleStep: jest.fn(),
    onReplan: jest.fn(), onOpenRoute: jest.fn(),
  };
}

function expand(view: ReturnType<typeof render>, title = '今日優先行動') {
  fireEvent.press(view.getByRole('button', { name: new RegExp('^查看' + title + '，') }));
}

beforeEach(() => jest.clearAllMocks());

test('distinguishes a new collection, an ongoing read and a recoverable storage error', () => {
  const input = props();
  const view = render(<SavedCampusPlansPanel {...input} />);
  expect(view.getByText(/先在對話取得今日或七日計畫/)).toBeTruthy();
  expect(view.getByText(/再點「儲存這份計畫」/)).toBeTruthy();
  expect(view.getByText(/登出時會清除/)).toBeTruthy();

  view.rerender(<SavedCampusPlansPanel {...input} loading />);
  expect(view.getByText('正在讀取已儲存計畫…')).toBeTruthy();
  expect(view.queryByText(/尚未儲存計畫/)).toBeNull();

  view.rerender(<SavedCampusPlansPanel {...input} error="手機暫時無法讀取原有計畫，請再試一次。" />);
  expect(view.getByRole('alert').props.children).toContain('手機暫時無法讀取');
  expect(view.queryByText(/尚未儲存計畫/)).toBeNull();
  fireEvent.press(view.getByRole('button', { name: '重新讀取已儲存計畫' }));
  expect(input.onRetry).toHaveBeenCalledTimes(1);
});

test('keeps saved copies collapsed and shows their absolute dates and Taiwan save time', () => {
  const first = savedPlan();
  first.plan.agenda = {
    timetableAvailable: false, assignmentsAvailable: false, ignoredCourses: 0, outsideWindow: [],
    days: [
      { date: '2026-11-06', label: '11/6（週五）', courses: [], gaps: [], conflicts: [], deadlines: [] },
      { date: '2026-11-07', label: '11/7（週六）', courses: [], gaps: [], conflicts: [], deadlines: [] },
    ],
  };
  const second = savedPlan('saved-two');
  second.plan = { ...second.plan, title: '接下來七天的學習行動' };
  second.question = '幫我安排七天的複習';
  const input = props([first, second]);
  const view = render(<SavedCampusPlansPanel {...input} />);
  expect(view.queryByText(first.question)).toBeNull();
  expect(view.queryByText('資料庫報告')).toBeNull();
  expect(view.getByText('原規劃日期：2026/11/06–2026/11/07')).toBeTruthy();
  // A save just after Taiwan midnight does not move the original plan's dates.
  expand(view);
  expect(view.getByText(first.question)).toBeTruthy();
  expect(view.getByText('儲存於 2026/11/07 00:05（台灣時間）')).toBeTruthy();
  expect(view.getByText('整理時間：2026/11/06 23:58（台灣時間）')).toBeTruthy();
  expect(view.getByText('課表、期限與公告仍是當時資料，使用前請重新核對。')).toBeTruthy();
  expect(view.getByRole('button', { name: /^收起今日優先行動，/ }).props.accessibilityState.expanded).toBe(true);
  expect(view.getByText('規劃當時：24 小時內')).toBeTruthy();

  expand(view, second.plan.title);
  expect(view.queryByText(first.question)).toBeNull();
  expect(view.getByText(second.question)).toBeTruthy();
  expect(view.getByRole('button', { name: /^查看今日優先行動，/ }).props.accessibilityState.expanded).toBe(false);
  expect(input.onReplan).not.toHaveBeenCalled();
});

test('uses the original Taiwan checked date when an older plan has no agenda', () => {
  const saved = savedPlan();
  saved.plan.checkedAt = '2026-11-05T16:01:00.000Z';
  const view = render(<SavedCampusPlansPanel {...props([saved])} />);
  expect(view.getByText('原規劃日期：2026/11/06')).toBeTruthy();
});

test('records only personal progress and reflects the saved result through controlled props', () => {
  const saved = savedPlan();
  const input = props([saved]);
  const view = render(<SavedCampusPlansPanel {...input} />);
  expand(view);
  expect(view.getByText(/勾選只記錄你自己的處理進度/)).toBeTruthy();
  const checkbox = view.getByRole('checkbox', { name: /資料庫報告/ });
  expect(checkbox.props.accessibilityState.checked).toBe(false);
  fireEvent.press(checkbox);
  expect(input.onToggleStep).toHaveBeenCalledWith('saved-one', 'assignment-0', true);
  expect(view.getByText('已處理 0 / 3')).toBeTruthy();

  view.rerender(<SavedCampusPlansPanel {...input} plans={[{ ...saved, completedStepIds: ['assignment-0'] }]} />);
  expect(view.getByText('已處理 1 / 3')).toBeTruthy();
  expect(view.getByRole('checkbox', { name: /資料庫報告/ }).props.accessibilityState.checked).toBe(true);
  fireEvent.press(view.getByRole('checkbox', { name: /資料庫報告/ }));
  expect(input.onToggleStep).toHaveBeenLastCalledWith('saved-one', 'assignment-0', false);
  expect(input.onOpenRoute).not.toHaveBeenCalled();
  expect(input.onReplan).not.toHaveBeenCalled();
  expect(input.onDelete).not.toHaveBeenCalled();
});

test('opens exact general service routes without restoring assignment or reminder authority', () => {
  const input = props([savedPlan()]);
  const view = render(<SavedCampusPlansPanel {...input} />);
  expand(view);
  fireEvent.press(view.getByRole('button', { name: '開啟課程與作業核對' }));
  fireEvent.press(view.getByRole('button', { name: '開啟我的課表核對' }));
  fireEvent.press(view.getByRole('button', { name: '開啟校園公告核對' }));
  expect(input.onOpenRoute.mock.calls).toEqual([['/classroom'], ['/timetable'], ['/announcements']]);
  expect(view.queryByText('查看這份作業')).toBeNull();
  expect(CampusAssignmentReminderAction).not.toHaveBeenCalled();
});

test('replanning uses the selected copy without removing it or clearing existing progress', () => {
  const saved = { ...savedPlan(), completedStepIds: ['assignment-0'] };
  const input = props([saved]);
  const view = render(<SavedCampusPlansPanel {...input} />);
  expand(view);
  expect(view.getByText('以現在為基準建立新計畫，這份計畫與處理進度會保留。')).toBeTruthy();
  fireEvent.press(view.getByRole('button', { name: '依目前資料重新規劃' }));
  expect(input.onReplan).toHaveBeenCalledWith(saved);
  expect(view.getByText('已處理 1 / 3')).toBeTruthy();
  expect(input.onDelete).not.toHaveBeenCalled();
  expect(input.onToggleStep).not.toHaveBeenCalled();
});

test('deletes only the confirmed copy and preserves it until the parent reports success', () => {
  const input = props([savedPlan()]);
  const view = render(<SavedCampusPlansPanel {...input} />);
  expand(view);
  fireEvent.press(view.getByRole('button', { name: '刪除計畫' }));
  expect(view.getByText('刪除這份計畫和處理進度？已設定的作業提醒會保留。')).toBeTruthy();
  expect(input.onDelete).not.toHaveBeenCalled();
  fireEvent.press(view.getByRole('button', { name: '保留計畫' }));
  expect(view.queryByRole('button', { name: '確認刪除' })).toBeNull();
  expect(input.onDelete).not.toHaveBeenCalled();

  fireEvent.press(view.getByRole('button', { name: '刪除計畫' }));
  fireEvent.press(view.getByRole('button', { name: '確認刪除' }));
  expect(input.onDelete).toHaveBeenCalledTimes(1);
  expect(input.onDelete).toHaveBeenCalledWith('saved-one');
  expect(view.getByText('資料庫報告')).toBeTruthy();
  view.rerender(<SavedCampusPlansPanel {...input} plans={[]} />);
  expect(view.queryByText('資料庫報告')).toBeNull();
  expect(view.getByText(/尚未儲存計畫/)).toBeTruthy();
});

test('changing the expanded copy discards its previous deletion confirmation', () => {
  const second = savedPlan('saved-two');
  second.plan = { ...second.plan, title: '明日學習行動' };
  const input = props([savedPlan(), second]);
  const view = render(<SavedCampusPlansPanel {...input} />);
  expand(view);
  fireEvent.press(view.getByRole('button', { name: '刪除計畫' }));
  expand(view, second.plan.title);
  expect(view.queryByRole('button', { name: '確認刪除' })).toBeNull();
  fireEvent.press(view.getByRole('button', { name: '刪除計畫' }));
  fireEvent.press(view.getByRole('button', { name: '確認刪除' }));
  expect(input.onDelete).toHaveBeenCalledWith('saved-two');
  expect(input.onDelete).toHaveBeenCalledTimes(1);
});

test.each(['busy', 'loading'] as const)('%s blocks checklist changes, navigation, replanning and deletion', (state) => {
  const input = props([savedPlan()]);
  const view = render(<SavedCampusPlansPanel {...input} />);
  expand(view);
  fireEvent.press(view.getByRole('button', { name: '刪除計畫' }));
  view.rerender(<SavedCampusPlansPanel {...input} {...{ [state]: true }} />);
  fireEvent.press(view.getByRole('checkbox', { name: /資料庫報告/ }));
  fireEvent.press(view.getByRole('button', { name: '開啟課程與作業核對' }));
  fireEvent.press(view.getByRole('button', { name: '依目前資料重新規劃' }));
  fireEvent.press(view.getByRole('button', { name: '確認刪除' }));
  fireEvent.press(view.getByRole('button', { name: /^收起今日優先行動，/ }));
  expect(input.onToggleStep).not.toHaveBeenCalled();
  expect(input.onOpenRoute).not.toHaveBeenCalled();
  expect(input.onReplan).not.toHaveBeenCalled();
  expect(input.onDelete).not.toHaveBeenCalled();
  expect(view.getByText('資料庫報告')).toBeTruthy();
});
