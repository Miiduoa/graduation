import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';
import { CampusStudyAgendaCard } from '../screens/CampusStudyAgendaCard';
import { CampusEvidencePlanCard } from '../screens/CampusEvidencePlanCard';
import { buildCampusStudyAgenda, resolveStudyWindow, type CampusStudyAgenda } from '../services/campusStudyAgenda';

jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));
const now = Date.parse('2026-10-27T07:00:00Z');
function fixture() {
  return buildCampusStudyAgenda({
    window: resolveStudyWindow('未來七天', now)!, now,
    courses: [
      { name: '長時段課程', day: 3, start: 1, end: 7 },
      { name: '重疊課程', day: 3, start: 2, end: 3 },
      { name: '午後課程', day: 3, start: 6, end: 8 },
      { name: '晚間課程', day: 3, start: 10, end: 11 },
    ],
    assignments: [
      { title: '星期三資料庫作業', groupName: '資料庫', dueAt: '2026-10-28T10:00:00Z' },
      { title: '沒有截止日期的作業', groupName: '專題', dueAt: null },
    ],
  });
}

test('shows all seven date controls rather than only the first occupied day', () => {
  const agenda = fixture();
  const view = render(<CampusStudyAgendaCard agenda={agenda} disabled={false} />);
  expect(view.getByText('逐日安排')).toBeTruthy();
  for (const day of agenda.days) expect(view.getByLabelText(day.label + '逐日安排')).toBeTruthy();
});

test('expanding a day exposes actual periods, conflicts and deadlines without executing anything', () => {
  const agenda = fixture();
  const navigate = jest.fn();
  const view = render(<CampusStudyAgendaCard agenda={agenda} disabled={false} onOpenRoute={navigate} />);
  expect(view.queryByText('星期三資料庫作業')).toBeNull();
  const dayControl = view.getByLabelText('10/28（週三）逐日安排');
  expect(dayControl.props.accessibilityState.expanded).toBe(false);
  fireEvent.press(dayControl);
  expect(view.getByLabelText('10/28（週三）逐日安排').props.accessibilityState.expanded).toBe(true);
  expect(view.getByText('星期三資料庫作業')).toBeTruthy();
  expect(view.getByText(/18:00 截止/)).toBeTruthy();
  expect(view.getByText(/課表重疊：第 2–3 節、第 6–7 節/)).toBeTruthy();
  expect(view.getByText(/副本課間空堂：第 9 節/)).toBeTruthy();
  expect(navigate).not.toHaveBeenCalled();
  fireEvent.press(view.getByText('核對當日作業'));
  expect(navigate).toHaveBeenCalledWith('/classroom');
});

test('unknown or out-of-window assignments remain explicitly discoverable', () => {
  const view = render(<CampusStudyAgendaCard agenda={fixture()} disabled={false} />);
  expect(view.queryByText('沒有截止日期的作業')).toBeNull();
  fireEvent.press(view.getByText('查看其他 1 項作業'));
  expect(view.getByText('沒有截止日期的作業')).toBeTruthy();
  expect(view.getByText('截止時間未確認')).toBeTruthy();
});

test('missing sources are not presented as a free day or all work completed', () => {
  const agenda = buildCampusStudyAgenda({ window: resolveStudyWindow('今天', now)!, now, courses: null, assignments: null });
  const view = render(<CampusStudyAgendaCard agenda={agenda} disabled={false} />);
  expect(view.getByText('課表來源不可用，無法判定這天是否有課。')).toBeTruthy();
  expect(view.getByText('作業來源不可用，不能判定是否已全部完成。')).toBeTruthy();
});

test('busy state disables expansion and action navigation', () => {
  const navigate = jest.fn();
  const view = render(<CampusStudyAgendaCard agenda={fixture()} disabled onOpenRoute={navigate} />);
  const day = view.getByLabelText('10/28（週三）逐日安排');
  fireEvent.press(day);
  expect(day.props.accessibilityState).toEqual({ expanded: false, disabled: true });
  expect(view.queryByText('星期三資料庫作業')).toBeNull();
  expect(navigate).not.toHaveBeenCalled();
});

test('the existing evidence plan card renders the complete agenda without requiring reminder consent', () => {
  const view = render(<CampusEvidencePlanCard disabled={false} plan={{
    title: '接下來七天的學習行動', overview: '手機儲存課表與授權摘要',
    checkedAt: new Date(now).toISOString(), steps: [], limitations: [], content: '文字版', agenda: fixture(),
  }} />);
  expect(view.getByText('逐日安排')).toBeTruthy();
  expect(view.getByLabelText('11/2（週一）逐日安排')).toBeTruthy();
  expect(view.queryByText('確認設定本機提醒')).toBeNull();
});

test('clock days count each saved occurrence and show Sunday and overnight times without inventing periods', () => {
  const sunday = Date.parse('2026-11-08T00:00:00Z');
  const agenda: CampusStudyAgenda = buildCampusStudyAgenda({
    window: resolveStudyWindow('未來七天', sunday)!, now: sunday, courses: [], assignments: null,
  });
  for (const day of agenda.days) day.scheduledClasses = [];
  const overnight = { name: '專題實作', room: 'B201', startAt: '2026-11-08T15:30:00Z', endAt: '2026-11-08T17:00:00Z' };
  agenda.days[0].scheduledClasses = [
    { name: '專題實作', room: 'A301', startAt: '2026-11-08T09:10:00+08:00', endAt: '2026-11-08T03:00:00Z' },
    overnight, { ...overnight },
  ];
  agenda.days[1].scheduledClasses = [{ ...overnight }, { ...overnight }];
  const navigate = jest.fn();
  const view = render(<CampusStudyAgendaCard agenda={agenda} disabled={false} onOpenRoute={navigate} />);
  expect(view.getByText('3 堂課 · 作業未知')).toBeTruthy();
  expect(view.getByText('09:10–11:00｜專題實作 · A301')).toBeTruthy();
  expect(view.getAllByText('11/8 23:30–11/9 01:00｜專題實作 · B201')).toHaveLength(2);
  fireEvent.press(view.getByLabelText('11/9（週一）逐日安排'));
  expect(view.getByText('2 堂課 · 作業未知')).toBeTruthy();
  expect(view.getAllByText('11/8 23:30–11/9 01:00｜專題實作 · B201')).toHaveLength(4);
  expect(view.queryByText(/第 \d/)).toBeNull();
  expect(view.queryByText(/副本課間空堂|課表重疊：/)).toBeNull();
  expect(view.getByText(/未推算空堂/)).toBeTruthy();
  expect(navigate).not.toHaveBeenCalled();
});

test('an explicitly empty clock day is distinct from an unread timetable', () => {
  const agenda = buildCampusStudyAgenda({ window: resolveStudyWindow('今天', now)!, now, courses: [], assignments: [] });
  agenda.days[0].scheduledClasses = [];
  const view = render(<CampusStudyAgendaCard agenda={agenda} disabled={false} />);
  expect(view.getByText('0 堂課 · 0 項截止')).toBeTruthy();
  expect(view.getByText('課表副本未排課，並非已確認整天有空。')).toBeTruthy();
  delete agenda.days[0].scheduledClasses;
  agenda.timetableAvailable = false;
  view.rerender(<CampusStudyAgendaCard agenda={agenda} disabled={false} />);
  expect(view.getByText('課表未知 · 0 項截止')).toBeTruthy();
  expect(view.getByText('課表來源不可用，無法判定這天是否有課。')).toBeTruthy();
  expect(view.queryByText('課表副本未排課，並非已確認整天有空。')).toBeNull();
});
