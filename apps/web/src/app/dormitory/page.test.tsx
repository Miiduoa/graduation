import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import DormitoryPage from './page';
import { DORM_REPAIR_COPY, DORM_REPAIR_DISALLOWED_COPY, dormStorageKey } from '@campus/shared/src/dormitory';

const selectedCampus = vi.hoisted(() => ({
  status: 'ready' as 'ready' | 'unselected',
  schoolId: 'pu',
  schoolName: '靜宜大學',
}));

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
  useCampusBrowseContext: () => selectedCampus,
}));

beforeEach(() => {
  localStorage.clear();
  selectedCampus.status = 'ready';
  selectedCampus.schoolId = 'pu';
  selectedCampus.schoolName = '靜宜大學';
});
afterEach(() => {
  cleanup();
  localStorage.clear();
});

it('lets a guest save room notes without inventing a school allocation', () => {
  render(<DormitoryPage />);
  expect(screen.getByText(/訪客模式/)).toBeTruthy();
  fireEvent.change(screen.getByRole('textbox', { name: '宿舍或學苑名稱' }), { target: { value: '希嘉學苑' } });
  fireEvent.change(screen.getByRole('textbox', { name: '寢室' }), { target: { value: '203' } });
  fireEvent.click(screen.getByRole('button', { name: '儲存住宿備忘' }));
  const stored = JSON.parse(localStorage.getItem(dormStorageKey('guest', 'pu')) ?? 'null');
  expect(stored).toMatchObject({ building: '希嘉學苑', room: '203' });
  expect(screen.getByText('已儲存在這台裝置')).toBeTruthy();
});

it('offers a working repair editor and records self-reported status only', () => {
  render(<DormitoryPage />);
  fireEvent.click(screen.getByRole('button', { name: '設備問題' }));
  expect(screen.queryByText(DORM_REPAIR_DISALLOWED_COPY)).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: '＋ 記錄問題' }));
  fireEvent.change(screen.getByRole('textbox', { name: '問題名稱 *' }), { target: { value: '冷氣異音' } });
  fireEvent.change(screen.getByRole('textbox', { name: '位置' }), { target: { value: '寢室窗邊' } });
  expect(screen.getByRole('button', { name: DORM_REPAIR_COPY.saveMemo })).toBeTruthy();
  expect(screen.queryByText(DORM_REPAIR_DISALLOWED_COPY)).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: DORM_REPAIR_COPY.saveMemo }));
  expect(screen.getByRole('heading', { name: '冷氣異音' })).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: '我已自行通報' }));
  const stored = JSON.parse(localStorage.getItem(dormStorageKey('guest', 'pu')) ?? 'null');
  expect(stored.repairs).toHaveLength(1);
  expect(stored.repairs[0]).toMatchObject({ title: '冷氣異音', status: 'reported' });
  expect(screen.getByText(DORM_REPAIR_COPY.intro)).toBeTruthy();
  expect(screen.queryByText(DORM_REPAIR_DISALLOWED_COPY)).toBeNull();
});

it('keeps separate room notes after switching selected school', () => {
  const view = render(<DormitoryPage />);
  fireEvent.change(screen.getByRole('textbox', { name: '宿舍或學苑名稱' }), { target: { value: '思高學苑' } });
  fireEvent.click(screen.getByRole('button', { name: '儲存住宿備忘' }));
  selectedCampus.schoolId = 'ncku';
  selectedCampus.schoolName = '國立成功大學';
  view.rerender(<DormitoryPage />);
  expect((screen.getByRole('textbox', { name: '宿舍或學苑名稱' }) as HTMLInputElement).value).toBe('');
  expect(localStorage.getItem(dormStorageKey('guest', 'pu'))).toContain('思高學苑');
  expect(localStorage.getItem(dormStorageKey('guest', 'ncku'))).toBeNull();
});

it('routes an NTOU repair by category with a local reference field', () => {
  selectedCampus.schoolId = 'ntou';
  selectedCampus.schoolName = '國立臺灣海洋大學';
  render(<DormitoryPage />);
  fireEvent.click(screen.getByRole('button', { name: '設備問題' }));
  fireEvent.click(screen.getByRole('button', { name: '宿舍網路無法連線' }));
  expect(screen.getByRole('link', { name: '致電海大宿網客服' }).getAttribute('href')).toBe('tel:0800080412');
  expect(screen.getByLabelText(DORM_REPAIR_COPY.referenceLabel)).toBeTruthy();
});

it('opens a legacy repair at its saved location even after the resident changes halls', () => {
  const key = dormStorageKey('guest', 'pu');
  localStorage.setItem(key, JSON.stringify({
    building: '思高學苑',
    repairs: [{ id: 'older', category: 'water', title: '洗手台漏水', location: '希嘉學苑一樓', status: 'reported' }],
  }));
  render(<DormitoryPage />);
  fireEvent.click(screen.getByRole('button', { name: '設備問題' }));
  expect(screen.getByRole('link', { name: '致電希嘉學苑服務台' }).getAttribute('href')).toBe('tel:0426328001');
  expect(screen.queryByRole('link', { name: /思高/ })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: '編輯' }));
  expect(screen.getByLabelText(DORM_REPAIR_COPY.referenceLabel)).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: DORM_REPAIR_COPY.saveMemo }));
  expect(JSON.parse(localStorage.getItem(key)!).repairs[0]).toMatchObject({ id: 'older', status: 'reported', location: '希嘉學苑一樓' });
});

it('restores saved local references for viewing, copying and editing', async () => {
  const writeText = vi.fn().mockResolvedValue(undefined);
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
  localStorage.setItem(dormStorageKey('guest', 'pu'), JSON.stringify({ repairs: [{ id: 'r1', title: '洗手台漏水', reference: 'PRIVATE-001587', location: '希嘉學苑一樓' }] }));
  render(<DormitoryPage />);
  fireEvent.click(screen.getByRole('button', { name: '設備問題' }));
  expect(screen.getByText(/PRIVATE-001587/)).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: '複製編號' }));
  expect(writeText).toHaveBeenCalledWith('PRIVATE-001587');
  fireEvent.click(screen.getByRole('button', { name: '編輯' }));
  fireEvent.change(screen.getByLabelText(DORM_REPAIR_COPY.referenceLabel), { target: { value: 'LOCAL-UPDATED' } });
  fireEvent.click(screen.getByRole('button', { name: DORM_REPAIR_COPY.saveMemo }));
  expect(JSON.parse(localStorage.getItem(dormStorageKey('guest', 'pu'))!).repairs[0].reference).toBe('LOCAL-UPDATED');
  fireEvent.click(screen.getByRole('button', { name: '複製內容' }));
  expect(await screen.findByText(/已複製問題說明/)).toBeTruthy();
  expect(writeText.mock.calls.at(-1)![0]).toContain('洗手台漏水');
  expect(document.body.textContent).not.toMatch(/已送出|單號/);
  Reflect.deleteProperty(navigator, 'clipboard');
});

it('clears stale copy feedback across success, failure and retry', async () => {
  const writeText = vi.fn().mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error('denied')).mockResolvedValueOnce(undefined);
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
  try {
    localStorage.setItem(dormStorageKey('guest', 'pu'), JSON.stringify({ repairs: [{ id: 'copy', title: '燈泡故障', reference: 'LOCAL-1' }] }));
    render(<DormitoryPage />);
    fireEvent.click(screen.getByRole('button', { name: '設備問題' }));
    const copy = screen.getByRole('button', { name: '複製編號' });
    fireEvent.click(copy);
    expect(await screen.findByText('已複製編號。')).toBeTruthy();
    fireEvent.click(copy);
    expect(await screen.findByText('無法複製，請手動選取編號。')).toBeTruthy();
    expect(screen.queryByText('已複製編號。')).toBeNull();
    fireEvent.click(copy);
    expect(await screen.findByText('已複製編號。')).toBeTruthy();
    expect(screen.queryByText('無法複製，請手動選取編號。')).toBeNull();
  } finally {
    Reflect.deleteProperty(navigator, 'clipboard');
  }
});

it('refuses stale writes from another browser tab instead of overwriting changes', () => {
  render(<DormitoryPage />);
  fireEvent.change(screen.getByRole('textbox', { name: '宿舍或學苑名稱' }), { target: { value: '本頁草稿' } });
  localStorage.setItem(dormStorageKey('guest', 'pu'), JSON.stringify({ version: 1, building: '另一頁的內容' }));
  fireEvent.click(screen.getByRole('button', { name: '儲存住宿備忘' }));
  expect(screen.getByRole('alert').textContent).toContain('有另一處修改了這份紀錄');
  expect(localStorage.getItem(dormStorageKey('guest', 'pu'))).toContain('另一頁的內容');
});


it('shows verified PU housing reference only for the selected school', () => {
  const page = render(<DormitoryPage />);
  fireEvent.click(screen.getByRole('button', { name: '宿舍指南' }));
  expect(screen.getByRole('heading', { name: '思高學苑' })).toBeTruthy();
  expect(screen.getByText(/24 小時校安專線/)).toBeTruthy();
  expect(screen.getByText(/不代表有空床或可直接申請/)).toBeTruthy();
  selectedCampus.schoolId = 'ncku';
  selectedCampus.schoolName = '國立成功大學';
  page.rerender(<DormitoryPage />);
  fireEvent.click(screen.getByRole('button', { name: '宿舍指南' }));
  expect(screen.queryByRole('heading', { name: '思高學苑' })).toBeNull();
  expect(screen.getByText(/尚無可核實的房型與費用清單/)).toBeTruthy();
});

it('adds, completes and edits a personal date with storage persistence', () => {
  render(<DormitoryPage />);
  fireEvent.click(screen.getByRole('button', { name: '重要日期' }));
  fireEvent.click(screen.getByRole('button', { name: '＋ 新增日期' }));
  fireEvent.change(screen.getByRole('textbox', { name: '事項名稱 *' }), { target: { value: '住宿繳費截止' } });
  fireEvent.change(screen.getByLabelText('日期 *'), { target: { value: '2026-11-15' } });
  fireEvent.click(screen.getByRole('button', { name: '儲存日期' }));
  expect(screen.getByRole('heading', { name: '住宿繳費截止' })).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: '標記完成' }));
  const key = dormStorageKey('guest', 'pu');
  expect(JSON.parse(localStorage.getItem(key) ?? 'null').milestones[0]).toMatchObject({
    title: '住宿繳費截止', dueDate: '2026-11-15', completed: true,
  });
  fireEvent.click(screen.getByRole('button', { name: '編輯' }));
  fireEvent.change(screen.getByRole('textbox', { name: '事項名稱 *' }), { target: { value: '退宿日期' } });
  fireEvent.click(screen.getByRole('button', { name: '儲存日期' }));
  expect(JSON.parse(localStorage.getItem(key) ?? 'null').milestones).toHaveLength(1);
  expect(JSON.parse(localStorage.getItem(key) ?? 'null').milestones[0]).toMatchObject({
    title: '退宿日期', completed: true,
  });
});

it('saves a room inspection and prefills a repair without notifying the school', () => {
  render(<DormitoryPage />);
  fireEvent.click(screen.getByRole('button', { name: '入住與退宿' }));
  const air = screen.getByRole('group', { name: '冷氣與遙控器狀態' });
  fireEvent.click(within(air).getByRole('button', { name: '待處理' }));
  const key = dormStorageKey('guest', 'pu');
  expect(JSON.parse(localStorage.getItem(key) ?? 'null').inspection).toMatchObject({ air: 'issue' });
  fireEvent.click(screen.getByRole('button', { name: '記錄問題' }));
  expect((screen.getByRole('textbox', { name: '問題名稱 *' }) as HTMLInputElement).value).toBe('冷氣或遙控器需要檢查');
  fireEvent.click(screen.getByRole('button', { name: DORM_REPAIR_COPY.saveMemo }));
  const data = JSON.parse(localStorage.getItem(key) ?? 'null');
  expect(data.repairs[0]).toMatchObject({ category: 'air', status: 'draft' });
  expect(data.inspection.air).toBe('issue');
});

it('records a parcel and allows the resident to update collection status', () => {
  render(<DormitoryPage />);
  fireEvent.click(screen.getByRole('button', { name: '包裹領取' }));
  fireEvent.click(screen.getByRole('button', { name: '網購包裹' }));
  expect((screen.getByRole('textbox', { name: '包裹名稱 *' }) as HTMLInputElement).value).toBe('網購包裹');
  fireEvent.change(screen.getByRole('textbox', { name: '領取地點' }), { target: { value: '宿舍服務台' } });
  fireEvent.change(screen.getByLabelText('預計取件日期（選填）'), { target: { value: '2026-11-15' } });
  fireEvent.click(screen.getByRole('button', { name: '儲存包裹' }));
  const key = dormStorageKey('guest', 'pu');
  expect(JSON.parse(localStorage.getItem(key) ?? 'null').parcels).toHaveLength(1);
  expect(screen.getByRole('heading', { name: '網購包裹' })).toBeTruthy();
  expect(screen.getByText(/沒有接入學校收發室/)).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: '標記已領取' }));
  expect(JSON.parse(localStorage.getItem(key) ?? 'null').parcels[0]).toMatchObject({
    title: '網購包裹', pickupPoint: '宿舍服務台', collected: true,
  });
  fireEvent.click(screen.getByRole('button', { name: '已領取' }));
  expect(screen.getByRole('heading', { name: '網購包裹' })).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: '恢復待領' }));
  expect(JSON.parse(localStorage.getItem(key) ?? 'null').parcels[0].collected).toBe(false);
});

it('keeps package notes separate when switching schools', () => {
  const page = render(<DormitoryPage />);
  fireEvent.click(screen.getByRole('button', { name: '包裹領取' }));
  fireEvent.click(screen.getByRole('button', { name: '掛號郵件' }));
  fireEvent.click(screen.getByRole('button', { name: '儲存包裹' }));
  selectedCampus.schoolId = 'ncku';
  selectedCampus.schoolName = '國立成功大學';
  page.rerender(<DormitoryPage />);
  fireEvent.click(screen.getByRole('button', { name: '包裹領取' }));
  expect(screen.queryByRole('heading', { name: '掛號郵件' })).toBeNull();
  expect(JSON.parse(localStorage.getItem(dormStorageKey('guest', 'pu')) ?? 'null').parcels).toHaveLength(1);
  expect(localStorage.getItem(dormStorageKey('guest', 'ncku'))).toBeNull();
});

it('pre-fills a common repair but never submits it to the school automatically', () => {
  render(<DormitoryPage />);
  fireEvent.change(screen.getByRole('textbox', { name: '寢室' }), { target: { value: '305' } });
  fireEvent.click(screen.getByRole('button', { name: '儲存住宿備忘' }));
  fireEvent.click(screen.getByRole('button', { name: '設備問題' }));
  fireEvent.click(screen.getByRole('button', { name: '冷氣無法正常運作' }));
  expect((screen.getByRole('textbox', { name: '問題名稱 *' }) as HTMLInputElement).value).toBe('冷氣無法正常運作');
  expect((screen.getByRole('textbox', { name: '位置' }) as HTMLInputElement).value).toBe('寢室 305');
  expect(localStorage.getItem(dormStorageKey('guest', 'pu'))).not.toContain('冷氣無法正常運作');
  fireEvent.click(screen.getByRole('button', { name: DORM_REPAIR_COPY.saveMemo }));
  expect(JSON.parse(localStorage.getItem(dormStorageKey('guest', 'pu')) ?? 'null').repairs[0]).toMatchObject({
    title: '冷氣無法正常運作', status: 'draft',
  });
  expect(screen.queryByText(DORM_REPAIR_DISALLOWED_COPY)).toBeNull();
});

it('keeps repair copy honest: local memo only, no ticket or school-progress claims', () => {
  render(<DormitoryPage />);
  fireEvent.click(screen.getByRole('button', { name: '設備問題' }));
  expect(screen.getByText(DORM_REPAIR_COPY.intro)).toBeTruthy();
  expect(screen.getByText(DORM_REPAIR_COPY.emptyHint)).toBeTruthy();
  expect(screen.queryByText(DORM_REPAIR_DISALLOWED_COPY)).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: '＋ 記錄問題' }));
  expect(screen.getByRole('button', { name: DORM_REPAIR_COPY.saveMemo })).toBeTruthy();
  expect(screen.getByLabelText(DORM_REPAIR_COPY.referenceLabel)).toBeTruthy();
  expect(screen.queryByRole('button', { name: /送出/ })).toBeNull();
  expect(screen.queryByText(DORM_REPAIR_DISALLOWED_COPY)).toBeNull();
});

it('keeps contact arrangements and follow-up notes through edits and reopening a repaired item', () => {
  render(<DormitoryPage />);
  fireEvent.click(screen.getByRole('button', { name: '設備問題' }));
  fireEvent.click(screen.getByRole('button', { name: '冷氣無法正常運作' }));
  fireEvent.change(screen.getByLabelText('可聯繫時段／入室協調（選填）'), { target: { value: '週五 18 點後，入室前聯絡' } });
  fireEvent.change(screen.getByLabelText('下次追問日期（選填）'), { target: { value: '2026-12-01' } });
  fireEvent.change(screen.getByLabelText('聯繫紀錄（自行記錄）'), { target: { value: '11/14 服務台請我補照片' } });
  fireEvent.click(screen.getByRole('button', { name: DORM_REPAIR_COPY.saveMemo }));
  expect(screen.getByText(/下次追問：2026-12-01/)).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: '編輯' }));
  expect((screen.getByLabelText('聯繫紀錄（自行記錄）') as HTMLTextAreaElement).value).toBe('11/14 服務台請我補照片');
  fireEvent.click(screen.getByRole('button', { name: DORM_REPAIR_COPY.saveMemo }));
  fireEvent.click(screen.getByRole('button', { name: '我已確認修復' }));
  expect(screen.queryByText(/下次追問：/)).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: '重新開啟備忘' }));
  const saved = JSON.parse(localStorage.getItem(dormStorageKey('guest', 'pu'))!).repairs[0];
  expect(saved).toMatchObject({ status: 'draft', availability: '週五 18 點後，入室前聯絡', followUpDate: '2026-12-01', followUpNote: '11/14 服務台請我補照片' });
});
