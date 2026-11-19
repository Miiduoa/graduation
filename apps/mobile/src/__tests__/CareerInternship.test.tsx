import React from 'react';
import { act, render, fireEvent, waitFor, within } from '@testing-library/react-native';
import { CareerInternship } from '../components/career/CareerInternship';
import { internshipRecord } from '../../../../packages/shared/testFixtures/careerInternship';
import type {
  InternshipAudience,
  InternshipReply,
  InternshipCommand,
} from '../../../../packages/shared/src/careerInternship';

function setup(audience: InternshipAudience = 'student', uid: string | null = 'student') {
  const record = internshipRecord();
  const snapshot = {
    rules: [record.rule],
    records: [record],
    audit: [],
    advisors: [{ uid: 'teacher', name: '測試指導老師', email: 'teacher@school.edu.tw' }],
    canManage: false,
  };
  const service = {
    load: jest.fn(async () => snapshot),
    execute: jest.fn(
      async (
        _command: Exclude<InternshipCommand, { action: 'list' }>,
      ): Promise<InternshipReply> => ({ id: 'record' }),
    ),
  };
  const props = {
    schoolId: 'pu',
    ownerKey: uid || 'guest',
    uid,
    audience,
    service,
    onLogin: jest.fn(),
    onAddCalendar: jest.fn(async () => undefined),
  };
  const view = render(<CareerInternship {...props} />);
  return { view, props, record, snapshot };
}
it('shows progress, recipient and calendar deadline; uses exact record version for hour entry', async () => {
  const { view, props } = setup();
  await waitFor(() => expect(view.getByText(/已登錄 0／需要 60/)).toBeTruthy());
  fireEvent.press(view.getByText('將申請加入行事曆'));
  await waitFor(() =>
    expect(props.onAddCalendar).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'internship-record-0', startsAt: '2026-12-01T09:00:00.000Z' }),
    ),
  );
  fireEvent.changeText(view.getByLabelText('實習日期（西元年-月-日）'), '2026-11-13');
  fireEvent.changeText(view.getByLabelText('實習時數'), '7.5');
  fireEvent.changeText(view.getByLabelText('工作內容與佐證說明'), '測試佐證');
  await waitFor(() => expect(view.getByText('儲存實習時數')).toBeTruthy());
  fireEvent.press(view.getByText('儲存實習時數'));
  await waitFor(() =>
    expect(props.service.execute).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'hours',
        id: 'record',
        revision: 1,
        entry: expect.objectContaining({ hours: 7.5 }),
      }),
    ),
  );
});
it('gates student actions at login and allows retry after a failed load', async () => {
  const { view, props } = setup('student', null);
  fireEvent.press(view.getByText('登入查看實習'));
  expect(props.onLogin).toHaveBeenCalled();
  expect(props.service.load).not.toHaveBeenCalled();
});
it('allows staff to prepare a rule with five recipients and deadlines', async () => {
  const { view } = setup('staff', 'staff');
  await waitFor(() => expect(view.getByText('新增系所規則')).toBeTruthy());
  fireEvent.press(view.getByText('新增系所規則'));
  expect(view.getByLabelText('每學分所需時數').props.value).toBe('60');
  expect(view.getByLabelText('5 交給誰')).toBeTruthy();
});
it('requires advisor selection and required fields before creating internship records', async () => {
  const { view, props, snapshot } = setup('student', 'student');
  await waitFor(() => expect(view.getByRole('button', { name: '建立實習紀錄' })).toBeTruthy());
  fireEvent.press(view.getByRole('button', { name: '建立實習紀錄' }));
  expect(view.getByText('請先選擇系所規則')).toBeTruthy();
  expect(view.getByText('請填寫實習機構')).toBeTruthy();
  expect(view.queryByLabelText('指導老師姓名')).toBeNull();
  expect(view.getByText('尚未選擇指導老師')).toBeTruthy();
  fireEvent.press(view.getByText('選擇測試系規則'));
  fireEvent.changeText(view.getByLabelText('實習機構'), '測試機構');
  fireEvent.changeText(
    view.getByLabelText('搜尋本校指導老師（姓名、學號或學校信箱）'),
    'teacher@school.edu.tw',
  );
  props.service.execute.mockResolvedValueOnce({
    snapshot: { advisors: snapshot.advisors, rules: [], records: [], audit: [] },
  });
  fireEvent.press(view.getByText('搜尋指導老師'));
  await waitFor(() => expect(view.getByText(/測試指導老師｜teacher@school.edu.tw/)).toBeTruthy());
  fireEvent.press(view.getByText(/測試指導老師｜teacher@school.edu.tw/));
  fireEvent.press(view.getByRole('button', { name: '建立實習紀錄' }));
  await waitFor(() =>
    expect(props.service.execute).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'create',
        teacherUid: 'teacher',
        organization: '測試機構',
      }),
    ),
  );
});
it('keeps student actions out of staff review and protects record version', async () => {
  const { view, props, record } = setup('staff', 'staff');
  record.documents[0].submitted = true;
  await waitFor(() => expect(view.getByText('確認申請')).toBeTruthy());
  fireEvent.press(view.getByText('確認申請'));
  await waitFor(() =>
    expect(props.service.execute).toHaveBeenCalledWith({
      action: 'verifyDocument',
      id: 'record',
      revision: 1,
      index: 0,
      verified: true,
      message: '',
    }),
  );
  expect(view.queryByText('儲存實習時數')).toBeNull();
});
it('discards private records immediately when owner scope changes', async () => {
  const { view, props } = setup();
  await waitFor(() => expect(view.getByText(/測試用機構/)).toBeTruthy());
  view.rerender(<CareerInternship {...props} uid={null} ownerKey="guest" />);
  expect(view.queryByText(/測試用機構/)).toBeNull();
});

it('keeps student records out of the operations view', async () => {
  const { view } = setup('ops', 'admin');
  await waitFor(() => expect(view.getByText(/營運檢視不顯示學生名冊/)).toBeTruthy());
  expect(view.queryByText(/測試用機構/)).toBeNull();
});

it('aborts scoped polling, times out hanging reads and ignores late success and failure', async () => {
  jest.useFakeTimers();
  try {
    const record = internshipRecord();
    const snapshot = { rules: [record.rule], records: [record], audit: [] };
    const reads: {
      signal?: AbortSignal;
      resolve: (value: typeof snapshot) => void;
      reject: (error: Error) => void;
    }[] = [];
    const service = {
      load: jest.fn(
        (_audience: InternshipAudience, options?: { signal?: AbortSignal }) =>
          new Promise<typeof snapshot>((resolve, reject) =>
            reads.push({ signal: options?.signal, resolve, reject }),
          ),
      ),
      execute: jest.fn(async () => ({})),
    };
    const props = {
      schoolId: 'pu',
      ownerKey: 'student',
      uid: 'student',
      audience: 'student' as const,
      service,
      onLogin: jest.fn(),
      onAddCalendar: async () => undefined,
    };
    const view = render(<CareerInternship {...props} />);
    await act(async () => {
      jest.advanceTimersByTime(10000);
    });
    expect(reads).toHaveLength(1);
    view.rerender(<CareerInternship {...props} schoolId="other" />);
    expect(reads[0].signal?.aborted).toBe(true);
    await act(async () => {
      reads[0].reject(new Error('舊學校錯誤'));
    });
    expect(view.queryByText('舊學校錯誤')).toBeNull();
    await act(async () => {
      jest.advanceTimersByTime(15000);
    });
    expect(reads[1].signal?.aborted).toBe(true);
    expect(view.getByText('讀取實習進度逾時，請重新整理。')).toBeTruthy();
    await act(async () => {
      jest.advanceTimersByTime(5000);
    });
    await act(async () => {
      reads[2].resolve(snapshot);
    });
    expect(view.getByText(/測試用機構/)).toBeTruthy();
    await act(async () => {
      reads[1].resolve({ ...snapshot, records: [{ ...record, organization: '逾時舊結果' }] });
    });
    expect(view.queryByText(/逾時舊結果/)).toBeNull();
    await act(async () => {
      jest.advanceTimersByTime(10000);
    });
    view.unmount();
    expect(reads[3].signal?.aborted).toBe(true);
    const count = reads.length;
    await act(async () => {
      reads[3].reject(new Error('卸載錯誤'));
      jest.advanceTimersByTime(60000);
    });
    expect(reads).toHaveLength(count);
  } finally {
    jest.useRealTimers();
  }
});

it('keeps searched advisors selectable after empty and missing advisor poll payloads', async () => {
  jest.useFakeTimers();
  try {
    const { view, props, snapshot } = setup();
    await act(async () => {});
    props.service.load.mockImplementation(async () => ({ ...snapshot, advisors: [] }));
    props.service.execute.mockResolvedValueOnce({ snapshot: { ...snapshot, records: [] } });
    const beforePoll = props.service.load.mock.calls.length;
    fireEvent.changeText(
      view.getByLabelText('搜尋本校指導老師（姓名、學號或學校信箱）'),
      'T0000001',
    );
    await act(async () => {
      fireEvent.press(view.getByText('搜尋指導老師'));
    });
    expect(view.getByText(/測試指導老師｜teacher@school.edu.tw/)).toBeTruthy();
    expect(props.service.load).toHaveBeenCalledTimes(beforePoll);
    expect(props.service.execute).toHaveBeenCalledWith({
      action: 'advisorSearch',
      keyword: 'T0000001',
      limit: 20,
    });
    await act(async () => {
      jest.advanceTimersByTime(10000);
    });
    expect(props.service.load.mock.calls.length).toBeGreaterThan(beforePoll);
    props.service.load.mockImplementation(async () => {
      return {
        rules: snapshot.rules,
        records: snapshot.records,
        audit: [],
        canManage: false,
      } as typeof snapshot;
    });
    await act(async () => {
      jest.advanceTimersByTime(10000);
    });
    fireEvent.press(view.getByText(/測試指導老師｜teacher@school.edu.tw/));
    fireEvent.press(view.getByText('選擇測試系規則'));
    fireEvent.changeText(view.getByLabelText('實習機構'), '測試機構');
    await act(async () => {
      fireEvent.press(view.getByRole('button', { name: '建立實習紀錄' }));
    });
    expect(props.service.execute).toHaveBeenLastCalledWith(
      expect.objectContaining({ action: 'create', teacherUid: 'teacher', teacher: '測試指導老師' }),
    );
    expect(
      props.service.execute.mock.calls.filter(([c]) => c.action === 'advisorSearch'),
    ).toHaveLength(1);
    view.unmount();
  } finally {
    jest.useRealTimers();
  }
});
it('shows advisor pending work with student identity and hides verified document controls', async () => {
  const { view, record } = setup('student', 'teacher');
  record.studentName = '王小明';
  record.studentId = 'S123';
  record.documents[0].submitted = true;
  record.documents[0].verified = true;
  record.documents[1].submitted = true;
  await waitFor(() => expect(view.getByText('待我確認')).toBeTruthy());
  expect(view.getByText(/王小明.*S123/)).toBeTruthy();
  expect(view.queryByRole('button', { name: '建立實習紀錄' })).toBeNull();
  expect(view.queryByText('確認申請')).toBeNull();
  expect(view.queryByText('退回申請')).toBeNull();
  expect(view.getByText('確認計畫書')).toBeTruthy();
  expect(view.getByText(/指導老師已確認 0 小時/)).toBeTruthy();
});

it('uses readable fallbacks for missing student identity in review', async () => {
  const { view } = setup('staff', 'staff');
  await waitFor(() => expect(view.getByText(/姓名待確認.*學號未提供/)).toBeTruthy());
  expect(view.queryByText(/學生帳號/)).toBeNull();
});

it.each(['teacher', 'student'])(
  'keeps rejected %s operations beside their control after a successful poll',
  async (viewer) => {
    jest.useFakeTimers();
    try {
      const { view, props, record } = setup('student', viewer);
      record.documents.forEach((d) => {
        d.submitted = true;
        d.verified = true;
      });
      record.hours = [{ id: 'verified', date: '2026-11-13', hours: 60, note: '', verified: true }];
      await act(async () => {});
      const label = viewer === 'teacher' ? '指導老師確認結案' : '儲存實習時數';
      const button = view.getByRole('button', { name: label });
      props.service.execute.mockRejectedValueOnce(new Error('時數與所有文件確認完成後才能結案。'));
      await act(async () => {
        fireEvent.press(button);
      });
      if (viewer === 'teacher') {
        await act(async () => {
          fireEvent.press(view.getByText('確定結案'));
        });
      }
      const card = view.getByTestId(`internship-${record.id}`);
      expect(within(card).getByText('時數與所有文件確認完成後才能結案。')).toBeTruthy();
      const loads = props.service.load.mock.calls.length;
      await act(async () => {
        jest.advanceTimersByTime(10000);
      });
      expect(props.service.load.mock.calls.length).toBeGreaterThan(loads);
      expect(within(card).getByText('時數與所有文件確認完成後才能結案。')).toBeTruthy();
      view.unmount();
    } finally {
      jest.useRealTimers();
    }
  },
);
it('disables close-out and lists missing rule documents and verified hours', async () => {
  const { view, props } = setup('student', 'teacher');
  await waitFor(() => expect(view.getByText(/還不能結案：/)).toBeTruthy());
  expect(JSON.stringify(view.getByText(/還不能結案：/).props.children)).toContain('申請尚未繳交');
  expect(JSON.stringify(view.getByText(/還不能結案：/).props.children)).toContain(
    '已確認時數 0／需要 60 小時',
  );
  expect(
    view.getByRole('button', { name: '指導老師確認結案' }).props.accessibilityState.disabled,
  ).toBe(true);
  fireEvent.press(view.getByRole('button', { name: '指導老師確認結案' }));
  expect(props.service.execute).not.toHaveBeenCalled();
});
it('hides teacher application chrome even with no assignments and keeps own records', async () => {
  const { view, snapshot, props, record } = setup('student', 'teacher');
  Object.assign(snapshot, { viewerRole: 'teacher' });
  await waitFor(() => expect(view.getByText(/已登錄 0／需要 60/)).toBeTruthy());
  expect(view.queryByText('前往產業實習網申請')).toBeNull();
  expect(view.queryByText('選擇測試系規則')).toBeNull();
  expect(view.queryByRole('button', { name: '建立實習紀錄' })).toBeNull();
  snapshot.records = [];
  fireEvent.press(view.getByText('重新整理實習進度'));
  await waitFor(() => expect(props.service.load.mock.calls.length).toBeGreaterThan(1));
  expect(view.queryByText('前往產業實習網申請')).toBeNull();
  snapshot.records = [{ ...record, id: 'own', uid: 'teacher' }];
  fireEvent.press(view.getByText('重新整理實習進度'));
  await waitFor(() => expect(view.getByText('我的實習')).toBeTruthy());
  expect(view.getByRole('button', { name: '建立實習紀錄' })).toBeTruthy();
});
it('shows one own-record heading and hides the selection hint after selecting a rule', async () => {
  const { view } = setup();
  await waitFor(() => expect(view.getByText('選擇測試系規則')).toBeTruthy());
  expect(view.getAllByText('我的實習')).toHaveLength(1);
  fireEvent.press(view.getByText('選擇測試系規則'));
  expect(view.queryByText('請先在上方選擇系所規則，再填寫以下資料。')).toBeNull();
});

it('asks before close-out and preserves success on the confirmed card after reload', async () => {
  const { view, props, record, snapshot } = setup('student', 'teacher');
  record.documents.forEach((d) => {
    d.submitted = true;
    d.verified = true;
  });
  record.hours = [{ id: 'ready', date: '2026-11-13', hours: 60, note: '', verified: true }];
  await waitFor(() => expect(view.getByText('指導老師確認結案')).toBeTruthy());
  fireEvent.press(view.getByText('指導老師確認結案'));
  expect(props.service.execute).not.toHaveBeenCalled();
  expect(view.getByText('確定要為這筆實習結案？結案後就不能再從這裡撤回。')).toBeTruthy();
  fireEvent.press(view.getByText('取消'));
  expect(view.queryByText('確定結案')).toBeNull();
  expect(props.service.execute).not.toHaveBeenCalled();
  fireEvent.press(view.getByText('指導老師確認結案'));
  props.service.load.mockImplementation(async () => ({
    ...snapshot,
    records: [{ ...record, revision: 2, confirmed: true }],
  }));
  fireEvent.press(view.getByText('確定結案'));
  await waitFor(() =>
    expect(props.service.execute).toHaveBeenCalledWith({
      action: 'confirm',
      id: record.id,
      revision: 1,
    }),
  );
  await waitFor(() =>
    expect(view.getByText(/已結案。指導老師已確認；學分仍以教務認定為準。/)).toBeTruthy(),
  );
  const card = view.getByTestId(`internship-${record.id}`);
  expect(within(card).getByText('已儲存，正在更新進度。')).toBeTruthy();
  expect(view.queryByText('指導老師確認結案')).toBeNull();
  fireEvent.press(view.getByText('重新整理實習進度'));
  await waitFor(() => expect(props.service.load).toHaveBeenCalledTimes(3));
  expect(
    within(view.getByTestId(`internship-${record.id}`)).getByText('已儲存，正在更新進度。'),
  ).toBeTruthy();
});
it.each(['一般操作錯誤', '另一個視窗已更新這筆紀錄，已為你重新整理。'])(
  'keeps hours feedback when polling flips the label: %s',
  async (message) => {
    jest.useFakeTimers();
    try {
      const { view, props, record, snapshot } = setup('student', 'teacher');
      record.hours = [{ id: 'hours1', date: '2026-11-13', hours: 60, note: '', verified: false }];
      await act(async () => {});
      const before = props.service.load.mock.calls.length;
      props.service.execute.mockRejectedValueOnce(new Error(message));
      // Only the conflict must reload immediately. The ordinary rejection changes on the poll.
      props.service.load.mockImplementation(async () => ({
        ...snapshot,
        records: [
          { ...record, revision: 2, hours: record.hours.map((h) => ({ ...h, verified: true })) },
        ],
      }));
      await act(async () => {
        fireEvent.press(view.getByText('確認2026-11-13時數'));
      });
      expect(props.service.load.mock.calls.length).toBe(
        before + (message === '一般操作錯誤' ? 0 : 1),
      );
      expect(within(view.getByTestId(`internship-${record.id}`)).getByText(message)).toBeTruthy();
      await act(async () => {
        jest.advanceTimersByTime(10000);
      });
      const card = view.getByTestId(`internship-${record.id}`);
      expect(within(card).getByText('撤銷確認2026-11-13時數')).toBeTruthy();
      expect(within(card).getByText(message)).toBeTruthy();
      view.unmount();
    } finally {
      jest.useRealTimers();
    }
  },
);

it('keeps conflict feedback on the card when reload removes the document control', async () => {
  const { view, props, record, snapshot } = setup('student', 'teacher');
  record.documents[0].submitted = true;
  await waitFor(() => expect(view.getByText('確認申請')).toBeTruthy());
  const message = '另一個視窗已更新這筆紀錄，已為你重新整理。';
  props.service.execute.mockRejectedValueOnce(
    Object.assign(new Error(message), { code: 'aborted' }),
  );
  props.service.load.mockImplementation(async () => ({
    ...snapshot,
    records: [
      {
        ...record,
        revision: 2,
        documents: record.documents.map((d) => ({ ...d, verified: true })),
      },
    ],
  }));
  await act(async () => {
    fireEvent.press(view.getByText('確認申請'));
  });
  await waitFor(() => expect(view.queryByText('確認申請')).toBeNull());
  expect(within(view.getByTestId(`internship-${record.id}`)).getByText(message)).toBeTruthy();
});

it('preserves document and hours drafts through polling and failed reads, with current revision on submit', async () => {
  jest.useFakeTimers();
  try {
    const { view, props, record, snapshot } = setup();
    await act(async () => {});
    fireEvent.changeText(view.getByLabelText('申請文件連結'), 'https://example.test/draft');
    fireEvent.changeText(view.getByLabelText('實習日期（西元年-月-日）'), '2026-11-17');
    fireEvent.changeText(view.getByLabelText('實習時數'), '8');
    fireEvent.changeText(view.getByLabelText('工作內容與佐證說明'), '未送出的時數草稿');
    props.service.load.mockResolvedValueOnce({
      ...snapshot,
      records: [
        {
          ...record,
          revision: 2,
          documents: record.documents.map((d) => ({ ...d, url: 'https://example.test/server' })),
        },
      ],
    });
    await act(async () => {
      jest.advanceTimersByTime(10000);
    });
    expect(view.getByLabelText('申請文件連結').props.value).toBe('https://example.test/draft');
    expect(view.getByLabelText('計畫書文件連結').props.value).toBe('https://example.test/server');
    expect(view.getByLabelText('實習時數').props.value).toBe('8');
    expect(view.getByLabelText('工作內容與佐證說明').props.value).toBe('未送出的時數草稿');
    expect(view.getByText(/這筆實習紀錄已更新，尚未送出的草稿已保留/)).toBeTruthy();
    props.service.load.mockRejectedValueOnce(
      Object.assign(new Error('讀取失敗'), { code: 'unavailable' }),
    );
    await act(async () => {
      jest.advanceTimersByTime(10000);
    });
    expect(view.getByText('讀取失敗')).toBeTruthy();
    expect(view.queryByText('正在讀取實習進度…')).toBeNull();
    expect(view.getByLabelText('申請文件連結').props.value).toBe('https://example.test/draft');
    await act(async () => {
      fireEvent.press(view.getByText('登錄已繳交申請'));
    });
    expect(props.service.execute).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'document',
        revision: 2,
        url: 'https://example.test/draft',
      }),
    );
    view.unmount();
  } finally {
    jest.useRealTimers();
  }
});

it('preserves reply drafts when a polled record changes review sections', async () => {
  jest.useFakeTimers();
  try {
    const { view, props, record, snapshot } = setup('student', 'teacher');
    record.documents[0].submitted = true;
    await act(async () => {});
    expect(view.getByText('待我確認')).toBeTruthy();
    fireEvent.changeText(view.getByLabelText('申請退回原因'), '未送出的回覆');
    // A submitted, verified document leaves the pending review group.
    props.service.load.mockResolvedValueOnce({
      ...snapshot,
      records: [{ ...record, revision: 2, confirmed: true }],
    });
    await act(async () => {
      jest.advanceTimersByTime(10000);
    });
    expect(view.getByText('其他實習紀錄')).toBeTruthy();
    expect(view.getByText(/尚未送出的草稿已保留/)).toBeTruthy();
    props.service.load.mockResolvedValueOnce({
      ...snapshot,
      records: [{ ...record, revision: 3 }],
    });
    await act(async () => {
      jest.advanceTimersByTime(10000);
    });
    expect(view.getByLabelText('申請退回原因').props.value).toBe('未送出的回覆');
    await act(async () => {
      fireEvent.press(view.getByText('退回申請'));
    });
    expect(props.service.execute).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'verifyDocument',
        revision: 3,
        message: '未送出的回覆',
      }),
    );
    view.unmount();
  } finally {
    jest.useRealTimers();
  }
});

it('shows an initial load error with retry instead of loading or an empty result', async () => {
  const { view, props } = setup();
  props.service.load.mockRejectedValueOnce(new Error('暫時無法讀取'));
  // The first read is already in flight; request a fresh scope to exercise an initial failure.
  view.rerender(<CareerInternship {...props} schoolId="other" />);
  await waitFor(() => expect(view.getByText('暫時無法讀取')).toBeTruthy());
  expect(view.queryByText('正在讀取實習進度…')).toBeNull();
  expect(view.queryByText('目前沒有實習紀錄。')).toBeNull();
  fireEvent.press(view.getByText('重試讀取實習進度'));
  await waitFor(() => expect(view.getByText(/測試用機構/)).toBeTruthy());
  expect(view.queryByText('暫時無法讀取')).toBeNull();
});

it('keeps the saved document URL when refresh fails and resubmits the saved value', async () => {
  const { view, props, record } = setup();
  const oldUrl = 'https://example.test/old';
  const savedUrl = 'https://example.test/saved';
  record.documents[0].url = oldUrl;
  await waitFor(() => expect(view.getByLabelText('申請文件連結').props.value).toBe(oldUrl));
  props.service.load.mockRejectedValue(
    Object.assign(new Error('儲存後讀取失敗'), { code: 'functions/unavailable' }),
  );
  fireEvent.changeText(view.getByLabelText('申請文件連結'), savedUrl);
  await act(async () => {
    fireEvent.press(view.getByText('登錄已繳交申請'));
  });
  await waitFor(() => expect(view.getByText('儲存後讀取失敗')).toBeTruthy());
  expect(props.service.execute).toHaveBeenCalledTimes(1);
  expect(view.getByLabelText('申請文件連結').props.value).toBe(savedUrl);
  await act(async () => {
    fireEvent.press(view.getByText('登錄已繳交申請'));
  });
  expect(props.service.execute).toHaveBeenCalledTimes(2);
  expect(props.service.execute).toHaveBeenLastCalledWith(
    expect.objectContaining({ action: 'document', index: 0, url: savedUrl, submitted: true }),
  );
  expect(view.getByLabelText('申請文件連結').props.value).toBe(savedUrl);
});

it.each([
  ['student', 'permission-denied'],
  ['staff', 'functions/permission-denied'],
  ['student', 'unauthenticated'],
  ['student', 'firestore/not-found'],
  ['student', 'auth/user-token-expired'],
  ['student', 'auth/network-request-failed'],
  ['student', 'unknown'],
] as const)(
  'clears private snapshots and %s drafts after a %s poll failure',
  async (audience, code) => {
    jest.useFakeTimers();
    try {
      const { view, props, record, snapshot } = setup(
        audience,
        audience === 'staff' ? 'staff' : 'student',
      );
      record.studentName = '王小明';
      record.studentId = 'S123';
      record.documents[0].submitted = true;
      record.documents[0].url = 'https://example.test/saved';
      await act(async () => {});
      expect(view.getByText(/測試用機構/)).toBeTruthy();
      if (audience === 'student') {
        fireEvent.changeText(view.getByLabelText('實習機構'), '未送出的機構');
        fireEvent.changeText(
          view.getByLabelText('申請文件連結'),
          'https://example.test/private-draft',
        );
        fireEvent.changeText(view.getByLabelText('實習時數'), '8');
        fireEvent.press(view.getByText('選擇測試系規則'));
        fireEvent.press(view.getByText(/測試指導老師｜teacher@school.edu.tw/));
      } else {
        expect(view.getByText(/王小明.*S123/)).toBeTruthy();
        fireEvent.changeText(view.getByLabelText('申請退回原因'), '未送出的回覆');
        fireEvent.press(view.getByText('新增系所規則'));
        fireEvent.changeText(view.getByLabelText('系所'), '未送出的系所');
      }
      props.service.load.mockRejectedValueOnce(Object.assign(new Error('讀取權限失效'), { code }));
      await act(async () => {
        jest.advanceTimersByTime(10000);
      });
      expect(view.getByText('讀取權限失效')).toBeTruthy();
      expect(view.queryByText('正在讀取實習進度…')).toBeNull();
      expect(view.queryByText(/測試用機構/)).toBeNull();
      expect(view.queryByText(/王小明.*S123/)).toBeNull();
      expect(view.queryByTestId(`internship-${record.id}`)).toBeNull();
      expect(view.queryByLabelText('系所')).toBeNull();
      props.service.load.mockResolvedValueOnce({ ...snapshot, advisors: [] });
      await act(async () => {
        fireEvent.press(view.getByText('重試讀取實習進度'));
      });
      expect(view.queryByText('讀取權限失效')).toBeNull();
      if (audience === 'student') {
        expect(view.getByLabelText('實習機構').props.value).toBe('');
        expect(view.getByLabelText('申請文件連結').props.value).toBe('https://example.test/saved');
        expect(view.getByLabelText('實習時數').props.value).toBe('');
        expect(view.getByText('選擇測試系規則')).toBeTruthy();
        expect(view.getByText(/已選擇指導老師：.*尚未選擇/)).toBeTruthy();
        expect(view.queryByText(/測試指導老師｜teacher@school.edu.tw/)).toBeNull();
      } else {
        expect(view.getByLabelText('申請退回原因').props.value).toBe('');
        expect(view.queryByLabelText('系所')).toBeNull();
      }
      view.unmount();
    } finally {
      jest.useRealTimers();
    }
  },
);

it.each([
  { code: 'functions/unavailable' },
  { code: 'firestore/deadline-exceeded' },
  { code: 'internal' },
  { code: 'network-request-failed' },
  { code: 'timeout' },
  new TypeError('Failed to fetch'),
  Object.assign(new Error('讀取逾時'), { name: 'TimeoutError' }),
])('keeps the snapshot and drafts after a transient poll failure: %s', async (error) => {
  jest.useFakeTimers();
  try {
    const { view, props } = setup();
    await act(async () => {});
    fireEvent.changeText(view.getByLabelText('申請文件連結'), 'https://example.test/draft');
    props.service.load.mockRejectedValueOnce(error);
    await act(async () => {
      jest.advanceTimersByTime(10000);
    });
    expect(view.getByText(/測試用機構/)).toBeTruthy();
    expect(view.getByLabelText('申請文件連結').props.value).toBe('https://example.test/draft');
    expect(view.getByRole('alert')).toBeTruthy();
    expect(view.getByText('重試讀取實習進度')).toBeTruthy();
    expect(view.queryByText('正在讀取實習進度…')).toBeNull();
    view.unmount();
  } finally {
    jest.useRealTimers();
  }
});

// Hold the write open so edits and refreshes can happen before it completes.
function pendingSave() {
  let resolve!: (reply: InternshipReply) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<InternshipReply>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

it.each(['newer', 'unchanged', 'rejected'] as const)(
  'preserves only unsaved URL input after an in-flight save: %s',
  async (scenario) => {
    const { view, props, record, snapshot } = setup();
    await waitFor(() => expect(view.getByLabelText('申請文件連結').props.value).toBe(''));
    const pending = pendingSave();
    props.service.execute.mockReturnValueOnce(pending.promise);
    const submitted = 'https://example.test/submitted';
    const newer = 'https://example.test/newer';
    const server = 'https://example.test/saved';
    fireEvent.changeText(view.getByLabelText('申請文件連結'), submitted);
    fireEvent.press(view.getByText('登錄已繳交申請'));
    expect(props.service.execute).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'document', url: submitted, revision: 1 }),
    );
    if (scenario === 'newer') fireEvent.changeText(view.getByLabelText('申請文件連結'), newer);
    props.service.load.mockResolvedValue({
      ...snapshot,
      records: [
        {
          ...record,
          revision: 2,
          documents: record.documents.map((d, i) =>
            i === 0 ? { ...d, url: server, submitted: true } : d,
          ),
        },
      ],
    });
    await act(async () => {
      if (scenario === 'rejected') pending.reject(new Error('儲存失敗'));
      else pending.resolve({ id: record.id });
    });
    if (scenario === 'rejected') {
      expect(view.getByText('儲存失敗')).toBeTruthy();
      await act(async () => {
        fireEvent.press(view.getByText('重新整理實習進度'));
      });
    }
    expect(props.service.load).toHaveBeenCalledTimes(2);
    expect(view.getByLabelText('申請文件連結').props.value).toBe(
      scenario === 'newer' ? newer : scenario === 'unchanged' ? server : submitted,
    );
    expect(!!view.queryByText(/尚未送出的草稿已保留/)).toBe(scenario !== 'unchanged');
  },
);

it.each(['newer', 'unchanged', 'rejected'] as const)(
  'preserves only unsaved rejection input after an in-flight save: %s',
  async (scenario) => {
    const { view, props, record, snapshot } = setup('student', 'teacher');
    record.documents[0].submitted = true;
    await waitFor(() => expect(view.getByLabelText('申請退回原因')).toBeTruthy());
    const pending = pendingSave();
    props.service.execute.mockReturnValueOnce(pending.promise);
    fireEvent.changeText(view.getByLabelText('申請退回原因'), '請補上佐證');
    fireEvent.press(view.getByText('退回申請'));
    expect(props.service.execute).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'verifyDocument', verified: false, message: '請補上佐證' }),
    );
    if (scenario === 'newer')
      fireEvent.changeText(view.getByLabelText('申請退回原因'), '請補上日期與佐證');
    props.service.load.mockResolvedValue({
      ...snapshot,
      records: [
        {
          ...record,
          revision: 2,
          documents: record.documents.map((d, i) =>
            i === 0 ? { ...d, message: '請補上佐證（已儲存）' } : d,
          ),
        },
      ],
    });
    await act(async () => {
      if (scenario === 'rejected') pending.reject(new Error('儲存失敗'));
      else pending.resolve({ id: record.id });
    });
    if (scenario === 'rejected') {
      expect(view.getByText('儲存失敗')).toBeTruthy();
      await act(async () => {
        fireEvent.press(view.getByText('重新整理實習進度'));
      });
    }
    expect(view.getByLabelText('申請退回原因').props.value).toBe(
      scenario === 'newer'
        ? '請補上日期與佐證'
        : scenario === 'unchanged'
          ? '請補上佐證（已儲存）'
          : '請補上佐證',
    );
    expect(!!view.queryByText(/尚未送出的草稿已保留/)).toBe(scenario !== 'unchanged');
  },
);

it.each(['unchanged', 'date', 'hours', 'note', 'rejected'] as const)(
  'resets hours only when the entire submitted draft is still current: %s',
  async (scenario) => {
    const { view, props, record, snapshot } = setup();
    await waitFor(() => expect(view.getByLabelText('實習時數')).toBeTruthy());
    const pending = pendingSave();
    props.service.execute.mockReturnValueOnce(pending.promise);
    fireEvent.changeText(view.getByLabelText('實習日期（西元年-月-日）'), '2026-11-17');
    fireEvent.changeText(view.getByLabelText('實習時數'), '7.5');
    fireEvent.changeText(view.getByLabelText('工作內容與佐證說明'), '送出的說明');
    fireEvent.press(view.getByText('儲存實習時數'));
    expect(props.service.execute).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'hours',
        revision: 1,
        entry: expect.objectContaining({ date: '2026-11-17', hours: 7.5, note: '送出的說明' }),
      }),
    );
    if (scenario === 'date')
      fireEvent.changeText(view.getByLabelText('實習日期（西元年-月-日）'), '2026-11-18');
    // A different string must remain a draft even if it is the same numeric hours.
    if (scenario === 'hours') fireEvent.changeText(view.getByLabelText('實習時數'), '07.5');
    if (scenario === 'note')
      fireEvent.changeText(view.getByLabelText('工作內容與佐證說明'), '較新的說明');
    props.service.load.mockResolvedValue({ ...snapshot, records: [{ ...record, revision: 2 }] });
    await act(async () => {
      if (scenario === 'rejected') pending.reject(new Error('儲存失敗'));
      else pending.resolve({ id: record.id });
    });
    if (scenario === 'rejected') {
      expect(view.getByText('儲存失敗')).toBeTruthy();
      await act(async () => {
        fireEvent.press(view.getByText('重新整理實習進度'));
      });
    }
    expect(view.getByLabelText('實習日期（西元年-月-日）').props.value).toBe(
      scenario === 'unchanged' ? '' : scenario === 'date' ? '2026-11-18' : '2026-11-17',
    );
    expect(view.getByLabelText('實習時數').props.value).toBe(
      scenario === 'unchanged' ? '' : scenario === 'hours' ? '07.5' : '7.5',
    );
    expect(view.getByLabelText('工作內容與佐證說明').props.value).toBe(
      scenario === 'unchanged' ? '' : scenario === 'note' ? '較新的說明' : '送出的說明',
    );
    expect(!!view.queryByText(/尚未送出的草稿已保留/)).toBe(scenario !== 'unchanged');
    if (scenario !== 'unchanged') {
      await act(async () => {
        fireEvent.press(view.getByText('儲存實習時數'));
      });
      expect(props.service.execute).toHaveBeenLastCalledWith(
        expect.objectContaining({ action: 'hours', revision: 2 }),
      );
      expect(view.getByLabelText('實習時數').props.value).toBe('');
      expect(view.queryByText(/尚未送出的草稿已保留/)).toBeNull();
    }
  },
);
