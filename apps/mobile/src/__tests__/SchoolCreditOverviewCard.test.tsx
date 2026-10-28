import React from 'react';
import { act, fireEvent, render } from '@testing-library/react-native';
import type { PuCreditOverviewSnapshot } from '@campus/shared/src/puCreditOverview';
import { SchoolCreditOverviewCard } from '../components/SchoolCreditOverviewCard';
import { SchoolCreditOverviewError } from '../services/ownedSchoolCreditOverview';

const mockRead = jest.fn();
jest.mock('../services/ownedSchoolCreditOverview', () => ({
  ...jest.requireActual('../services/ownedSchoolCreditOverview'),
  loadOwnedSchoolCreditOverview: (...args: unknown[]) => mockRead(...args),
}));
const sample = (uid = 'a', subtotal = 71.5): PuCreditOverviewSnapshot => ({
  ownerUid: uid, schoolId: 'pu', fetchedAt: '2026-10-28T00:00:00Z',
  overview: { version: 1, source: 'pu-credit-review',
    totals: { required: 40.5, elective: 20, externalElective: 3, generalOld: 0, generalNew: 8, subtotal, totalRequired: 128, minorDouble: null },
    coverage: { status: 'partial', missingFields: ['minorDouble'] },
  },
});
const accountA = { uid: 'a' };
const accountB = { uid: 'b' };
beforeEach(() => mockRead.mockReset().mockResolvedValue(sample()));

test('shows reported values, explicit zero and unknown values without a graduation decision', async () => {
  const view = render(<SchoolCreditOverviewCard user={accountA} schoolId="tw-pu" />);
  expect(await view.findByText('71.5 學分')).toBeTruthy();
  expect(view.getByText('0 學分')).toBeTruthy();
  expect(view.getByText('未提供')).toBeTruthy();
  expect(view.getByText(/不等於畢業採計/)).toBeTruthy();
  expect(view.queryByText(/尚缺.*學分|已通過畢業/)).toBeNull();
});

test('keeps a clearly dated previous result after a transient error but clears it after session rejection', async () => {
  const onReconnect = jest.fn();
  const view = render(<SchoolCreditOverviewCard user={accountA} schoolId="tw-pu" onReconnect={onReconnect} />);
  await view.findByText('71.5 學分');
  mockRead.mockRejectedValueOnce(new SchoolCreditOverviewError('unavailable'));
  fireEvent.press(view.getByLabelText('更新校方學分累計'));
  await view.findByText(/本次更新未完成，目前顯示/);
  expect(view.getByText('71.5 學分')).toBeTruthy();
  mockRead.mockRejectedValueOnce(new SchoolCreditOverviewError('reconnect'));
  fireEvent.press(view.getByLabelText('更新校方學分累計'));
  await view.findByText('請重新連線學校帳號。');
  expect(view.queryByText('71.5 學分')).toBeNull();
  fireEvent.press(view.getByLabelText('重新連線學校帳號'));
  expect(onReconnect).toHaveBeenCalledTimes(1);
});

test('does not expose late old-account totals or school data in another school', async () => {
  let finish!: (value: PuCreditOverviewSnapshot) => void;
  mockRead.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
  const view = render(<SchoolCreditOverviewCard user={accountA} schoolId="tw-pu" />);
  mockRead.mockResolvedValueOnce(sample('b', 92));
  view.rerender(<SchoolCreditOverviewCard user={accountB} schoolId="tw-pu" />);
  await view.findByText('92 學分');
  await act(async () => finish(sample()));
  expect(view.queryByText('71.5 學分')).toBeNull();
  view.rerender(<SchoolCreditOverviewCard user={accountB} schoolId="tw-nthu" />);
  expect(view.queryByText('92 學分')).toBeNull();
  expect(mockRead).toHaveBeenCalledTimes(2);
});

test('a same-UID new login cannot retain a previous snapshot after failure or accept its pending update', async () => {
  const view = render(<SchoolCreditOverviewCard user={accountA} schoolId="pu" />);
  await view.findByText('71.5 學分');
  let finishOld!: (value: PuCreditOverviewSnapshot) => void;
  mockRead.mockImplementationOnce(() => new Promise((resolve) => { finishOld = resolve; }));
  fireEvent.press(view.getByLabelText('更新校方學分累計'));
  expect(view.getByText('71.5 學分')).toBeTruthy();

  let failNew!: (error: unknown) => void;
  mockRead.mockImplementationOnce(() => new Promise((_, reject) => { failNew = reject; }));
  view.rerender(<SchoolCreditOverviewCard user={{ uid: 'a' }} schoolId="pu" />);
  expect(view.queryByText('71.5 學分')).toBeNull();
  expect(view.getByText('正在讀取校方學分試算表…')).toBeTruthy();
  await act(async () => { failNew(new SchoolCreditOverviewError('unavailable')); });
  expect(view.getByText('暫時無法讀取校方學分累計。')).toBeTruthy();
  expect(view.queryByText(/本次更新未完成，目前顯示/)).toBeNull();
  expect(view.queryByText('71.5 學分')).toBeNull();

  await act(async () => { finishOld(sample('a', 74.5)); });
  expect(view.queryByText('74.5 學分')).toBeNull();
  expect(view.queryByText('0 學分')).toBeNull();
  expect(view.getByText('暫時無法讀取校方學分累計。')).toBeTruthy();
  expect(mockRead).toHaveBeenCalledTimes(3);
});

test('does not duplicate a pending request or report a failed first read as zero credits', async () => {
  let fail!: (error: unknown) => void;
  mockRead.mockImplementationOnce(() => new Promise((_, reject) => { fail = reject; }));
  const view = render(<SchoolCreditOverviewCard user={accountA} schoolId="tw-pu" />);
  fireEvent.press(view.getByLabelText('更新校方學分累計'));
  expect(mockRead).toHaveBeenCalledTimes(1);
  await act(async () => fail(new SchoolCreditOverviewError('unavailable')));
  expect(view.queryByText('0 學分')).toBeNull();
  expect(view.getByText('暫時無法讀取校方學分累計。')).toBeTruthy();
});
