import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { AcademicConnectionError } from '@/lib/academicClient';
import type { PuCreditOverviewSnapshot } from '@campus/shared/src/puCreditOverview';
import { SchoolCreditOverview } from './SchoolCreditOverview';

const { load } = vi.hoisted(() => ({ load: vi.fn() }));
vi.mock('@/lib/schoolCreditOverview', () => ({ loadSchoolCreditOverview: load }));
vi.mock('@/lib/signInOptions', () => ({ useSignInOptions: () => ({ studentId: true, loading: false }) }));
function sample(uid = 'a', subtotal = 71.5): PuCreditOverviewSnapshot {
  return { ownerUid: uid, schoolId: 'pu', fetchedAt: '2026-10-28T00:00:00Z', overview: {
    version: 1, source: 'pu-credit-review',
    totals: { required: 40.5, elective: 20, externalElective: 3, generalOld: 0, generalNew: 8, subtotal, totalRequired: 128, minorDouble: null },
    coverage: { status: 'partial', missingFields: ['minorDouble'] },
  } };
}
const accountA = { uid: 'a' };
const accountB = { uid: 'b' };
beforeEach(() => { load.mockReset().mockResolvedValue(sample()); });
afterEach(cleanup);

it('shows reported totals, explicit zero and unknown fields without a graduation completion claim', async () => {
  render(<SchoolCreditOverview user={accountA} schoolId="pu" />);
  expect(await screen.findByText('71.5 學分')).toBeTruthy();
  expect(screen.getByText('0 學分')).toBeTruthy();
  expect(screen.getByText('未提供')).toBeTruthy();
  expect(screen.getByText(/不等於畢業採計/)).toBeTruthy();
  expect(screen.getByText(/7／8 個累計欄位/)).toBeTruthy();
  expect(screen.queryByText(/尚缺.*學分|可以畢業|已通過畢業/)).toBeNull();
  expect(screen.getByRole('link', { name: /前往校方學分試算表/ }).getAttribute('href'))
    .toBe('https://alcat.pu.edu.tw/grade_review/main.php');
});

it('retains a labelled previous snapshot on transient failure and updates only after a successful retry', async () => {
  render(<SchoolCreditOverview user={accountA} schoolId="pu" />);
  await screen.findByText('71.5 學分');
  load.mockRejectedValueOnce(new AcademicConnectionError('unavailable'));
  fireEvent.click(screen.getByRole('button', { name: '更新學分累計' }));
  await screen.findByText(/本次更新未完成，目前顯示/);
  expect(screen.getByText('71.5 學分')).toBeTruthy();
  load.mockResolvedValueOnce(sample('a', 74.5));
  fireEvent.click(screen.getByRole('button', { name: '更新學分累計' }));
  await screen.findByText('74.5 學分');
  expect(screen.queryByText('71.5 學分')).toBeNull();
  expect(screen.queryByText(/本次更新未完成/)).toBeNull();
});

it('clears previous private totals on an expired connection and presents the reconnect route', async () => {
  render(<SchoolCreditOverview user={accountA} schoolId="pu" />);
  await screen.findByText('71.5 學分');
  load.mockRejectedValueOnce(new AcademicConnectionError('reconnect'));
  fireEvent.click(screen.getByRole('button', { name: '更新學分累計' }));
  expect(await screen.findByRole('link', { name: '重新連線學校帳號' })).toBeTruthy();
  expect(screen.queryByText('71.5 學分')).toBeNull();
});

it('drops late results after an account or school switch', async () => {
  let resolveOld!: (value: PuCreditOverviewSnapshot) => void;
  load.mockImplementationOnce(() => new Promise((resolve) => { resolveOld = resolve; }));
  const view = render(<SchoolCreditOverview user={accountA} schoolId="pu" />);
  load.mockResolvedValueOnce(sample('b', 92));
  view.rerender(<SchoolCreditOverview user={accountB} schoolId="pu" />);
  await screen.findByText('92 學分');
  await act(async () => resolveOld(sample()));
  expect(screen.queryByText('71.5 學分')).toBeNull();
  view.rerender(<SchoolCreditOverview user={accountB} schoolId="nthu" />);
  expect(screen.queryByText('92 學分')).toBeNull();
  expect(load).toHaveBeenCalledTimes(2);
});

it('a same-UID new login cannot retain a previous snapshot after failure or accept its pending update', async () => {
  const view = render(<SchoolCreditOverview user={accountA} schoolId="pu" />);
  await screen.findByText('71.5 學分');
  let finishOld!: (value: PuCreditOverviewSnapshot) => void;
  load.mockImplementationOnce(() => new Promise((resolve) => { finishOld = resolve; }));
  fireEvent.click(screen.getByRole('button', { name: '更新學分累計' }));
  expect(screen.getByText('71.5 學分')).toBeTruthy();

  let failNew!: (error: unknown) => void;
  load.mockImplementationOnce(() => new Promise((_, reject) => { failNew = reject; }));
  view.rerender(<SchoolCreditOverview user={{ uid: 'a' }} schoolId="pu" />);
  expect(screen.queryByText('71.5 學分')).toBeNull();
  expect(screen.getByText('正在讀取校方學分試算表…')).toBeTruthy();
  await act(async () => { failNew(new AcademicConnectionError('unavailable')); });
  expect(screen.getByText(/這次未能取得可確認的學分累計/)).toBeTruthy();
  expect(screen.queryByText(/本次更新未完成，目前顯示/)).toBeNull();
  expect(screen.queryByText('71.5 學分')).toBeNull();

  await act(async () => { finishOld(sample('a', 74.5)); });
  expect(screen.queryByText('74.5 學分')).toBeNull();
  expect(screen.queryByText('0 學分')).toBeNull();
  expect(screen.getByText(/這次未能取得可確認的學分累計/)).toBeTruthy();
  expect(load).toHaveBeenCalledTimes(3);
});

it('does not duplicate a pending request or replace a first failure with zero totals', async () => {
  let reject!: (error: unknown) => void;
  load.mockImplementationOnce(() => new Promise((_, fail) => { reject = fail; }));
  render(<SchoolCreditOverview user={accountA} schoolId="pu" />);
  fireEvent.click(screen.getByRole('button', { name: '讀取中…' }));
  expect(load).toHaveBeenCalledTimes(1);
  await act(async () => reject(new AcademicConnectionError('unavailable')));
  await waitFor(() => expect(screen.getByText(/這次未能取得可確認的學分累計/)).toBeTruthy());
  expect(screen.queryByText('0 學分')).toBeNull();
});
