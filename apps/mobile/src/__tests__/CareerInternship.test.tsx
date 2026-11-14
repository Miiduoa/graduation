import React from 'react';
import { act, render, fireEvent, waitFor } from '@testing-library/react-native';
import { CareerInternship } from '../components/career/CareerInternship';
import { internshipRecord } from '../../../../packages/shared/testFixtures/careerInternship';
import type { InternshipAudience } from '../../../../packages/shared/src/careerInternship';

function setup(audience: InternshipAudience = 'student', uid: string | null = 'student') {
  const record = internshipRecord();
  const snapshot = { rules: [record.rule], records: [record], audit: [] };
  const service = {
    load: jest.fn(async () => snapshot),
    execute: jest.fn(async () => ({ id: 'record' })),
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
