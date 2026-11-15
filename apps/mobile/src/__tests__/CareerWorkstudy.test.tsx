import React from 'react';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
jest.mock('../state/theme', () => ({ useTheme: () => require('../ui/theme').getCurrentTheme() }));
jest.mock('../ui/navigationTheme', () => ({ useTabBarContentBottomPadding: () => 80 }));
jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));
import { CareerWorkstudy } from '../components/career/CareerWorkstudy';
import type {
  CareerCommand,
  WorkstudyService,
  WorkstudySnapshot,
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
        data.applications = data.applications.map((a) => ({
          ...a,
          revision: a.revision + 1,
          state: command.state,
          message: command.message ?? a.message,
        }));
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
test('student can withdraw early-stage applications and apply again later', async () => {
  const { view, data, service } = setup();
  data.applications = [{ ...application, state: 'submitted' }];
  await view.findByText('我的申請');
  fireEvent.press(view.getByRole('button', { name: '撤回申請' }));
  expect(service.execute).not.toHaveBeenCalled();
  fireEvent.press(view.getByRole('button', { name: '確認撤回申請' }));
  data.applications = [{ ...application, state: 'withdrawn' }];
  await waitFor(() =>
    expect(service.execute).toHaveBeenCalledWith({
      action: 'withdraw',
      applicationId: application.id,
      revision: application.revision,
    }),
  );
  await waitFor(() => expect(view.getByText('已撤回申請。')).toBeTruthy());
  expect(view.getByText(/已撤回$/)).toBeTruthy();
  expect(view.getByRole('button', { name: `應徵${opportunity.title}` })).toBeTruthy();
});

test('work-study filters can narrow by unit, slot and credit with empty-state feedback', async () => {
  const { view, data } = setup();
  data.opportunities = [
    opportunity,
    {
      ...opportunity,
      id: 'second',
      title: '第二份工讀',
      unit: '圖書館',
      credit: false,
      slots: [{ day: 4, start: '13:00', end: '15:00' }],
    },
  ];
  await view.findByText('測試用工讀');
  fireEvent.changeText(view.getByLabelText('篩選單位'), '圖書館');
  expect(view.getByText('第二份工讀')).toBeTruthy();
  expect(view.queryByText('測試用工讀')).toBeNull();
  fireEvent.changeText(view.getByLabelText('篩選時段（例如：週三）'), '週三');
  expect(view.getByText('沒有符合目前篩選條件的工讀機會。')).toBeTruthy();
  fireEvent.changeText(view.getByLabelText('篩選時段（例如：週三）'), '');
  fireEvent.press(view.getByRole('button', { name: '學分：可抵學分' }));
  expect(view.getByText('沒有符合目前篩選條件的工讀機會。')).toBeTruthy();
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

test.each([false, true])(
  'reopened staff workbench preserves replies unless explicitly cleared (%s)',
  async (clear) => {
    const { view, data, service, changed } = setup('staff');
    await view.findByRole('button', { name: '新增機會' });
    data.applications = [{ ...application, state: 'interview', message: '12/1 職產處，請洽承辦' }];
    await act(async () => changed());
    fireEvent.press(view.getByRole('button', { name: '申請' }));
    await view.findByText('單位回覆：12/1 職產處，請洽承辦');
    if (clear) fireEvent.press(view.getByRole('button', { name: '清除回覆（隨狀態更新儲存）' }));
    fireEvent.press(view.getByRole('button', { name: '改為錄取' }));
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
    fireEvent.press(view.getByRole('button', { name: '申請' }));
    fireEvent.changeText(view.getByLabelText(/給測試用工讀申請人的回覆/), '我的草稿');
    if (save) {
      fireEvent.press(view.getByRole('button', { name: '改為約面談' }));
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
      expect(view.getByRole('button', { name: '改為錄取' })).toBeDisabled();
      fireEvent.press(view.getByRole('button', { name: '改為錄取' }));
      expect(service.execute).not.toHaveBeenCalled();
      fireEvent.press(view.getByRole('button', { name: '捨棄草稿，使用最新回覆' }));
    }
    expect(view.getByLabelText(/給測試用工讀申請人的回覆/)).toHaveProp('value', '其他承辦的新回覆');
    fireEvent.press(view.getByRole('button', { name: '改為錄取' }));
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

test('slow reads coalesce subscription and manual triggers into one latest snapshot', async () => {
  const { view, service, changed } = setup();
  let finish!: (value: WorkstudySnapshot) => void;
  jest.mocked(service.load).mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  await act(async () => {});
  expect(service.load).toHaveBeenCalledTimes(1);
  act(() => {
    changed();
    changed();
  });
  fireEvent.press(view.getByRole('button', { name: '重新整理工讀資料' }));
  expect(service.load).toHaveBeenCalledTimes(1);
  await act(async () => {
    finish({ ...snapshot(), opportunities: [{ ...opportunity, title: '過期讀取結果' }] });
  });
  expect(service.load).toHaveBeenCalledTimes(2);
  expect(view.queryByText('過期讀取結果')).toBeNull();
  expect(view.getByText('測試用工讀')).toBeTruthy();
});

test('account remount and unmount abort pending reads and discard late failures', async () => {
  const { view, service, props } = setup();
  let rejectOld!: (reason: Error) => void;
  let oldSignal: AbortSignal | undefined;
  jest.mocked(service.load).mockImplementationOnce((_audience, options) => {
    oldSignal = options?.signal;
    return new Promise((_resolve, reject) => {
      rejectOld = reject;
    });
  });
  await act(async () => {});
  const next = {
    ...service,
    load: jest.fn<ReturnType<WorkstudyService['load']>, Parameters<WorkstudyService['load']>>(
      async () => snapshot(),
    ),
  };
  view.rerender(<CareerWorkstudy {...props} ownerKey="other" service={next} />);
  await act(async () => {
    rejectOld(new Error('舊讀取已取消'));
  });
  expect(oldSignal?.aborted).toBe(true);
  expect(view.queryByText('舊讀取已取消')).toBeNull();
  expect(view.getByText('測試用工讀')).toBeTruthy();
  let unmountSignal: AbortSignal | undefined;
  let rejectUnmount!: (reason: Error) => void;
  next.load.mockImplementationOnce((_audience?: unknown, options?: { signal?: AbortSignal }) => {
    unmountSignal = options?.signal;
    return new Promise<WorkstudySnapshot>((_resolve, reject) => {
      rejectUnmount = reject;
    });
  });
  fireEvent.press(view.getByRole('button', { name: '重新整理工讀資料' }));
  view.unmount();
  expect(unmountSignal?.aborted).toBe(true);
  await act(async () => {
    rejectUnmount(new Error('卸載已取消'));
  });
  expect(next.load).toHaveBeenCalledTimes(2);
});

test('a write cancels a hanging read before refreshing the saved snapshot', async () => {
  const { view, service, changed } = setup('staff');
  await view.findByRole('button', { name: '新增機會' });
  let signal: AbortSignal | undefined;
  jest.mocked(service.load).mockImplementationOnce((_audience, options) => {
    signal = options?.signal;
    return new Promise((_resolve, reject) => {
      signal?.addEventListener('abort', () => reject(new Error('讀取已取消')), { once: true });
    });
  });
  act(() => changed());
  fireEvent.press(view.getByRole('button', { name: '編輯測試用工讀' }));
  fireEvent.press(view.getByRole('button', { name: '儲存機會' }));
  await act(async () => {});
  expect(signal?.aborted).toBe(true);
  expect(service.load).toHaveBeenCalledTimes(3);
  expect(view.queryByText('讀取已取消')).toBeNull();
  expect(view.getByText('已儲存。')).toBeTruthy();
});

test('continuous refresh triggers allow each serialized read to commit without starvation', async () => {
  const { view, service, changed } = setup();
  await view.findByText('測試用工讀');
  let finish!: (value: WorkstudySnapshot) => void;
  jest.mocked(service.load).mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  act(() => changed());
  for (let i = 0; i < 4; i++) {
    act(() => {
      changed();
      changed();
    });
    await act(async () => {
      finish({ ...snapshot(), opportunities: [{ ...opportunity, title: `讀取結果${i}` }] });
    });
    expect(view.getByText(`讀取結果${i}`)).toBeTruthy();
    if (i > 0) expect(view.queryByText(`讀取結果${i - 1}`)).toBeNull();
    expect(service.load).toHaveBeenCalledTimes(i + 3);
  }
  view.unmount();
});

test('a cancelled read cannot overwrite the newer result after a write', async () => {
  const { view, service, changed } = setup('staff');
  await view.findByText('測試用工讀');
  let finish!: (value: WorkstudySnapshot) => void;
  jest.mocked(service.load).mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  act(() => changed());
  fireEvent.press(view.getByText('編輯測試用工讀'));
  fireEvent.press(view.getByText('儲存機會'));
  await act(async () => {});
  await act(async () => {
    finish({ ...snapshot(), opportunities: [{ ...opportunity, title: '已取消的舊結果' }] });
  });
  expect(view.getByText('測試用工讀')).toBeTruthy();
  expect(view.queryByText('已取消的舊結果')).toBeNull();
  expect(service.load).toHaveBeenCalledTimes(3);
});

test('withdrawn applications stay visible without staff review controls', async () => {
  const { view, data } = setup('staff');
  data.applications = [{ ...application, state: 'withdrawn' }];
  await view.findByText('職涯工作台');
  fireEvent.press(view.getByText('申請'));
  await waitFor(() => expect(view.getByText(/已撤回$/)).toBeTruthy());
  expect(view.queryByText('改為單位已讀')).toBeNull();
  expect(view.queryByText('改為約面談')).toBeNull();
});

test('hides student work-study chrome for teachers without applications and keeps staff tools', async () => {
  const { view, data, service } = setup();
  data.viewerRole = 'teacher';
  data.applications = [];
  await waitFor(() => expect(service.load).toHaveBeenCalled());
  await act(async () => {});
  expect(view.queryByText('我的申請')).toBeNull();
  expect(view.queryByText(/應徵/)).toBeNull();
  view.unmount();
  const staff = setup('staff');
  staff.data.viewerRole = 'teacher';
  await waitFor(() => expect(staff.view.getByText('新增機會')).toBeTruthy());
});
