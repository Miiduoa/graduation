import React from 'react';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import { NuniMerchant } from '../screens/nuni/NuniMerchant';
import { NuniError } from '@campus/shared/src/nuni';

const mockRequest = jest.fn();
const mockRefresh = jest.fn();
const initialSession = () => ({ platformAccountId: 'pa-a', context: 'context-a' });
let mockAuth = {
  session: initialSession() as ReturnType<typeof initialSession> | null,
  loading: false,
  error: '',
  pendingLogout: false,
  request: mockRequest,
  refresh: mockRefresh,
};
jest.mock('../state/nuniSession', () => ({ useNuniSession: () => mockAuth }));
jest.mock('expo-crypto', () => ({ randomUUID: () => '11111111-1111-4111-8111-111111111111' }));
const programs = [
  {
    tenantId: 'school-one',
    name: '第一學校',
    note: '',
    campuses: [{ id: 'main', name: '主校區' }],
  },
  {
    tenantId: 'school-two',
    name: '第二學校',
    note: '',
    campuses: [{ id: 'town', name: '市區校區' }],
  },
];
const receipt = {
  tenantId: 'school-one',
  applicationId: 'fma-one',
  brandName: '餐坊',
  locationName: '第一門市',
  state: 'submitted',
  reviewerNote: '',
  submittedAt: '2026-10-09T00:00:00Z',
};
const values: Record<string, string> = {
  公司或商業名稱: '餐坊公司',
  品牌名稱: '餐坊',
  聯絡人姓名: '申請人',
  聯絡信箱: 'owner@example.test',
  聯絡電話: '0912345678',
  門市名稱: '第一門市',
  營業地址: '學校餐廳一樓',
};
function data(path: string) {
  return path === 'merchant-onboarding-programs'
    ? { programs }
    : path === 'merchant-applications'
      ? { applications: [] }
      : { workspaces: [] };
}
async function fill(view: ReturnType<typeof render>) {
  await view.findByText('這個帳號尚未送出進駐申請。');
  fireEvent.press(view.getByRole('button', { name: '第一學校' }));
  fireEvent.press(view.getByRole('button', { name: '主校區' }));
  for (const [label, value] of Object.entries(values))
    fireEvent.changeText(view.getByLabelText(label), value);
}
beforeEach(() => {
  mockAuth = {
    session: initialSession(),
    loading: false,
    error: '',
    pendingLogout: false,
    request: mockRequest,
    refresh: mockRefresh,
  };
  mockRequest.mockReset().mockImplementation(async (path: string) => data(path));
  mockRefresh.mockReset().mockResolvedValue(undefined);
});

test('sends the selected school and server campus under the captured account and waits for a matching receipt', async () => {
  let accept: (value: unknown) => void = () => undefined;
  mockRequest.mockImplementation((path: string, _context: string, input?: object) =>
    input
      ? new Promise((resolve) => {
          accept = resolve;
        })
      : Promise.resolve(data(path)),
  );
  const view = render(<NuniMerchant />);
  await fill(view);
  fireEvent.press(view.getByRole('button', { name: '送出進駐申請' }));
  fireEvent.press(view.getByRole('button', { name: '確認收件中…' }));
  expect(mockRequest.mock.calls.filter((call) => call[2])).toHaveLength(1);
  expect(mockRequest).toHaveBeenLastCalledWith(
    'merchant-applications',
    'context-a',
    expect.objectContaining({ tenantId: 'school-one', campusId: 'main', brandName: '餐坊' }),
  );
  expect(view.queryByText(/申請已收件/)).toBeNull();
  await act(async () => accept(receipt));
  expect(view.getByText(/申請已收件/)).toBeTruthy();
  expect(view.getByText('已送出')).toBeTruthy();
  expect(view.getByLabelText('品牌名稱').props.value).toBe('');
});

test('an uncertain response freezes input and retries the identical idempotency key', async () => {
  mockRequest.mockImplementation(async (path: string, _context: string, input?: object) => {
    if (input) throw new NuniError(502, 'UPSTREAM_ERROR');
    return data(path);
  });
  const view = render(<NuniMerchant />);
  await fill(view);
  fireEvent.press(view.getByRole('button', { name: '送出進駐申請' }));
  await view.findByText(/尚未確認是否收件/);
  expect(view.getByLabelText('品牌名稱').props.editable).toBe(false);
  fireEvent.press(view.getByRole('button', { name: '重試同一份申請' }));
  await waitFor(() => expect(mockRequest.mock.calls.filter((call) => call[2])).toHaveLength(2));
  const writes = mockRequest.mock.calls.filter((call) => call[2]);
  expect(writes[1][2]).toEqual(writes[0][2]);
});

test('rejects a receipt from a different school instead of announcing success', async () => {
  mockRequest.mockImplementation(async (path: string, _context: string, input?: object) =>
    input ? { ...receipt, tenantId: 'school-two' } : data(path),
  );
  const view = render(<NuniMerchant />);
  await fill(view);
  fireEvent.press(view.getByRole('button', { name: '送出進駐申請' }));
  await view.findByText(/尚未確認是否收件/);
  expect(view.queryByText(/申請已收件/)).toBeNull();
});

test('clears the campus choice when changing schools and prevents an invalid submission', async () => {
  const view = render(<NuniMerchant />);
  await fill(view);
  fireEvent.press(view.getByRole('button', { name: '第二學校' }));
  expect(view.queryByRole('button', { name: '主校區' })).toBeNull();
  fireEvent.press(view.getByRole('button', { name: '送出進駐申請' }));
  expect(view.getByText(/請確認必填資料/)).toBeTruthy();
  expect(mockRequest.mock.calls.filter((call) => call[2])).toHaveLength(0);
});

test('failed lists are an error, never an empty application history', async () => {
  mockRequest.mockImplementation(async (path: string) => {
    if (path === 'merchant-workspaces') throw new Error('offline');
    return data(path);
  });
  const view = render(<NuniMerchant />);
  await view.findByText('目前無法確認店家資料，請重新載入。');
  expect(view.queryByText('這個帳號尚未送出進駐申請。')).toBeNull();
  expect(view.queryByRole('button', { name: '送出進駐申請' })).toBeNull();
});

test('account switching drops old drafts and ignores a delayed write receipt', async () => {
  let accept: (value: unknown) => void = () => undefined;
  mockRequest.mockImplementation((path: string, _context: string, input?: object) =>
    input
      ? new Promise((resolve) => {
          accept = resolve;
        })
      : Promise.resolve(data(path)),
  );
  const view = render(<NuniMerchant />);
  await fill(view);
  fireEvent.press(view.getByRole('button', { name: '送出進駐申請' }));
  mockAuth = { ...mockAuth, session: { platformAccountId: 'pa-b', context: 'context-b' } };
  view.rerender(<NuniMerchant />);
  await view.findByText('這個帳號尚未送出進駐申請。');
  expect(view.getByLabelText('品牌名稱').props.value).toBe('');
  await act(async () => accept(receipt));
  expect(view.queryByText(/申請已收件/)).toBeNull();
  expect(view.queryByText('已送出')).toBeNull();
});

test.each([{ loading: true }, { pendingLogout: true }, { error: '無法確認帳號' }])(
  'hides merchant records when account access is uncertain: %j',
  async (change) => {
    const view = render(<NuniMerchant />);
    await fill(view);
    mockAuth = { ...mockAuth, ...change };
    view.rerender(<NuniMerchant />);
    expect(view.queryByText('我的申請')).toBeNull();
    expect(view.getByText('請先確認 Campus One 帳號狀態。')).toBeTruthy();
  },
);

test('a later 404 cannot prove that an earlier uncertain application was never received', async () => {
  let writes = 0;
  mockRequest.mockImplementation(async (path: string, _context: string, input?: object) => {
    if (input) throw new NuniError(++writes === 1 ? 502 : 404, 'UPSTREAM_ERROR');
    return data(path);
  });
  const view = render(<NuniMerchant />);
  await fill(view);
  fireEvent.press(view.getByRole('button', { name: '送出進駐申請' }));
  await view.findByText(/尚未確認是否收件/);
  fireEvent.press(view.getByRole('button', { name: '重試同一份申請' }));
  await waitFor(() => expect(writes).toBe(2));
  await view.findByText(/尚未確認是否收件/);
  expect(view.getByLabelText('品牌名稱').props.editable).toBe(false);
  expect(view.queryByText(/申請未被接受/)).toBeNull();
  expect(mockRequest.mock.calls.filter((call) => call[2])[1][2]).toEqual(
    mockRequest.mock.calls.filter((call) => call[2])[0][2],
  );
});
