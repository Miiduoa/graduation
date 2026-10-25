import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { AdminMerchants } from './AdminMerchants';
import { AdminPeople } from './AdminPeople';

const context = 'a'.repeat(43);
const schoolOne = {
  kind: 'tenant',
  applicationId: null,
  tenantId: 'school-one',
  displayName: '第一學校',
  emailDomain: 'one.edu.tw',
  lifecycle: 'open',
  description: '',
  modules: { leave: true, identity: true, food: true },
  peopleCount: 1,
  merchantCount: 0,
};
const schoolTwo = {
  ...schoolOne,
  tenantId: 'school-two',
  displayName: '第二學校',
  emailDomain: 'two.edu.tw',
};

function peoplePayload(tenantId: string, displayName: string) {
  return {
    tenantId,
    displayName,
    tenantState: 'open',
    hasRoleAdmin: true,
    roleAdmins: [{ personId: `${tenantId}-admin`, displayName: `${displayName}管理員` }],
    people: [
      {
        personId: `${tenantId}-admin`,
        displayName: `${displayName}管理員`,
        email: `admin@${tenantId}.test`,
        role: 'school_admin',
        roleLabel: '學校管理員',
        state: 'active',
        stateLabel: '使用中',
      },
    ],
    honesty: '可以隨時再加一位老師或職員。',
  };
}

function merchantsPayload() {
  return {
    interest: [
      {
        id: 'interest-1',
        brandName: '意向咖啡',
        schoolName: '第一學校',
        contactName: '意向聯絡人',
        contactEmail: 'interest-secret@example.test',
        note: null,
        state: 'submitted',
        createdAt: '2026-01-02T03:04:05.000Z',
        decidedAt: null,
      },
    ],
    applications: [
      {
        tenantId: 'school-one',
        tenantName: '第一學校',
        applicationId: 'app-1',
        brandName: '進件食堂',
        locationName: '一樓窗口',
        contactName: '進件聯絡人',
        contactEmail: 'app-secret@example.test',
        state: 'submitted',
        version: 1,
        submittedAt: '2026-01-03T03:04:05.000Z',
      },
    ],
    catalog: [
      {
        tenantId: 'school-one',
        tenantName: '第一學校',
        locationId: 'loc-1',
        locationName: '資訊展示店',
        merchantMode: 'info_only',
        merchantModeLabel: '僅資訊',
        sourceLabel: '平台建檔',
        sourceUpdatedAt: null,
        published: true,
        locationStatus: 'open',
        publicAccess: true,
      },
    ],
    honesty: '意向與進件都要先審過才能往下。',
  };
}

function ok(value: unknown) {
  return new Response(JSON.stringify(value), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function PeopleHarness({ initial = null as string | null }) {
  const [selected, setSelected] = useState(initial);
  return (
    <AdminPeople
      context={context}
      suspended={false}
      selectedSchool={selected}
      onSchool={setSelected}
    />
  );
}

const fetcher = vi.fn();

beforeEach(() => {
  fetcher.mockReset().mockImplementation(async (url: string) => {
    if (url.includes('/people?')) {
      const tenantId = new URL(url, 'https://example.test').searchParams.get('tenantId');
      return ok(
        peoplePayload(
          tenantId || 'school-one',
          tenantId === 'school-two' ? '第二學校' : '第一學校',
        ),
      );
    }
    if (url.endsWith('/merchants')) return ok(merchantsPayload());
    return ok({ schools: [schoolOne, schoolTwo] });
  });
  vi.stubGlobal('fetch', fetcher);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

it('filters merchants using the Chinese status labels shown to the operator', async () => {
  render(<AdminMerchants context={context} suspended={false} />);
  await screen.findByText(/資訊展示店/);
  const input = screen.getByLabelText('在已載入結果中篩選');
  fireEvent.change(input, { target: { value: '待審核' } });
  fireEvent.submit(input.closest('form')!);
  expect(screen.getByText(/意向咖啡/)).toBeTruthy();
  expect(screen.getByText(/進件食堂/)).toBeTruthy();
  expect(screen.queryByText(/資訊展示店/)).toBeNull();
  fireEvent.change(input, { target: { value: '營業中' } });
  fireEvent.submit(input.closest('form')!);
  expect(screen.getByText(/資訊展示店/)).toBeTruthy();
  expect(screen.queryByText(/意向咖啡/)).toBeNull();
  expect(screen.queryByText(/進件食堂/)).toBeNull();
});

it('does not fetch school people until an eligible school is explicitly selected', async () => {
  render(<PeopleHarness />);
  await screen.findByLabelText('選擇學校');
  expect(fetcher.mock.calls.some(([url]) => String(url).includes('/people?'))).toBe(false);
  expect(screen.queryByText('第一學校管理員')).toBeNull();
  fireEvent.change(screen.getByLabelText('選擇學校'), { target: { value: 'school-one' } });
  await screen.findByText('第一學校管理員');
  expect(
    fetcher.mock.calls.some(([url]) => String(url).includes('/people?tenantId=school-one')),
  ).toBe(true);
  expect(screen.getByText(/查看各校管理員、職員與已核發授權/)).toBeTruthy();
  expect(screen.getByRole('link', { name: '調整校方授權' })).toHaveProperty(
    'href',
    expect.stringContaining('/auth/platform/ops'),
  );
});

it('rejects a cross-school people response and does not keep showing foreign rows', async () => {
  fetcher.mockImplementation(async (url: string) => {
    if (url.includes('/people?')) return ok(peoplePayload('school-two', '第二學校'));
    return ok({ schools: [schoolOne, schoolTwo] });
  });
  render(<PeopleHarness />);
  await screen.findByLabelText('選擇學校');
  fireEvent.change(screen.getByLabelText('選擇學校'), { target: { value: 'school-one' } });
  await screen.findByRole('alert');
  expect(screen.queryByText('第二學校管理員')).toBeNull();
  expect(screen.queryByText(/0 位學校管理/)).toBeNull();
});

it('masks previous school rows immediately when the selected school changes', async () => {
  const second = deferred<Response>();
  fetcher.mockImplementation(async (url: string) => {
    if (String(url).includes('tenantId=school-two')) return second.promise;
    if (String(url).includes('/people?')) return ok(peoplePayload('school-one', '第一學校'));
    return ok({ schools: [schoolOne, schoolTwo] });
  });
  render(<PeopleHarness />);
  await screen.findByLabelText('選擇學校');
  fireEvent.change(screen.getByLabelText('選擇學校'), { target: { value: 'school-one' } });
  await screen.findByText('第一學校管理員');
  fireEvent.change(screen.getByLabelText('選擇學校'), { target: { value: 'school-two' } });
  expect(screen.queryByText('第一學校管理員')).toBeNull();
  await act(async () => {
    second.resolve(ok(peoplePayload('school-two', '第二學校')));
  });
  await screen.findByText('第二學校管理員');
});

it('shows a missing-admin attention state without inventing personnel counts on failure', async () => {
  fetcher.mockImplementation(async (url: string) => {
    if (url.includes('/people?')) {
      return ok({
        ...peoplePayload('school-one', '第一學校'),
        hasRoleAdmin: false,
        roleAdmins: [],
        people: [],
      });
    }
    return ok({ schools: [schoolOne] });
  });
  render(<PeopleHarness />);
  await screen.findByLabelText('選擇學校');
  fireEvent.change(screen.getByLabelText('選擇學校'), { target: { value: 'school-one' } });
  await screen.findByText(/目前沒有作用中的學校管理員/);
  expect(screen.getByText(/尚未登錄任何管理員或職員授權/)).toBeTruthy();
});

it('loads merchant oversight read-only, keeps contacts collapsed, and avoids fake approve actions', async () => {
  render(<AdminMerchants context={context} suspended={false} />);
  await screen.findByText(/資訊展示店/);
  expect(screen.getByText(/不可點餐/)).toBeTruthy();
  expect(screen.getByText(/最多顯示 400 筆/)).toBeTruthy();
  expect(screen.queryByText('interest-secret@example.test')).toBeNull();
  expect(screen.queryByText('app-secret@example.test')).toBeNull();
  fireEvent.click(screen.getAllByRole('button', { name: '查看聯絡' })[0]);
  expect(screen.getByText(/進件聯絡人/)).toBeTruthy();
  expect(screen.queryByRole('button', { name: /核准|通過|approve/i })).toBeNull();
  expect(screen.getByRole('link', { name: '前往完整管理台審核' })).toBeTruthy();
});

it('does not turn a merchant load failure into empty zero totals', async () => {
  fetcher.mockImplementation(async (url: string) =>
    url.endsWith('/merchants') ? new Response('{}', { status: 503 }) : ok({ schools: [schoolOne] }),
  );
  render(<AdminMerchants context={context} suspended={false} />);
  await screen.findByRole('alert');
  expect(screen.queryByText(/最多顯示 400 筆/)).toBeNull();
  expect(screen.queryByText(/意向 0 筆/)).toBeNull();
  fetcher.mockImplementation(async () => ok(merchantsPayload()));
  fireEvent.click(screen.getByRole('button', { name: '重新讀取店家' }));
  await screen.findByText(/最多顯示 400 筆/);
  expect(screen.getByText(/資訊展示店/)).toBeTruthy();
});

it('ignores a late people response after the operator leaves the school selection', async () => {
  const pending = deferred<Response>();
  fetcher.mockImplementation(async (url: string) => {
    if (String(url).includes('/people?')) return pending.promise;
    return ok({ schools: [schoolOne, schoolTwo] });
  });
  render(<PeopleHarness />);
  await screen.findByLabelText('選擇學校');
  fireEvent.change(screen.getByLabelText('選擇學校'), { target: { value: 'school-one' } });
  await waitFor(() =>
    expect(fetcher.mock.calls.some(([url]) => String(url).includes('/people?'))).toBe(true),
  );
  fireEvent.change(screen.getByLabelText('選擇學校'), { target: { value: '' } });
  await act(async () => {
    pending.resolve(ok(peoplePayload('school-one', '第一學校')));
  });
  expect(screen.queryByText('第一學校管理員')).toBeNull();
});
