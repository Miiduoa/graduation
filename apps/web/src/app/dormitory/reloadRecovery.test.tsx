import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import DormitoryPage from './page';
import { dormStorageKey, type DormWorkspace } from '@campus/shared/src/dormitory';

vi.mock('@/components/SiteShell', () => ({
  SiteShell: ({ children }: { children: ReactNode }) => <main>{children}</main>,
}));
vi.mock('@/components/AuthGuard', () => ({
  useAuth: () => ({ user: null, loading: false }),
}));
vi.mock('@/features/nuni/Session', () => ({
  useOptionalNuniSession: () => null,
}));
vi.mock('@/lib/useCampusBrowseContext', () => ({
  useCampusBrowseContext: () => ({
    status: 'ready',
    schoolId: 'pu',
    schoolName: '靜宜大學',
  }),
}));

const scope = dormStorageKey('guest', 'pu');
const records = [
  {
    collection: 'repairs',
    tab: '設備問題',
    start: '＋ 記錄問題',
    field: '問題名稱 *',
    save: '儲存紀錄',
    form: '設備問題表單',
    title: '冷氣異音',
  },
  {
    collection: 'milestones',
    tab: '重要日期',
    start: '＋ 新增日期',
    field: '事項名稱 *',
    save: '儲存日期',
    form: '重要日期表單',
    title: '住宿繳費截止',
  },
  {
    collection: 'parcels',
    tab: '包裹領取',
    start: '＋ 記錄包裹',
    field: '包裹名稱 *',
    save: '儲存包裹',
    form: '包裹紀錄表單',
    title: '網購包裹',
  },
] as const;

function readWorkspace(): DormWorkspace {
  return JSON.parse(localStorage.getItem(scope) ?? 'null') as DormWorkspace;
}

function beginRecord(record: (typeof records)[number]) {
  fireEvent.click(screen.getByRole('button', { name: record.tab }));
  fireEvent.click(screen.getByRole('button', { name: record.start }));
  fireEvent.change(screen.getByRole('textbox', { name: record.field }), {
    target: { value: record.title },
  });
  if (record.collection === 'milestones') {
    fireEvent.change(screen.getByLabelText('日期 *'), { target: { value: '2026-11-15' } });
  }
  if (record.collection === 'parcels') {
    fireEvent.change(screen.getByRole('textbox', { name: '領取地點' }), {
      target: { value: '宿舍服務台' },
    });
  }
}

function expectConflictWithoutWrite(expectedRaw: string) {
  expect(screen.getByRole('alert').textContent).toContain('有另一處修改了這份紀錄');
  expect(localStorage.getItem(scope)).toBe(expectedRaw);
}

beforeEach(() => localStorage.clear());
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  localStorage.clear();
});

it('discards the old parcel editor after reloading another tab deletion, so the parcel cannot be restored', () => {
  render(<DormitoryPage />);
  beginRecord(records[2]);
  fireEvent.click(screen.getByRole('button', { name: '儲存包裹' }));
  fireEvent.click(screen.getByRole('button', { name: '編輯' }));
  fireEvent.change(screen.getByRole('textbox', { name: '包裹名稱 *' }), {
    target: { value: '本頁尚未儲存的舊包裹' },
  });

  const latest = { ...readWorkspace(), room: '另一分頁的新寢室', parcels: [] };
  const latestRaw = JSON.stringify(latest);
  localStorage.setItem(scope, latestRaw);
  fireEvent.click(screen.getByRole('button', { name: '儲存包裹' }));
  expectConflictWithoutWrite(latestRaw);

  fireEvent.click(screen.getByRole('button', { name: '重新讀取最新紀錄' }));
  expect.soft(screen.queryByRole('form', { name: '包裹紀錄表單' })).toBeNull();
  // If an obsolete save button remains visible, a user can still submit it.
  const obsoleteSave = screen.queryByRole('button', { name: '儲存包裹' });
  if (obsoleteSave) fireEvent.click(obsoleteSave);
  expect(readWorkspace()).toEqual(latest);
  expect(screen.queryByRole('heading', { name: '本頁尚未儲存的舊包裹' })).toBeNull();

  fireEvent.click(screen.getByRole('button', { name: '＋ 記錄包裹' }));
  expect((screen.getByRole('textbox', { name: '包裹名稱 *' }) as HTMLInputElement).value).toBe('');
  expect((screen.getByRole('textbox', { name: '領取地點' }) as HTMLInputElement).value).toBe('');
});

it('discards the old parcel editor after reloading another tab edit and opens the latest values when editing again', () => {
  render(<DormitoryPage />);
  beginRecord(records[2]);
  fireEvent.click(screen.getByRole('button', { name: '儲存包裹' }));
  fireEvent.click(screen.getByRole('button', { name: '編輯' }));
  fireEvent.change(screen.getByRole('textbox', { name: '包裹名稱 *' }), {
    target: { value: '本頁尚未儲存的名稱' },
  });

  const latest = readWorkspace();
  latest.parcels[0] = {
    ...latest.parcels[0],
    title: '另一分頁已確認的包裹',
    pickupPoint: '新的領取櫃台',
    dueDate: '2026-12-02',
  };
  const latestRaw = JSON.stringify(latest);
  localStorage.setItem(scope, latestRaw);
  fireEvent.click(screen.getByRole('button', { name: '儲存包裹' }));
  expectConflictWithoutWrite(latestRaw);

  fireEvent.click(screen.getByRole('button', { name: '重新讀取最新紀錄' }));
  expect.soft(screen.queryByRole('form', { name: '包裹紀錄表單' })).toBeNull();
  const obsoleteSave = screen.queryByRole('button', { name: '儲存包裹' });
  if (obsoleteSave) fireEvent.click(obsoleteSave);
  expect(readWorkspace()).toEqual(latest);

  fireEvent.click(screen.getByRole('button', { name: '編輯' }));
  expect((screen.getByRole('textbox', { name: '包裹名稱 *' }) as HTMLInputElement).value).toBe(
    latest.parcels[0].title,
  );
  expect((screen.getByRole('textbox', { name: '領取地點' }) as HTMLInputElement).value).toBe(
    latest.parcels[0].pickupPoint,
  );
  expect((screen.getByLabelText('預計取件日期（選填）') as HTMLInputElement).value).toBe(
    latest.parcels[0].dueDate,
  );
});

it.each(records)(
  'requires a new delete confirmation for $collection after reloading another tab edit',
  (record) => {
    render(<DormitoryPage />);
    beginRecord(record);
    fireEvent.click(screen.getByRole('button', { name: record.save }));
    fireEvent.click(screen.getByRole('button', { name: '刪除' }));
    expect(screen.getByRole('button', { name: '確認刪除' })).toBeTruthy();

    const latest = readWorkspace();
    latest[record.collection][0].title = '另一分頁更新後的紀錄';
    const latestRaw = JSON.stringify(latest);
    localStorage.setItem(scope, latestRaw);
    fireEvent.click(screen.getByRole('button', { name: '確認刪除' }));
    expectConflictWithoutWrite(latestRaw);

    fireEvent.click(screen.getByRole('button', { name: '重新讀取最新紀錄' }));
    expect(screen.getByRole('heading', { name: '另一分頁更新後的紀錄' })).toBeTruthy();
    expect.soft(screen.queryByRole('button', { name: '確認刪除' })).toBeNull();
    const obsoleteConfirmation = screen.queryByRole('button', { name: '確認刪除' });
    if (obsoleteConfirmation) fireEvent.click(obsoleteConfirmation);
    expect(localStorage.getItem(scope)).toBe(latestRaw);

    fireEvent.click(screen.getByRole('button', { name: '刪除' }));
    fireEvent.click(screen.getByRole('button', { name: '確認刪除' }));
    expect(readWorkspace()[record.collection]).toEqual([]);
  },
);

it.each(records)(
  'retains the $collection draft after a storage write failure and saves it once on retry',
  (record) => {
    render(<DormitoryPage />);
    beginRecord(record);
    vi.spyOn(Storage.prototype, 'setItem').mockImplementationOnce(() => {
      throw new DOMException('Storage full', 'QuotaExceededError');
    });

    fireEvent.click(screen.getByRole('button', { name: record.save }));
    expect(localStorage.getItem(scope)).toBeNull();
    expect(screen.getByRole('alert').textContent).toContain('儲存失敗');
    expect(screen.getByRole('form', { name: record.form })).toBeTruthy();
    expect((screen.getByRole('textbox', { name: record.field }) as HTMLInputElement).value).toBe(
      record.title,
    );
    expect(screen.queryByRole('button', { name: '重新讀取最新紀錄' })).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: record.save }));
    expect(readWorkspace()[record.collection]).toHaveLength(1);
    expect(readWorkspace()[record.collection][0].title).toBe(record.title);
    expect(screen.queryByRole('form', { name: record.form })).toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
  },
);
