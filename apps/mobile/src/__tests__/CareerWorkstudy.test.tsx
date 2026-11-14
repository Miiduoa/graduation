import React from 'react';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
jest.mock('../state/theme', () => ({ useTheme: () => require('../ui/theme').getCurrentTheme() }));
jest.mock('../ui/navigationTheme', () => ({ useTabBarContentBottomPadding: () => 80 }));
jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));
import { CareerWorkstudy } from '../components/career/CareerWorkstudy';
import type {
  CareerCommand,
  WorkstudyService,
} from '../../../../packages/shared/src/careerWorkstudy';
import {
  application,
  courses,
  opportunity,
  snapshot,
} from '../../../../packages/shared/testFixtures/careerWorkstudy';
function setup(
  audience: 'student' | 'staff' | 'ops' = 'student',
  ownerKey: string | null = 'student',
) {
  const data = snapshot();
  data.canReview = audience === 'staff';
  data.canOperate = audience === 'ops';
  const onLogin = jest.fn(),
    onCareerEvents = jest.fn(),
    unsubscribe = jest.fn();
  let changed = () => {};
  const service: WorkstudyService = {
    load: jest.fn(async () => {
      await Promise.resolve();
      return { ...data, applications: [...data.applications] };
    }),
    execute: jest.fn(async (command: Exclude<CareerCommand, { action: 'list' }>) => {
      if (command.action === 'apply') data.applications = [application];
      if (command.action === 'review')
        data.applications = [{ ...application, state: command.state, message: command.message }];
      return { id: application.id };
    }),
    subscribe: jest.fn((_audience, callback) => {
      changed = callback;
      return unsubscribe;
    }),
  };
  const loadCourses = jest.fn(async () => courses);
  const props = {
    schoolId: 'pu',
    ownerKey,
    service,
    loadCourses,
    onLogin,
    onCareerEvents,
    audience,
  };
  const view = render(<CareerWorkstudy {...props} />);
  return {
    view,
    data,
    service,
    props,
    onLogin,
    onCareerEvents,
    unsubscribe,
    changed: () => changed(),
  };
}
test('student sees conflicts without losing opportunities, reads rights and sends a real command', async () => {
  const { view, service } = setup();
  await view.findByText('與你的課衝堂：測試課程');
  fireEvent.press(view.getByRole('button', { name: '應徵測試用工讀' }));
  expect(view.getByText(opportunity.rightsText)).toBeTruthy();
  expect(view.getByRole('button', { name: '送出申請' })).toBeDisabled();
  fireEvent.changeText(view.getByLabelText('聯絡方式'), 'student@example.test');
  fireEvent.press(view.getByRole('checkbox', { name: '我看過了' }));
  fireEvent.press(view.getByRole('button', { name: '送出申請' }));
  await view.findByText('已送出申請，可在「我的申請」查看進度。');
  expect(service.execute).toHaveBeenCalledWith({
    action: 'apply',
    opportunityId: opportunity.id,
    revision: 1,
    confirmed: true,
    contact: 'student@example.test',
    introduction: '',
  });
  expect(view.getAllByText('已送出').length).toBeGreaterThan(0);
});
test('guest action asks host to log in and never sends a command', async () => {
  const { view, service, onLogin } = setup('student', null);
  fireEvent.press(await view.findByRole('button', { name: '應徵測試用工讀' }));
  expect(onLogin).toHaveBeenCalled();
  expect(service.execute).not.toHaveBeenCalled();
});
test('failed submission keeps the form and shows the server error', async () => {
  const { view, service } = setup();
  jest
    .mocked(service.execute)
    .mockRejectedValueOnce(new Error('工讀內容或權益說明已更新，請重新閱讀。'));
  fireEvent.press(await view.findByRole('button', { name: '應徵測試用工讀' }));
  fireEvent.changeText(view.getByLabelText('聯絡方式'), 'student@example.test');
  fireEvent.press(view.getByRole('checkbox', { name: '我看過了' }));
  fireEvent.press(view.getByRole('button', { name: '送出申請' }));
  await view.findByText('工讀內容或權益說明已更新，請重新閱讀。');
  expect(view.getByLabelText('聯絡方式')).toHaveProp('value', 'student@example.test');
});
test('staff reviews applications, gives interview details and uses existing career events', async () => {
  const { view, data, service, onCareerEvents } = setup('staff');
  data.applications = [application];
  data.events = [
    {
      id: 'career-event',
      title: '測試職涯講座',
      startsAt: '2099-01-01T00:00:00Z',
      source: 'school-club-events',
    },
  ];
  await view.findByRole('button', { name: '新增機會' });
  fireEvent.press(view.getByRole('button', { name: '申請' }));
  fireEvent.press(view.getByRole('button', { name: '改為單位已讀' }));
  await view.findByText('測試單位 · 單位已讀');
  expect(view.getByRole('button', { name: '改為約面談' })).toBeDisabled();
  fireEvent.changeText(
    view.getByLabelText(/給測試用工讀申請人的回覆/),
    '12/1 10:00 職產處，請洽承辦',
  );
  fireEvent.press(view.getByRole('button', { name: '改為約面談' }));
  await waitFor(() =>
    expect(service.execute).toHaveBeenLastCalledWith(
      expect.objectContaining({
        action: 'review',
        state: 'interview',
        message: '12/1 10:00 職產處，請洽承辦',
      }),
    ),
  );
  fireEvent.press(view.getByRole('button', { name: '活動' }));
  fireEvent.press(view.getByRole('button', { name: '查看測試職涯講座與報名' }));
  expect(onCareerEvents).toHaveBeenCalledWith({ category: 'career', event: data.events[0] });
  fireEvent.press(view.getByRole('button', { name: '查看職涯活動' }));
  expect(onCareerEvents).toHaveBeenCalledWith({ category: 'career' });
});
test('staff can edit and unpublish an existing opportunity with Taiwan time and its revision', async () => {
  const { view, service } = setup('staff');
  fireEvent.press(await view.findByRole('button', { name: '編輯測試用工讀' }));
  fireEvent.changeText(view.getByLabelText('標題'), '更新後的測試標題');
  fireEvent.press(view.getByRole('checkbox', { name: '上架' }));
  fireEvent.press(view.getByRole('button', { name: '儲存機會' }));
  await waitFor(() =>
    expect(service.execute).toHaveBeenCalledWith({
      action: 'save',
      opportunity: { ...opportunity, title: '更新後的測試標題', published: false },
    }),
  );
});
test('subscription refreshes an application and unsubscribes when leaving', async () => {
  const { view, data, changed, unsubscribe } = setup();
  await view.findByRole('button', { name: '應徵測試用工讀' });
  data.applications = [{ ...application, state: 'interview', message: '測試面談通知' }];
  await act(async () => changed());
  await view.findByText('單位回覆：測試面談通知');
  view.unmount();
  expect(unsubscribe).toHaveBeenCalled();
});
test('account change clears application data before the next account finishes loading', async () => {
  const { view, data, props } = setup();
  data.applications = [application];
  await view.findByText('測試單位 · 已送出');
  const next: WorkstudyService = {
    load: jest.fn(() => new Promise<WorkstudySnapshot>(() => {})),
    execute: jest.fn(),
  };
  view.rerender(<CareerWorkstudy {...props} ownerKey="other" service={next} />);
  expect(view.queryByText('測試單位 · 已送出')).toBeNull();
});
test('ops sees source choices and audits, without a career-off switch or student roster', async () => {
  const { view, data, service } = setup('ops');
  data.sources = { office: true, departments: true, taiwanjobs: true, revision: 0 };
  data.audit = [
    {
      id: 'audit',
      action: 'career_publish',
      actorUid: 'staff',
      targetId: opportunity.id,
      at: application.submittedAt,
    },
  ];
  await view.findByText('資料來源');
  fireEvent.press(view.getByRole('checkbox', { name: '系所' }));
  await waitFor(() =>
    expect(service.execute).toHaveBeenCalledWith({
      action: 'sources',
      sources: { office: true, departments: false, taiwanjobs: true, revision: 0 },
    }),
  );
  expect(view.queryByText('關閉職涯')).toBeNull();
  expect(view.queryByText('聯絡方式')).toBeNull();
});
