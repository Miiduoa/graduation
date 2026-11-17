import { expect, test, vi } from 'vitest';
import React from 'react';
import { useState } from 'react';
vi.mock('react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react')>();
  return { ...actual, useState: vi.fn(actual.useState) };
});
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
test('student can withdraw early-stage applications and apply again later', async () => {
  const { view, data, service } = setup();
  data.applications = [{ ...application, state: 'submitted' }];
  await view.findByText('我的申請');
  fireEvent.click(view.getByRole('button', { name: '撤回申請' }));
  expect(service.execute).not.toHaveBeenCalled();
  fireEvent.click(view.getByRole('button', { name: '確認撤回申請' }));
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
  fireEvent.change(view.getByLabelText('單位'), { target: { value: '圖書館' } });
  expect(view.getByText('第二份工讀')).toBeTruthy();
  expect(view.queryByText('測試用工讀')).toBeNull();
  fireEvent.change(view.getByLabelText('時段'), { target: { value: '週三 09:00–11:00' } });
  expect(view.getByText('沒有符合目前篩選條件的職涯機會。')).toBeTruthy();
  fireEvent.change(view.getByLabelText('時段'), { target: { value: '全部' } });
  fireEvent.change(view.getByLabelText('學分'), { target: { value: 'credit' } });
  expect(view.getByText('沒有符合目前篩選條件的職涯機會。')).toBeTruthy();
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

test('slow reads coalesce subscription and manual triggers into one latest snapshot', async () => {
  const { view, service, changed } = setup();
  let finish!: (value: WorkstudySnapshot) => void;
  vi.mocked(service.load).mockImplementationOnce(
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
  fireEvent.click(view.getByRole('button', { name: '重新整理職涯機會' }));
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
  vi.mocked(service.load).mockImplementationOnce((_audience, options) => {
    oldSignal = options?.signal;
    return new Promise((_resolve, reject) => {
      rejectOld = reject;
    });
  });
  await act(async () => {});
  const next = { ...service, load: vi.fn<WorkstudyService['load']>(async () => snapshot()) };
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
  fireEvent.click(view.getByRole('button', { name: '重新整理職涯機會' }));
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
  vi.mocked(service.load).mockImplementationOnce((_audience, options) => {
    signal = options?.signal;
    return new Promise((_resolve, reject) => {
      signal?.addEventListener('abort', () => reject(new Error('讀取已取消')), { once: true });
    });
  });
  act(() => changed());
  fireEvent.click(view.getByRole('button', { name: '編輯測試用工讀' }));
  fireEvent.click(view.getByRole('button', { name: '儲存機會' }));
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
  vi.mocked(service.load).mockImplementation(
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
  vi.mocked(service.load).mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  act(() => changed());
  fireEvent.click(view.getByRole('button', { name: '編輯測試用工讀' }));
  fireEvent.click(view.getByRole('button', { name: '儲存機會' }));
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
  fireEvent.click(view.getByText('申請'));
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

test('shows every published opportunity type and filters without exposing unpublished records', async () => {
  const { view, data, changed } = setup();
  data.opportunities = [
    opportunity,
    { ...opportunity, id: 'internship', type: 'internship', title: '測試實習' },
    { ...opportunity, id: 'fair', type: 'fair', title: '測試校徵' },
    { ...opportunity, id: 'hidden', type: 'internship', title: '未上架機會', published: false },
  ];
  await view.findByText('測試實習');
  expect(view.getByText('類型：工讀')).toBeTruthy();
  expect(view.getByText('類型：實習')).toBeTruthy();
  expect(view.getByText('類型：校徵')).toBeTruthy();
  expect(view.queryByText('未上架機會')).toBeNull();
  fireEvent.change(view.getByLabelText('類型'), { target: { value: 'internship' } });
  expect(view.queryByText('測試用工讀')).toBeNull();
  expect(view.queryByText('測試校徵')).toBeNull();
  expect(view.getByText('測試實習')).toBeTruthy();
  data.opportunities = data.opportunities.filter((o) => o.type !== 'internship');
  await act(async () => {
    changed();
  });
  await waitFor(() => expect(view.getByText('沒有符合目前篩選條件的職涯機會。')).toBeTruthy());
});

test.each([
  ['internship', true],
  ['fair', true],
  ['internship', false],
  ['fair', false],
] as const)(
  '%s directs students to the school announcement (source: %s)',
  async (type, hasSource) => {
    const { view, data, service } = setup();
    data.opportunities = [
      { ...opportunity, type, sourceUrl: hasSource ? opportunity.sourceUrl : '' },
    ];
    await view.findByText('此類機會請依校方公告方式報名');
    expect(view.queryByRole('button', { name: `應徵${opportunity.title}` })).toBeNull();
    expect(view.queryByText('工讀權益')).toBeNull();
    expect(view.queryByLabelText('聯絡方式')).toBeNull();
    expect(view.queryByRole('button', { name: '送出申請' })).toBeNull();
    if (hasSource) {
      expect(view.getByRole('link', { name: '校方原始公告 ↗' }).getAttribute('href')).toBe(
        opportunity.sourceUrl,
      );
    } else {
      expect(view.queryByRole('link', { name: '校方原始公告 ↗' })).toBeNull();
    }
    expect(service.execute).not.toHaveBeenCalled();
  },
);

function pendingExecution(service: WorkstudyService) {
  let resolve!: () => void;
  let reject!: (error: Error) => void;
  vi.mocked(service.execute).mockImplementationOnce(
    (command) =>
      new Promise((done, fail) => {
        resolve = () =>
          done({
            id:
              command.action === 'save'
                ? command.opportunity.id || 'created-opening'
                : application.id,
          });
        reject = fail;
      }),
  );
  return { resolve: () => resolve(), reject: (error: Error) => reject(error) };
}

test.each(['title', 'slots', 'deadline', 'unchanged', 'rejected', 'rejected-unchanged'])(
  'opportunity save only clears the submitted draft (%s)',
  async (change) => {
    const { view, service, data } = setup('staff');
    fireEvent.click(await view.findByRole('button', { name: '編輯測試用工讀' }));
    fireEvent.change(view.getByLabelText('標題'), { target: { value: '送出的標題' } });
    const pending = pendingExecution(service);
    fireEvent.click(view.getByRole('button', { name: '儲存機會' }));
    expect(service.execute).toHaveBeenCalledWith({
      action: 'save',
      opportunity: { ...opportunity, title: '送出的標題' },
    });
    const field = change === 'slots' ? /每週時段/ : change === 'deadline' ? /截止時間（/ : '標題';
    const newer =
      change === 'slots'
        ? '4 13:00 15:00'
        : change === 'deadline'
          ? '2099-02-01 12:00'
          : '尚未儲存的新標題';
    const edited = change !== 'unchanged' && change !== 'rejected-unchanged';
    const rejected = change.startsWith('rejected');
    if (edited) fireEvent.change(view.getByLabelText(field), { target: { value: newer } });
    if (!rejected) data.opportunities = [{ ...opportunity, title: '送出的標題', revision: 2 }];
    await act(async () => {
      if (rejected) pending.reject(new Error('儲存失敗，請重試。'));
      else pending.resolve();
    });
    if (change === 'unchanged') {
      expect(view.queryByLabelText('標題')).toBeNull();
      expect(view.getByText('送出的標題')).toBeTruthy();
    } else {
      expect((view.getByLabelText(field) as HTMLInputElement).value).toBe(
        edited ? newer : '送出的標題',
      );
      expect(view.getByRole('button', { name: '儲存機會' })).toBeTruthy();
    }
    if (rejected) expect(view.getByText('儲存失敗，請重試。')).toBeTruthy();
    if (edited || rejected) {
      fireEvent.click(view.getByRole('button', { name: '儲存機會' }));
      expect(service.execute).toHaveBeenLastCalledWith({
        action: 'save',
        opportunity: {
          ...opportunity,
          title: edited && change !== 'slots' && change !== 'deadline' ? newer : '送出的標題',
          revision: rejected ? opportunity.revision : opportunity.revision + 1,
          ...(change === 'slots' ? { slots: [{ day: 4, start: '13:00', end: '15:00' }] } : {}),
          ...(change === 'deadline' ? { deadline: '2099-02-01T04:00:00.000Z' } : {}),
        },
      });
    }
  },
);

test.each([
  ['原本的回覆', true, false],
  ['', true, false],
  ['原本的回覆', false, false],
  ['', false, false],
  ['原本的回覆', true, true],
  ['原本的回覆', false, true],
  ['', false, true],
] as const)(
  'review preserves newer drafts and unrelated opportunity/reply drafts (%s, newer: %s, rejected: %s)',
  async (submitted, newer, rejected) => {
    const { view, service, data } = setup('staff');
    data.applications = [
      { ...application, state: 'read', message: '已存回覆' },
      { ...application, id: 'other-application', opportunityTitle: '另一筆申請', state: 'read' },
    ];
    fireEvent.click(await view.findByRole('button', { name: '編輯測試用工讀' }));
    fireEvent.change(view.getByLabelText('標題'), { target: { value: '機會草稿' } });
    fireEvent.click(view.getByRole('button', { name: '申請' }));
    fireEvent.change(view.getByLabelText(/給另一筆申請申請人的回覆/), {
      target: { value: '另一筆回覆草稿' },
    });
    if (submitted)
      fireEvent.change(view.getByLabelText(/給測試用工讀申請人的回覆/), {
        target: { value: submitted },
      });
    else fireEvent.click(view.getAllByRole('button', { name: '清除回覆（隨狀態更新儲存）' })[0]);
    const pending = pendingExecution(service);
    fireEvent.click(view.getAllByRole('button', { name: '改為錄取' })[0]);
    expect(service.execute).toHaveBeenCalledWith({
      action: 'review',
      applicationId: application.id,
      revision: application.revision,
      state: 'accepted',
      message: submitted,
    });
    if (newer)
      fireEvent.change(view.getByLabelText(/給測試用工讀申請人的回覆/), {
        target: { value: '儲存中新增的回覆' },
      });
    if (!rejected)
      data.applications[0] = {
        ...data.applications[0],
        revision: application.revision + 1,
        state: 'accepted',
        message: submitted,
      };
    await act(async () => {
      if (rejected) pending.reject(new Error('儲存失敗，請重試。'));
      else pending.resolve();
    });
    expect((view.getByLabelText('標題') as HTMLInputElement).value).toBe('機會草稿');
    expect((view.getByLabelText(/給另一筆申請申請人的回覆/) as HTMLInputElement).value).toBe(
      '另一筆回覆草稿',
    );
    expect((view.getByLabelText(/給測試用工讀申請人的回覆/) as HTMLInputElement).value).toBe(
      newer ? '儲存中新增的回覆' : submitted,
    );
    if (!rejected) {
      // Removing an unchanged draft must also remove its old revision; newer drafts stay protected.
      expect(
        !!view.queryByText('這筆申請已由其他承辦更新，請捨棄草稿並確認最新回覆後再操作。'),
      ).toBe(newer);
    }
  },
);

test.each(['apply', 'withdraw', 'sources'] as const)(
  '%s success preserves an already open opportunity draft',
  async (action) => {
    // These actions live in different audience views. Seed only the opportunity draft
    // to check cleanup isolation without changing the component's audience/session.
    const actualUseState = React.useState;
    let nullStates = 0;
    const seed = vi
      .mocked(useState)
      .mockImplementation(((initial: unknown) =>
        actualUseState(
          initial === null && ++nullStates === 4
            ? { ...opportunity, title: '保留中的機會草稿' }
            : initial,
        )) as typeof React.useState);
    let result: ReturnType<typeof setup>;
    try {
      result = setup(action === 'sources' ? 'ops' : 'student');
    } finally {
      seed.mockImplementation(actualUseState);
    }
    const { view, data, service } = result;
    data.sources = { office: true, departments: true, taiwanjobs: true, revision: 0 };
    if (action === 'withdraw') data.applications = [application];
    await view.findByLabelText('標題');
    const pending = pendingExecution(service);
    if (action === 'sources') {
      fireEvent.click(await view.findByRole('checkbox', { name: '系所' }));
    } else if (action === 'withdraw') {
      fireEvent.click(await view.findByRole('button', { name: '撤回申請' }));
      fireEvent.click(view.getByRole('button', { name: '確認撤回申請' }));
    } else {
      fireEvent.click(await view.findByRole('button', { name: '應徵測試用工讀' }));
      fireEvent.change(view.getByLabelText('聯絡方式'), {
        target: { value: 'student@example.test' },
      });
      fireEvent.click(view.getByRole('checkbox', { name: '我看過了' }));
      fireEvent.click(view.getByRole('button', { name: '送出申請' }));
    }
    expect(service.execute).toHaveBeenCalledWith(expect.objectContaining({ action }));
    await act(async () => pending.resolve());
    expect((view.getByLabelText('標題') as HTMLInputElement).value).toBe('保留中的機會草稿');
    if (action === 'apply') expect(view.queryByLabelText('聯絡方式')).toBeNull();
  },
);

test.each([false, true])(
  'new published draft keeps its saved id even if refresh fails: %s',
  async (refreshFails) => {
    const { view, service, data } = setup('staff');
    fireEvent.click(await view.findByRole('button', { name: '新增機會' }));
    for (const [label, value] of [
      ['標題', '新增測試工讀'],
      ['單位', opportunity.unit],
      ['時薪或待遇', opportunity.pay],
      ['校方公告網址', opportunity.sourceUrl],
      ['權益公告標題', opportunity.rightsTitle],
      ['權益公告網址', opportunity.rightsUrl],
      ['權益公告內容', opportunity.rightsText],
    ]) {
      fireEvent.change(view.getByRole('textbox', { name: label, exact: true }), {
        target: { value },
      });
    }
    fireEvent.change(view.getByLabelText(/每週時段/), { target: { value: '1 08:30 10:00' } });
    fireEvent.change(view.getByLabelText(/截止時間（/), { target: { value: '2099-12-01 17:00' } });
    fireEvent.click(view.getByRole('checkbox', { name: '上架' }));
    const pending = pendingExecution(service);
    fireEvent.click(view.getByRole('button', { name: '儲存機會' }));
    const first = vi.mocked(service.execute).mock.calls[0][0];
    if (first.action !== 'save') throw new Error('Expected a save command');
    expect(first.opportunity).toEqual(
      expect.objectContaining({ id: '', revision: 0, published: true }),
    );
    data.opportunities = [{ ...first.opportunity, id: 'created-opening', revision: 1 }];
    fireEvent.change(view.getByLabelText('標題'), { target: { value: '新增後繼續編輯的標題' } });
    if (refreshFails)
      vi.mocked(service.load).mockRejectedValueOnce(new Error('讀取失敗，請重試。'));
    await act(async () => pending.resolve());
    expect((view.getByLabelText('標題') as HTMLInputElement).value).toBe('新增後繼續編輯的標題');
    vi.mocked(service.execute).mockImplementationOnce(async (command) => {
      if (command.action !== 'save') throw new Error('Expected a save command');
      const existing = data.opportunities.find((o) => o.id === command.opportunity.id);
      expect(existing?.revision).toBe(command.opportunity.revision);
      data.opportunities = [{ ...command.opportunity, revision: command.opportunity.revision + 1 }];
      return { id: command.opportunity.id };
    });
    fireEvent.click(view.getByRole('button', { name: '儲存機會' }));
    await waitFor(() => expect(view.queryByLabelText('標題')).toBeNull());
    expect(service.execute).toHaveBeenLastCalledWith({
      action: 'save',
      opportunity: {
        ...first.opportunity,
        id: 'created-opening',
        revision: 1,
        title: '新增後繼續編輯的標題',
      },
    });
    expect(data.opportunities).toHaveLength(1);
    expect(data.opportunities[0].revision).toBe(2);
  },
);

test.each(['same', 'other', 'new'])(
  'save response does not change a switched draft: %s',
  async (target) => {
    const { view, service, data } = setup('staff');
    data.opportunities.push({
      ...opportunity,
      id: 'other-opening',
      title: '另一筆測試工讀',
      revision: 7,
    });
    fireEvent.click(await view.findByRole('button', { name: '編輯測試用工讀' }));
    const pending = pendingExecution(service);
    fireEvent.click(view.getByRole('button', { name: '儲存機會' }));
    const label =
      target === 'same' ? '編輯測試用工讀' : target === 'other' ? '編輯另一筆測試工讀' : '新增機會';
    fireEvent.click(view.getByRole('button', { name: label }));
    await act(async () => pending.resolve());
    expect((view.getByLabelText('標題') as HTMLInputElement).value).toBe(
      target === 'same' ? opportunity.title : target === 'other' ? '另一筆測試工讀' : '',
    );
    fireEvent.change(view.getByLabelText(/截止時間（/), { target: { value: '2099-12-01 17:00' } });
    fireEvent.click(view.getByRole('button', { name: '儲存機會' }));
    expect(service.execute).toHaveBeenLastCalledWith({
      action: 'save',
      opportunity: expect.objectContaining({
        id: target === 'same' ? opportunity.id : target === 'other' ? 'other-opening' : '',
        revision: target === 'same' ? opportunity.revision : target === 'other' ? 7 : 0,
      }),
    });
  },
);
