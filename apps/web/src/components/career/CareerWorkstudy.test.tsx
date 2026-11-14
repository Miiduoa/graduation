import { expect, test, vi } from 'vitest';
import React from 'react';
import { act, fireEvent, render, waitFor } from '@testing-library/react';
import { CareerWorkstudy } from './CareerWorkstudy';
import type {
  CareerCommand,
  WorkstudyService,
  WorkstudySnapshot,
} from '@campus/shared/src/careerWorkstudy';
import {
  application,
  courses,
  opportunity,
  snapshot,
} from '@campus/shared/testFixtures/careerWorkstudy';
function setup(
  audience: 'student' | 'staff' | 'ops' = 'student',
  ownerKey: string | null = 'student',
) {
  const data = snapshot();
  data.canReview = audience === 'staff';
  data.canOperate = audience === 'ops';
  const onLogin = vi.fn(),
    onCareerEvents = vi.fn(),
    unsubscribe = vi.fn();
  let changed = () => {};
  const service: WorkstudyService = {
    load: vi.fn(async () => {
      await Promise.resolve();
      return { ...data, applications: [...data.applications] };
    }),
    execute: vi.fn(async (command: Exclude<CareerCommand, { action: 'list' }>) => {
      if (command.action === 'apply') data.applications = [application];
      if (command.action === 'review')
        data.applications = data.applications.map((a) => ({
          ...a,
          revision: a.revision + 1,
          state: command.state,
          message: command.message ?? a.message,
        }));
      return { id: application.id };
    }),
    subscribe: vi.fn((_audience, callback) => {
      changed = callback;
      return unsubscribe;
    }),
  };
  const loadCourses = vi.fn(async () => courses);
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
  fireEvent.click(view.getByRole('button', { name: '應徵測試用工讀' }));
  expect(view.getByText(opportunity.rightsText)).toBeTruthy();
  expect((view.getByRole('button', { name: '送出申請' }) as HTMLButtonElement).disabled).toBe(true);
  fireEvent.change(view.getByLabelText('聯絡方式'), { target: { value: 'student@example.test' } });
  fireEvent.click(view.getByRole('checkbox', { name: '我看過了' }));
  fireEvent.click(view.getByRole('button', { name: '送出申請' }));
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
  fireEvent.click(await view.findByRole('button', { name: '應徵測試用工讀' }));
  expect(onLogin).toHaveBeenCalled();
  expect(service.execute).not.toHaveBeenCalled();
});
test('failed submission keeps the form and shows the server error', async () => {
  const { view, service } = setup();
  vi.mocked(service.execute).mockRejectedValueOnce(
    new Error('工讀內容或權益說明已更新，請重新閱讀。'),
  );
  fireEvent.click(await view.findByRole('button', { name: '應徵測試用工讀' }));
  fireEvent.change(view.getByLabelText('聯絡方式'), { target: { value: 'student@example.test' } });
  fireEvent.click(view.getByRole('checkbox', { name: '我看過了' }));
  fireEvent.click(view.getByRole('button', { name: '送出申請' }));
  await view.findByText('工讀內容或權益說明已更新，請重新閱讀。');
  expect((view.getByLabelText('聯絡方式') as HTMLInputElement).value).toBe('student@example.test');
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
  fireEvent.click(view.getByRole('button', { name: '申請' }));
  fireEvent.click(view.getByRole('button', { name: '改為單位已讀' }));
  await view.findByText('測試單位 · 單位已讀');
  expect((view.getByRole('button', { name: '改為約面談' }) as HTMLButtonElement).disabled).toBe(
    true,
  );
  fireEvent.change(view.getByLabelText(/給測試用工讀申請人的回覆/), {
    target: { value: '12/1 10:00 職產處，請洽承辦' },
  });
  fireEvent.click(view.getByRole('button', { name: '改為約面談' }));
  await waitFor(() =>
    expect(service.execute).toHaveBeenLastCalledWith(
      expect.objectContaining({
        action: 'review',
        state: 'interview',
        message: '12/1 10:00 職產處，請洽承辦',
      }),
    ),
  );
  fireEvent.click(view.getByRole('button', { name: '活動' }));
  fireEvent.click(view.getByRole('button', { name: '查看測試職涯講座與報名' }));
  expect(onCareerEvents).toHaveBeenCalledWith({ category: 'career', event: data.events[0] });
  fireEvent.click(view.getByRole('button', { name: '查看職涯活動' }));
  expect(onCareerEvents).toHaveBeenCalledWith({ category: 'career' });
});
test('staff can edit and unpublish an existing opportunity with Taiwan time and its revision', async () => {
  const { view, service } = setup('staff');
  fireEvent.click(await view.findByRole('button', { name: '編輯測試用工讀' }));
  fireEvent.change(view.getByLabelText('標題'), { target: { value: '更新後的測試標題' } });
  fireEvent.click(view.getByRole('checkbox', { name: '上架' }));
  fireEvent.click(view.getByRole('button', { name: '儲存機會' }));
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
    load: vi.fn(() => new Promise<WorkstudySnapshot>(() => {})),
    execute: vi.fn(),
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
  fireEvent.click(view.getByRole('checkbox', { name: '系所' }));
  await waitFor(() =>
    expect(service.execute).toHaveBeenCalledWith({
      action: 'sources',
      sources: { office: true, departments: false, taiwanjobs: true, revision: 0 },
    }),
  );
  expect(view.queryByText('關閉職涯')).toBeNull();
  expect(view.queryByText('聯絡方式')).toBeNull();
});

test.each([false, true])(
  'reopened staff workbench preserves replies unless explicitly cleared (%s)',
  async (clear) => {
    const { view, data, service, changed } = setup('staff');
    await view.findByRole('button', { name: '新增機會' });
    data.applications = [{ ...application, state: 'interview', message: '12/1 職產處，請洽承辦' }];
    await act(async () => changed());
    fireEvent.click(view.getByRole('button', { name: '申請' }));
    await view.findByText('單位回覆：12/1 職產處，請洽承辦');
    if (clear) fireEvent.click(view.getByRole('button', { name: '清除回覆（隨狀態更新儲存）' }));
    fireEvent.click(view.getByRole('button', { name: '改為錄取' }));
    await waitFor(() =>
      expect(service.execute).toHaveBeenCalledWith({
        action: 'review',
        applicationId: application.id,
        revision: application.revision,
        state: 'accepted',
        ...(clear ? { message: '' } : {}),
      }),
    );
  },
);

test.each([false, true])(
  'remote updates cannot submit a stale reply draft (saved: %s)',
  async (save) => {
    const { view, data, service, changed } = setup('staff');
    data.applications = [{ ...application, state: 'read' }];
    await view.findByRole('button', { name: '新增機會' });
    fireEvent.click(view.getByRole('button', { name: '申請' }));
    fireEvent.change(view.getByLabelText(/給測試用工讀申請人的回覆/), {
      target: { value: '我的草稿' },
    });
    if (save) {
      fireEvent.click(view.getByRole('button', { name: '改為約面談' }));
      await view.findByText('測試單位 · 約面談');
      await waitFor(() => expect(view.queryByText('已儲存。')).toBeTruthy());
    }
    data.applications = [
      { ...application, revision: 3, state: 'interview', message: '其他承辦的新回覆' },
    ];
    await act(async () => changed());
    await view.findByText('單位回覆：其他承辦的新回覆');
    if (!save) {
      expect(
        view.getByText('這筆申請已由其他承辦更新，請捨棄草稿並確認最新回覆後再操作。'),
      ).toBeTruthy();
      expect((view.getByRole('button', { name: '改為錄取' }) as HTMLButtonElement).disabled).toBe(
        true,
      );
      fireEvent.click(view.getByRole('button', { name: '改為錄取' }));
      expect(service.execute).not.toHaveBeenCalled();
      fireEvent.click(view.getByRole('button', { name: '捨棄草稿，使用最新回覆' }));
    }
    expect((view.getByLabelText(/給測試用工讀申請人的回覆/) as HTMLInputElement).value).toBe(
      '其他承辦的新回覆',
    );
    fireEvent.click(view.getByRole('button', { name: '改為錄取' }));
    await waitFor(() =>
      expect(service.execute).toHaveBeenLastCalledWith({
        action: 'review',
        applicationId: application.id,
        revision: 3,
        state: 'accepted',
      }),
    );
  },
);
