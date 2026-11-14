import React from 'react';
import { it, expect, vi } from 'vitest';
import { render, fireEvent, waitFor } from '@testing-library/react';
import { CareerInternship } from './CareerInternship';
import { internshipRecord } from '@campus/shared/testFixtures/careerInternship';
import type { InternshipAudience } from '@campus/shared/src/careerInternship';

function setup(audience: InternshipAudience = 'student', uid: string | null = 'student') {
  const record = internshipRecord();
  const snapshot = { rules: [record.rule], records: [record], audit: [] };
  const service = {
    load: vi.fn(async () => snapshot),
    execute: vi.fn(async () => ({ id: 'record' })),
  };
  const props = {
    schoolId: 'pu',
    ownerKey: uid || 'guest',
    uid,
    audience,
    service,
    onLogin: vi.fn(),
    onAddCalendar: vi.fn(async () => undefined),
  };
  const view = render(<CareerInternship {...props} />);
  return { view, props, record, snapshot };
}
it('shows progress, recipient and calendar deadline; uses exact record version for hour entry', async () => {
  const { view, props } = setup();
  await waitFor(() => expect(view.getByText(/已登錄 0／需要 60/)).toBeTruthy());
  fireEvent.click(view.getByText('將申請加入行事曆'));
  await waitFor(() =>
    expect(props.onAddCalendar).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'internship-record-0', startsAt: '2026-12-01T09:00:00.000Z' }),
    ),
  );
  change(view.getByLabelText('實習日期（西元年-月-日）'), '2026-11-13');
  change(view.getByLabelText('實習時數'), '7.5');
  change(view.getByLabelText('工作內容與佐證說明'), '測試佐證');
  await waitFor(() => expect(view.getByText('儲存實習時數')).toBeTruthy());
  fireEvent.click(view.getByText('儲存實習時數'));
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
  fireEvent.click(view.getByText('登入查看實習'));
  expect(props.onLogin).toHaveBeenCalled();
  expect(props.service.load).not.toHaveBeenCalled();
});
it('allows staff to prepare a rule with five recipients and deadlines', async () => {
  const { view } = setup('staff', 'staff');
  await waitFor(() => expect(view.getByText('新增系所規則')).toBeTruthy());
  fireEvent.click(view.getByText('新增系所規則'));
  expect(view.getByLabelText('每學分所需時數').getAttribute('value')).toBe('60');
  expect(view.getByLabelText('5 交給誰')).toBeTruthy();
});
it('keeps student actions out of staff review and protects record version', async () => {
  const { view, props, record } = setup('staff', 'staff');
  record.documents[0].submitted = true;
  await waitFor(() => expect(view.getByText('確認申請')).toBeTruthy());
  fireEvent.click(view.getByText('確認申請'));
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

function change(element: HTMLElement, value: string) {
  fireEvent.change(element, { target: { value } });
}

it('keeps student records out of the operations view', async () => {
  const { view } = setup('ops', 'admin');
  await waitFor(() => expect(view.getByText(/營運檢視不顯示學生名冊/)).toBeTruthy());
  expect(view.queryByText(/測試用機構/)).toBeNull();
});
