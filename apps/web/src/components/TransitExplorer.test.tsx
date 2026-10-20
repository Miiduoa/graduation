import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TransitExplorer } from './TransitExplorer';
import { queryTransit, type TransitResult, type TransitStop } from '@/lib/transit';

vi.mock('@/lib/transit', async (original) => ({
  ...(await original<typeof import('@/lib/transit')>()),
  queryTransit: vi.fn(),
}));
const stops: TransitStop[] = [
  { id: 'TXG001', name: '靜宜大學(英才路)', city: 'Taichung', lat: 24.2266, lon: 120.5748, distance: null,
    routes: [{ name: '162', direction: '去', destination: '嘉陽高中' }] },
  { id: 'TXG002', name: '靜宜大學(校門)', city: 'Taichung', lat: 24.2253, lon: 120.5778, distance: null,
    routes: [{ name: '301', direction: '返', destination: '靜宜大學靜園餐廳' }] },
];
const stopResult = (): TransitResult => ({ status: 'ready', kind: 'stops', stops, limited: false, fetchedAt: new Date().toISOString() });
const emptyArrivals = (): TransitResult => ({ status: 'ready', kind: 'arrivals', arrivals: [], fetchedAt: new Date().toISOString() });
const renderExplorer = () => render(<TransitExplorer schoolId="pu" schoolName="靜宜大學" />);
const renderListing = () => render(<TransitExplorer schoolId="ncku" schoolName="國立成功大學" />);
const groupName = (label: string) => (name: string) =>
  name.includes(label) && !name.includes('收藏');
const groupButton = (label: string) => screen.getByRole('button', { name: groupName(label) });
const findGroupButton = (label: string) => screen.findByRole('button', { name: groupName(label) });

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
  vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(true);
  vi.stubGlobal('isSecureContext', true);
  vi.mocked(queryTransit).mockImplementation(async (query) => {
    if (query.action === 'campus-next') {
      return { status: 'ready', kind: 'arrivals', arrivals: [], fetchedAt: new Date().toISOString() };
    }
    return query.action === 'arrivals' ? emptyArrivals() : stopResult();
  });
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it('shows only the loading copy while campus stops are being fetched', () => {
  vi.mocked(queryTransit).mockImplementation(() => new Promise(() => {}));
  renderExplorer();
  expect(screen.getByTestId('campus-skeleton')).toBeTruthy();
  expect(screen.queryByText('0 站')).toBeNull();
  expect(screen.queryByText('這間學校附近還沒有站牌資料。')).toBeNull();
  expect(screen.queryByText(/沒有找到站牌/)).toBeNull();
  expect(screen.queryByText(/到站時間/)).toBeNull();
  expect(screen.queryByText(/預估/)).toBeNull();
});

it('starts with school stops without requesting the user location', async () => {
  const locate = vi.fn();
  vi.stubGlobal('navigator', { onLine: true, geolocation: { getCurrentPosition: locate } });
  renderExplorer();
  expect(await screen.findByRole('tab', { name: '往沙鹿' })).toBeTruthy();
  expect(queryTransit).toHaveBeenCalledWith({ action: 'campus-next', schoolId: 'pu' }, expect.any(AbortSignal));
  expect(vi.mocked(queryTransit).mock.calls.some(([query]) => query.action === 'campus')).toBe(false);
  expect(locate).not.toHaveBeenCalled();
  expect(screen.getByRole('tab', { name: '往校內' })).toBeTruthy();
  expect(screen.getByRole('tab', { name: '往市區' })).toBeTruthy();
  expect(screen.getByRole('tab', { name: '專用道' })).toBeTruthy();
  expect(screen.queryByText(/TXG/)).toBeNull();
  fireEvent.click(screen.getByRole('tab', { name: '專用道' }));
  expect(await screen.findByText('暫無班次資訊')).toBeTruthy();
  expect(screen.getByText('專用道站牌')).toBeTruthy();
});

it('shows Providence gate routes from campus-next without querying a default stop', async () => {
  const now = new Date().toISOString();
  vi.mocked(queryTransit).mockImplementation(async (query) => {
    if (query.action === 'campus-next') {
      return {
        status: 'ready', kind: 'arrivals', fetchedAt: now,
        arrivals: [
          { id: '162', route: '162', direction: 1, destination: '沙鹿火車站', status: 0, seconds: 180, updatedAt: now, stopName: '靜宜大學(英才路)' },
          { id: '301', route: '301', direction: 1, destination: '台中車站', status: 0, seconds: null, updatedAt: now, stopName: '靜宜大學(校門)', scheduledAt: new Date(Date.now() + 12 * 60_000).toISOString() },
          { id: '326', route: '326', direction: 1, destination: '新民高中', status: 3, seconds: null, updatedAt: now, stopName: '靜宜大學' },
          { id: '368', route: '368', direction: 0, destination: '主顧聖母堂', status: 0, seconds: 600, updatedAt: now, stopName: '靜宜大學(校門)' },
        ],
      };
    }
    if (query.action === 'arrivals') return emptyArrivals();
    return stopResult();
  });
  renderExplorer();
  expect(await screen.findByText('3')).toBeTruthy();
  expect(screen.getByText('分')).toBeTruthy();
  expect(screen.getByRole('heading', { name: '公車' })).toBeTruthy();
  expect(screen.getByRole('button', { name: '重新整理' })).toBeTruthy();
  expect(screen.queryByRole('button', { name: '更新班次' })).toBeNull();
  expect(screen.getByText('往 沙鹿火車站')).toBeTruthy();
  expect(screen.getByText('校門口站牌・英才路側')).toBeTruthy();
  expect(screen.queryByText('暫時沒資料')).toBeNull();
  expect(screen.queryByText('即時到站尚未接通')).toBeNull();
  expect(screen.queryByText('到站時間為預估值')).toBeNull();
  fireEvent.click(screen.getByRole('tab', { name: '往市區' }));
  expect(screen.getByText('往 台中車站')).toBeTruthy();
  expect(screen.getByText(/表定 \d{1,2}:\d{2}/)).toBeTruthy();
  expect(screen.getByText('今天收班')).toBeTruthy();
  fireEvent.click(screen.getByRole('tab', { name: '往校內' }));
  expect(screen.getByText('10')).toBeTruthy();
  expect(screen.getByText('往 主顧聖母堂')).toBeTruthy();
  expect(screen.queryByText('往 校內')).toBeNull();
  expect(vi.mocked(queryTransit).mock.calls.some(([query]) => query.action === 'arrivals')).toBe(false);
  expect(vi.mocked(queryTransit).mock.calls.filter(([query]) => query.action === 'campus-next')).toHaveLength(1);
});

it('lists BRT arrivals on 專用道 and shows empty copy when that stop has no buses', async () => {
  const now = new Date().toISOString();
  vi.mocked(queryTransit).mockImplementation(async (query) => query.action === 'campus-next' ? {
    status: 'ready', kind: 'arrivals', fetchedAt: now,
    arrivals: [
      { id: '162', route: '162', direction: 1, destination: '沙鹿火車站', status: 0, seconds: 180, updatedAt: now, stopName: '靜宜大學(英才路)' },
      { id: '300', route: '300', direction: 0, destination: '台中車站', status: 0, seconds: 240, updatedAt: now, stopName: '靜宜大學(專用道)' },
      { id: '305', route: '305', direction: 0, destination: '台中車站', status: 0, seconds: 1200, updatedAt: now, stopName: '靜宜大學(專用道)' },
      { id: '306', route: '306', direction: 1, destination: '清水', status: 0, seconds: 1080, updatedAt: now, stopName: '靜宜大學(專用道)' },
    ],
  } : emptyArrivals());
  renderExplorer();
  expect(await screen.findByText('往 沙鹿火車站')).toBeTruthy();
  fireEvent.click(screen.getByRole('tab', { name: '專用道' }));
  expect(screen.getByText('300')).toBeTruthy();
  expect(screen.getAllByText('往 台中車站').length).toBeGreaterThan(0);
  expect(screen.getByText('還有 1 班')).toBeTruthy();
  expect(screen.queryByText('去程（終點未提供）')).toBeNull();
  expect(screen.getByText('專用道站牌')).toBeTruthy();
  expect(screen.queryByText('162')).toBeNull();
});

it('shows live, scheduled, empty and ended rows together on one direction', async () => {
  const now = new Date().toISOString();
  vi.mocked(queryTransit).mockImplementation(async (query) => query.action === 'campus-next' ? {
    status: 'ready', kind: 'arrivals', fetchedAt: now,
    arrivals: [
      { id: '162', route: '162', direction: 1, destination: '沙鹿火車站', status: 0, seconds: 180, updatedAt: now, stopName: '靜宜大學(英才路)' },
      { id: '301', route: '301', direction: 1, destination: '嘉陽高中', status: 0, seconds: null, updatedAt: now, stopName: '靜宜大學(英才路)', scheduledAt: new Date(Date.now() + 12 * 60_000).toISOString() },
      { id: '326', route: '326', direction: 1, destination: '巨業沙鹿站', status: 0, seconds: null, updatedAt: now, stopName: '靜宜大學(英才路)' },
      { id: '368', route: '368', direction: 1, destination: '沙鹿火車站', status: 3, seconds: null, updatedAt: now, stopName: '靜宜大學(英才路)' },
    ],
  } : query.action === 'arrivals' ? emptyArrivals() : stopResult());
  renderExplorer();
  expect(await screen.findByText('3')).toBeTruthy();
  expect(screen.getByText('分')).toBeTruthy();
  expect(screen.getByText(/表定 \d{1,2}:\d{2}/)).toBeTruthy();
  expect(screen.getByText('暫無班次資訊')).toBeTruthy();
  expect(screen.getByText('今天收班')).toBeTruthy();
  expect(screen.queryByText('這個方向今天的班次都結束了')).toBeNull();
  expect(screen.queryByText('即時到站尚未接通')).toBeNull();
  expect(screen.queryByText('到站時間為預估值')).toBeNull();
});

it('keeps scheduled times when this direction has no live bus without saying live data is down', async () => {
  const now = new Date().toISOString();
  vi.mocked(queryTransit).mockImplementation(async (query) => query.action === 'campus-next' ? {
    status: 'ready', kind: 'arrivals', fetchedAt: now,
    arrivals: [
      { id: '162', route: '162', direction: 1, destination: '沙鹿火車站', status: 0, seconds: null, updatedAt: now, stopName: '靜宜大學(英才路)', scheduledAt: new Date(Date.now() + 8 * 60_000).toISOString() },
      { id: '301', route: '301', direction: 1, destination: '嘉陽高中', status: 0, seconds: null, updatedAt: now, stopName: '靜宜大學(英才路)', scheduledAt: new Date(Date.now() + 18 * 60_000).toISOString() },
    ],
  } : emptyArrivals());
  renderExplorer();
  expect(await screen.findAllByText(/表定 \d{1,2}:\d{2}/)).toHaveLength(2);
  expect(screen.queryByText('讀不到即時資料，先顯示表定時間')).toBeNull();
  expect(screen.getByText(/\d{1,2}:\d{2} 更新/)).toBeTruthy();
  expect(screen.getAllByText(/表定 \d{1,2}:\d{2}/).length).toBeGreaterThan(1);
  expect(screen.queryByText('分')).toBeNull();
});

it('says live data is down only when the campus-next payload is stale', async () => {
  const now = new Date().toISOString();
  vi.mocked(queryTransit).mockImplementation(async (query) => query.action === 'campus-next' ? {
    status: 'ready', kind: 'arrivals', fetchedAt: now, stale: true,
    arrivals: [
      { id: '162', route: '162', direction: 1, destination: '主顧聖母堂', status: 0, seconds: null, updatedAt: now, stopName: '靜宜大學(校門)', scheduledAt: new Date(Date.now() + 8 * 60_000).toISOString() },
    ],
  } : emptyArrivals());
  renderExplorer();
  fireEvent.click(await screen.findByRole('tab', { name: '往校內' }));
  expect(await screen.findByText('讀不到即時資料，先顯示表定時間')).toBeTruthy();
});

it('keeps ended rows and adds the whole-direction hint', async () => {
  const now = new Date().toISOString();
  vi.mocked(queryTransit).mockImplementation(async (query) => query.action === 'campus-next' ? {
    status: 'ready', kind: 'arrivals', fetchedAt: now,
    arrivals: [
      { id: '162', route: '162', direction: 1, destination: '沙鹿火車站', status: 3, seconds: null, updatedAt: now, stopName: '靜宜大學(英才路)' },
      { id: '368', route: '368', direction: 1, destination: '巨業沙鹿站', status: 4, seconds: null, updatedAt: now, stopName: '靜宜大學(英才路)' },
    ],
  } : emptyArrivals());
  renderExplorer();
  expect(await screen.findByText('這個方向今天的班次都結束了')).toBeTruthy();
  expect(screen.getAllByText('今天收班')).toHaveLength(2);
});

it('blocks another manual refresh until the in-flight request finishes', async () => {
  let finish!: (result: TransitResult) => void;
  let calls = 0;
  const now = new Date().toISOString();
  vi.mocked(queryTransit).mockImplementation(async (query) => {
    if (query.action !== 'campus-next') return emptyArrivals();
    calls += 1;
    if (calls === 1) {
      return {
        status: 'ready', kind: 'arrivals', fetchedAt: now,
        arrivals: [{ id: '162', route: '162', direction: 1, destination: '沙鹿火車站', status: 0, seconds: 600, updatedAt: now, stopName: '靜宜大學(英才路)' }],
      };
    }
    return new Promise((resolve) => { finish = resolve; });
  });
  renderExplorer();
  expect(await screen.findByText('10')).toBeTruthy();
  const button = screen.getByRole('button', { name: '重新整理' }) as HTMLButtonElement;
  fireEvent.click(button);
  expect(button.disabled).toBe(true);
  await act(async () => finish({
    status: 'ready', kind: 'arrivals', fetchedAt: now,
    arrivals: [{ id: '162', route: '162', direction: 1, destination: '沙鹿火車站', status: 0, seconds: 300, updatedAt: now, stopName: '靜宜大學(英才路)' }],
  }));
  expect(await screen.findByText('5')).toBeTruthy();
  expect(button.disabled).toBe(false);
});

it('keeps school and manual search available when location permission is denied', async () => {
  const locate = vi.fn((_ok: PositionCallback, fail: PositionErrorCallback) => fail({ code: 1 } as GeolocationPositionError));
  vi.stubGlobal('navigator', { onLine: true, geolocation: { getCurrentPosition: locate } });
  renderExplorer();
  fireEvent.click(screen.getByRole('button', { name: '找我附近' }));
  fireEvent.click(screen.getByRole('button', { name: '使用我的位置' }));
  expect(await screen.findByText(/你尚未允許定位/)).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: '學校站牌' }));
  expect(await screen.findByRole('tab', { name: '往沙鹿' })).toBeTruthy();
  expect(screen.getByRole('button', { name: '搜尋站名' })).toBeTruthy();
});

it('ignores a late geolocation response after the user changes modes', async () => {
  let locateSuccess!: PositionCallback;
  vi.stubGlobal('navigator', { onLine: true, geolocation: { getCurrentPosition: (ok: PositionCallback) => { locateSuccess = ok; } } });
  renderExplorer();
  fireEvent.click(screen.getByRole('button', { name: '找我附近' }));
  fireEvent.click(screen.getByRole('button', { name: '使用我的位置' }));
  fireEvent.click(screen.getByRole('button', { name: '搜尋站名' }));
  await act(async () => locateSuccess({ coords: { latitude: 24.22, longitude: 120.58, accuracy: 20 } } as GeolocationPosition));
  expect(vi.mocked(queryTransit).mock.calls.some(([query]) => query.action === 'nearby')).toBe(false);
  expect(screen.getByLabelText('站名或學校名稱')).toBeTruthy();
});

it('uses the selected city and radius when location succeeds', async () => {
  vi.stubGlobal('navigator', { onLine: true, geolocation: { getCurrentPosition: (ok: PositionCallback) => ok({ coords: { latitude: 24.22, longitude: 120.58, accuracy: 20 } } as GeolocationPosition) } });
  renderExplorer();
  fireEvent.click(screen.getByRole('button', { name: '找我附近' }));
  fireEvent.change(screen.getByLabelText('查詢縣市'), { target: { value: 'Taipei' } });
  fireEvent.change(screen.getByLabelText('搜尋半徑'), { target: { value: '300' } });
  fireEvent.click(screen.getByRole('button', { name: '使用我的位置' }));
  await waitFor(() => expect(queryTransit).toHaveBeenCalledWith({ action: 'nearby', city: 'Taipei', lat: 24.22, lon: 120.58, radius: 300 }, expect.any(AbortSignal)));
  fireEvent.click(screen.getByRole('button', { name: '學校站牌' }));
  expect(screen.getByRole('link', { name: '官方公車網站 ↗' }).getAttribute('href')).toBe('https://citybus.taichung.gov.tw/');
});

it('does not send a station-name query for every keystroke', async () => {
  renderExplorer();
  fireEvent.click(screen.getByRole('button', { name: '搜尋站名' }));
  fireEvent.change(screen.getByLabelText('站名或學校名稱'), { target: { value: '臺中車站' } });
  expect(vi.mocked(queryTransit).mock.calls.some(([query]) => query.action === 'search')).toBe(false);
  fireEvent.click(screen.getByRole('button', { name: '尋找站牌' }));
  await waitFor(() => expect(queryTransit).toHaveBeenCalledWith({ action: 'search', city: 'Taichung', text: '臺中車站' }, expect.any(AbortSignal)));
});

it('abort and selection identity prevent an old station response from replacing the current one', async () => {
  let finish!: (result: TransitResult) => void;
  let firstSignal!: AbortSignal;
  vi.mocked(queryTransit).mockImplementation(async (query, signal) => {
    if (query.action === 'campus-next') return { status: 'ready', kind: 'arrivals', arrivals: [], fetchedAt: new Date().toISOString() };
    if (query.action !== 'arrivals') return stopResult();
    if (query.stopId === 'TXG002') return emptyArrivals();
    firstSignal = signal;
    return new Promise((resolve) => { finish = resolve; });
  });
  renderListing();
  fireEvent.click(await findGroupButton('校門口・往沙鹿'));
  await waitFor(() => expect(queryTransit).toHaveBeenCalledWith(
    { action: 'arrivals', city: 'Taichung', stopId: 'TXG001' }, expect.any(AbortSignal),
  ));
  fireEvent.click(await findGroupButton('校門口・往校內'));
  await screen.findByText(/目前沒有班次預估/);
  expect(firstSignal.aborted).toBe(true);
  await act(async () => finish({ status: 'ready', kind: 'arrivals', fetchedAt: new Date().toISOString(), arrivals: [{ id: 'old', route: '舊站路線', direction: 0, destination: '', status: 0, seconds: 480, updatedAt: new Date().toISOString() }] }));
  expect(screen.queryByText('舊站路線')).toBeNull();
});

it('saves public stops, never the location-derived distance, and supports removing a favorite', async () => {
  renderListing();
  fireEvent.click(await screen.findByRole('button', { name: /收藏 校門口・往沙鹿/ }));
  const saved = JSON.parse(localStorage.getItem('campus-one:transit-stops:v1') || '[]');
  expect(saved).toHaveLength(1);
  expect(saved[0].distance).toBeNull();
  expect(saved[0].name).toBe('校門口・往沙鹿');
  fireEvent.click(screen.getByRole('button', { name: '常用站牌 1' }));
  expect(screen.getByRole('button', { name: /取消收藏 校門口・往沙鹿/ })).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: /取消收藏 校門口・往沙鹿/ }));
  expect(screen.getByText(/在站牌旁按「收藏」/)).toBeTruthy();
});

it('shows a missing integration honestly with retry and official fallback', async () => {
  vi.mocked(queryTransit).mockResolvedValue({ status: 'unavailable', reason: 'not-configured' });
  renderExplorer();
  expect(await screen.findByText('暫時讀不到資料，請稍後再試')).toBeTruthy();
  expect(screen.getByRole('button', { name: '再試一次' })).toBeTruthy();
  expect(screen.getByRole('link', { name: '官方公車網站 ↗' })).toBeTruthy();
  expect(screen.queryByText('正在讀取站牌…')).toBeNull();
  expect(screen.queryByText('這間學校附近還沒有站牌資料。')).toBeNull();
  expect(screen.queryByText(/約 8 分鐘/)).toBeNull();
  expect(screen.queryByText(/到站時間/)).toBeNull();
  expect(screen.queryByText(/預估/)).toBeNull();
});

it('shows the school empty copy when campus stops load with none', async () => {
  vi.mocked(queryTransit).mockResolvedValue({ status: 'ready', kind: 'stops', stops: [], limited: false, fetchedAt: new Date().toISOString() });
  renderListing();
  expect(await screen.findByText('這間學校附近還沒有站牌資料。')).toBeTruthy();
  expect(screen.queryByText('正在讀取站牌…')).toBeNull();
  expect(screen.queryByText('暫時讀不到資料，請稍後再試')).toBeNull();
  expect(screen.queryByRole('button', { name: '再試一次' })).toBeNull();
  expect(screen.queryByText('0 站')).toBeNull();
  expect(screen.queryByText(/到站時間/)).toBeNull();
  expect(screen.queryByText(/預估/)).toBeNull();
});

it('expires countdowns while hidden without continuing to poll the provider', async () => {
  vi.useFakeTimers();
  const fetchedAt = new Date().toISOString();
  vi.mocked(queryTransit).mockImplementation(async (query) => query.action === 'campus-next' ? {
    status: 'ready', kind: 'arrivals', fetchedAt,
    arrivals: [{ id: 'a', route: '162', direction: 0, destination: '沙鹿火車站', status: 0, seconds: 480, updatedAt: fetchedAt, stopName: '靜宜大學(英才路)' }],
  } : query.action === 'arrivals' ? emptyArrivals() : stopResult());
  await act(async () => { renderExplorer(); });
  expect(screen.getByText('8')).toBeTruthy();
  const calls = vi.mocked(queryTransit).mock.calls.length;
  vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
  await act(async () => {
    document.dispatchEvent(new Event('visibilitychange'));
    vi.advanceTimersByTime(90_000);
  });
  expect(screen.queryByText('8')).toBeNull();
  expect(screen.getAllByText('暫無班次資訊').length).toBeGreaterThan(0);
  expect(vi.mocked(queryTransit).mock.calls.length).toBe(calls);
});


it('uses the selected university’s primary city rather than Taichung for public bus search', async () => {
  render(<TransitExplorer schoolId="nthu" schoolName="國立清華大學" />);
  const city = screen.getByLabelText('查詢縣市') as HTMLSelectElement;
  expect(city.value).toBe('Hsinchu');
  expect(screen.queryByRole('button', { name: '學校站牌' })).toBeNull();
  fireEvent.change(screen.getByLabelText('站名或學校名稱'), { target: { value: '清華大學' } });
  fireEvent.click(screen.getByRole('button', { name: '尋找站牌' }));
  await waitFor(() => expect(queryTransit).toHaveBeenCalledWith(
    { action: 'search', city: 'Hsinchu', text: '清華大學' },
    expect.any(AbortSignal),
  ));
  expect(vi.mocked(queryTransit).mock.calls.some(([query]) =>
    query.action === 'search' && query.city === 'Taichung')).toBe(false);
});

it('never assumes a city for an unfamiliar university', async () => {
  render(<TransitExplorer schoolId="external-university" schoolName="外部大學" />);
  const city = screen.getByLabelText('查詢縣市') as HTMLSelectElement;
  expect(city.value).toBe('');
  fireEvent.change(screen.getByLabelText('站名或學校名稱'), { target: { value: '圖書館' } });
  fireEvent.click(screen.getByRole('button', { name: '尋找站牌' }));
  expect(screen.getByText('請先選擇要查詢的縣市。')).toBeTruthy();
  expect(queryTransit).not.toHaveBeenCalled();
  fireEvent.change(city, { target: { value: 'Tainan' } });
  fireEvent.click(screen.getByRole('button', { name: '尋找站牌' }));
  await waitFor(() => expect(queryTransit).toHaveBeenCalledWith(
    { action: 'search', city: 'Tainan', text: '圖書館' },
    expect.any(AbortSignal),
  ));
});

it('resets the entire transit search when changing campuses', async () => {
  const view = render(<TransitExplorer schoolId="nthu" schoolName="國立清華大學" />);
  fireEvent.change(screen.getByLabelText('站名或學校名稱'), { target: { value: '清華大學' } });
  fireEvent.click(screen.getByRole('button', { name: '尋找站牌' }));
  await waitFor(() => expect(queryTransit).toHaveBeenCalledWith(
    { action: 'search', city: 'Hsinchu', text: '清華大學' }, expect.any(AbortSignal),
  ));
  view.rerender(<TransitExplorer schoolId="ncku" schoolName="國立成功大學" />);
  expect(screen.getByRole('button', { name: '學校站牌' }).getAttribute('aria-pressed')).toBe('true');
  expect(screen.getByText(/尋找名稱含「成大」的站牌/)).toBeTruthy();
  expect(screen.queryByLabelText('查詢縣市')).toBeNull();
  expect(screen.queryByLabelText('站名或學校名稱')).toBeNull();
  await waitFor(() => expect(queryTransit).toHaveBeenCalledWith(
    { action: 'campus', schoolId: 'ncku' }, expect.any(AbortSignal),
  ));
});



it('highlights the next live bus and separates buses without a live estimate', async () => {
  const now = new Date().toISOString();
  vi.mocked(queryTransit).mockImplementation(async (query) => query.action === 'arrivals' ? {
    status: 'ready', kind: 'arrivals', fetchedAt: now,
    arrivals: [
      { id: 'live', route: '162', direction: 1, destination: '沙鹿火車站', status: 0, seconds: 180, updatedAt: now, stopName: '靜宜大學(英才路)' },
      { id: 'ended', route: '326', direction: 0, destination: '沙鹿火車站', status: 3, seconds: null, updatedAt: now, stopName: '靜宜大學(英才路)' },
    ],
  } : query.action === 'campus-next' ? { status: 'ready', kind: 'arrivals', arrivals: [], fetchedAt: now } : stopResult());
  renderListing();
  fireEvent.click(await findGroupButton('校門口・往沙鹿'));
  expect(await screen.findByText(/162 路 · 約 3 分鐘/)).toBeTruthy();
  expect(screen.getByText('下一班')).toBeTruthy();
  expect(screen.getAllByText('往 沙鹿火車站').length).toBeGreaterThanOrEqual(2);
  expect(screen.getByText('其他班次（目前沒有即時預估）')).toBeTruthy();
  expect(screen.getByText('今天收班')).toBeTruthy();
});

it('keeps the last good arrivals and blocks repeated refreshes when rate limited', async () => {
  const now = new Date().toISOString();
  let nextCalls = 0;
  vi.mocked(queryTransit).mockImplementation(async (query) => {
    if (query.action === 'arrivals') return emptyArrivals();
    if (query.action !== 'campus-next') return stopResult();
    nextCalls += 1;
    return nextCalls === 1 ? {
      status: 'ready', kind: 'arrivals', fetchedAt: now,
      arrivals: [{ id: 'live', route: '162', direction: 1, destination: '沙鹿火車站', status: 0, seconds: 600, updatedAt: now, stopName: '靜宜大學(英才路)' }],
    } : { status: 'unavailable', reason: 'rate-limited' };
  });
  renderExplorer();
  expect(await screen.findByText('10')).toBeTruthy();
  const button = screen.getByRole('button', { name: '重新整理' }) as HTMLButtonElement;
  fireEvent.click(button);
  await waitFor(() => expect(nextCalls).toBe(2));
  expect(screen.getByText('10')).toBeTruthy();
  expect(button.disabled).toBe(false);
});

it('groups campus stops with student names and never shows stop codes', async () => {
  renderExplorer();
  expect(await screen.findByRole('tab', { name: '往沙鹿' })).toBeTruthy();
  expect(screen.getByRole('tab', { name: '往校內' })).toBeTruthy();
  expect(screen.queryByText(/TXG/)).toBeNull();
  expect(screen.queryByText(/站牌代碼/)).toBeNull();
});

describe('static catalog stops', () => {
  beforeEach(() => { vi.spyOn(Date, 'now').mockReturnValue(Date.parse('2026-10-18T08:00:00.000Z')); });

const catalogStop: TransitStop = {
  id: 'TCOD_pu_outbound', name: '靜宜大學', city: 'Taichung', lat: 24.226, lon: 120.576, distance: 120,
  source: 'taichung-open-data', catalogDate: '2026-10-18T04:00:00.000Z',
  routes: [{ name: '300', direction: '去', destination: '臺中車站' }],
};
const catalogResult = (): TransitResult => ({ ...stopResult(), status: 'ready', kind: 'stops', stops: [catalogStop], limited: false, fetchedAt: new Date().toISOString() });

it('shows catalog directions and source instead of polling or presenting the snapshot as a live arrival', async () => {
  vi.useFakeTimers();
  vi.mocked(queryTransit).mockImplementation(async (query) => query.action === 'campus-next'
    ? { status: 'unavailable', reason: 'not-configured' }
    : catalogResult());
  await act(async () => { renderListing(); });
  fireEvent.click(groupButton('校門口・往市區'));
  expect(screen.getByText('班次時間請至官方網站確認')).toBeTruthy();
  expect(screen.queryByText(/到站時間為預估值/)).toBeNull();
  expect(screen.getByText('去程 · 往 台中車站')).toBeTruthy();
  expect(screen.getByText(/資料快照：2026\/10\/18/)).toBeTruthy();
  expect(screen.getByRole('link', { name: '臺中市政府公車路線站牌資料 ↗' }).getAttribute('href')).toBe('https://data.gov.tw/dataset/81555');
  expect(screen.getByRole('link', { name: '前往臺中公車查即時到站 ↗' }).getAttribute('href')).toBe('https://citybus.taichung.gov.tw/');
  expect(screen.getByRole('link', { name: '開啟步行導航 ↗' }).getAttribute('href')).toContain('destination=24.226,120.576');
  expect(screen.queryByRole('button', { name: '更新班次' })).toBeNull();
  expect(screen.queryByText(/站牌代碼 TCOD_/)).toBeNull();
  await act(async () => {
    vi.advanceTimersByTime(180_000);
    window.dispatchEvent(new Event('online'));
    document.dispatchEvent(new Event('visibilitychange'));
  });
  expect(vi.mocked(queryTransit).mock.calls.some(([query]) => query.action === 'arrivals')).toBe(false);
  expect(vi.mocked(queryTransit).mock.calls.map(([query]) => query.action).includes('campus')).toBe(true);
});

it('preserves static provider metadata across browser favorites and does not turn a restored stop into a TDX query', async () => {
  vi.mocked(queryTransit).mockImplementation(async (query) => query.action === 'campus-next'
    ? { status: 'unavailable', reason: 'not-configured' }
    : catalogResult());
  const view = renderListing();
  fireEvent.click(await screen.findByRole('button', { name: /收藏 校門口・往市區/ }));
  const saved = JSON.parse(localStorage.getItem('campus-one:transit-stops:v1') || '[]');
  expect(saved[0]).toMatchObject({
    source: 'taichung-open-data', catalogDate: catalogStop.catalogDate, distance: null,
    routes: [{ name: '300', direction: '去', destination: '台中車站' }],
  });
  view.unmount();
  vi.clearAllMocks();
  render(<TransitExplorer schoolId="nthu" schoolName="國立清華大學" />);
  fireEvent.click(screen.getByRole('button', { name: '常用站牌 1' }));
  fireEvent.click(groupButton('校門口・往市區'));
  expect(screen.getByText('班次時間請至官方網站確認')).toBeTruthy();
  expect(screen.getByText('去程 · 往 台中車站')).toBeTruthy();
  expect(queryTransit).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: /取消收藏 校門口・往市區/ }));
  expect(screen.getByText(/在站牌旁按「收藏」/)).toBeTruthy();
});

it('aborts in-flight arrivals when switching to a static stop and resumes only when a TDX stop is selected', async () => {
  let finish!: (result: TransitResult) => void;
  let arrivalSignal!: AbortSignal;
  vi.mocked(queryTransit).mockImplementation(async (query, signal) => {
    if (query.action === 'campus-next') return { status: 'unavailable', reason: 'not-configured' };
    if (query.action !== 'arrivals') return { ...catalogResult(), status: 'ready', kind: 'stops', stops: [stops[0], catalogStop], limited: false, fetchedAt: new Date().toISOString() };
    arrivalSignal = signal;
    return new Promise((resolve) => { finish = resolve; });
  });
  renderListing();
  fireEvent.click(await findGroupButton('校門口・往沙鹿'));
  await waitFor(() => expect(queryTransit).toHaveBeenCalledWith({ action: 'arrivals', city: 'Taichung', stopId: 'TXG001' }, expect.any(AbortSignal)));
  fireEvent.click(groupButton('校門口・往市區'));
  expect(arrivalSignal.aborted).toBe(true);
  expect(screen.getByText('班次時間請至官方網站確認')).toBeTruthy();
  await act(async () => finish({ status: 'ready', kind: 'arrivals', fetchedAt: new Date().toISOString(), arrivals: [{ id: 'old', route: '舊路線', direction: 0, destination: '', status: 0, seconds: 600, updatedAt: new Date().toISOString() }] }));
  expect(screen.queryByText('舊路線')).toBeNull();
  expect(vi.mocked(queryTransit).mock.calls.filter(([query]) => query.action === 'arrivals')).toHaveLength(1);
  vi.mocked(queryTransit).mockResolvedValue(emptyArrivals());
  fireEvent.click(groupButton('校門口・往沙鹿'));
  await screen.findByText(/目前沒有班次預估/);
  expect(vi.mocked(queryTransit).mock.calls.filter(([query]) => query.action === 'arrivals')).toHaveLength(2);
});

});
