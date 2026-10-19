import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TransitExplorer } from './TransitExplorer';
import { queryTransit, type TransitResult, type TransitStop } from '@/lib/transit';

vi.mock('@/lib/transit', async (original) => ({
  ...(await original<typeof import('@/lib/transit')>()),
  queryTransit: vi.fn(),
}));
const stops: TransitStop[] = [
  { id: 'TXG001', name: '靜宜大學', city: 'Taichung', lat: 24.22, lon: 120.58, distance: null },
  { id: 'TXG002', name: '靜宜大學', city: 'Taichung', lat: 24.221, lon: 120.58, distance: null },
];
const stopResult = (): TransitResult => ({ status: 'ready', kind: 'stops', stops, limited: false, fetchedAt: new Date().toISOString() });
const emptyArrivals = (): TransitResult => ({ status: 'ready', kind: 'arrivals', arrivals: [], fetchedAt: new Date().toISOString() });
const renderExplorer = () => render(<TransitExplorer schoolId="pu" schoolName="靜宜大學" />);

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
  vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(true);
  vi.stubGlobal('isSecureContext', true);
  vi.mocked(queryTransit).mockImplementation(async (query) => query.action === 'arrivals' ? emptyArrivals() : stopResult());
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
  expect(screen.getByText('正在讀取站牌…')).toBeTruthy();
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
  await screen.findByText(/站牌代碼 TXG001/);
  expect(queryTransit).toHaveBeenCalledWith({ action: 'campus', schoolId: 'pu' }, expect.any(AbortSignal));
  expect(locate).not.toHaveBeenCalled();
  expect(screen.getByText(/站牌代碼 TXG002/)).toBeTruthy();
});

it('keeps school and manual search available when location permission is denied', async () => {
  const locate = vi.fn((_ok: PositionCallback, fail: PositionErrorCallback) => fail({ code: 1 } as GeolocationPositionError));
  vi.stubGlobal('navigator', { onLine: true, geolocation: { getCurrentPosition: locate } });
  renderExplorer();
  fireEvent.click(screen.getByRole('button', { name: '找我附近' }));
  fireEvent.click(screen.getByRole('button', { name: '使用我的位置' }));
  expect(await screen.findByText(/你尚未允許定位/)).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: '學校站牌' }));
  await screen.findByText(/站牌代碼 TXG001/);
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
    if (query.action !== 'arrivals') return stopResult();
    if (query.stopId === 'TXG002') return emptyArrivals();
    firstSignal = signal;
    return new Promise((resolve) => { finish = resolve; });
  });
  renderExplorer();
  await waitFor(() => expect(queryTransit).toHaveBeenCalledWith(
    { action: 'arrivals', city: 'Taichung', stopId: 'TXG001' }, expect.any(AbortSignal),
  ));
  fireEvent.click(await screen.findByRole('button', { name: /站牌代碼 TXG002/ }));
  await screen.findByText(/目前沒有班次預估/);
  expect(firstSignal.aborted).toBe(true);
  await act(async () => finish({ status: 'ready', kind: 'arrivals', fetchedAt: new Date().toISOString(), arrivals: [{ id: 'old', route: '舊站路線', direction: 0, destination: '', status: 0, seconds: 480, updatedAt: new Date().toISOString() }] }));
  expect(screen.queryByText('舊站路線')).toBeNull();
});

it('saves public stops, never the location-derived distance, and supports removing a favorite', async () => {
  renderExplorer();
  fireEvent.click(await screen.findByRole('button', { name: '收藏 靜宜大學 TXG001' }));
  const saved = JSON.parse(localStorage.getItem('campus-one:transit-stops:v1') || '[]');
  expect(saved).toHaveLength(1);
  expect(saved[0].distance).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: '常用站牌 1' }));
  expect(screen.getByRole('button', { name: '取消收藏 靜宜大學 TXG001' })).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: '取消收藏 靜宜大學 TXG001' }));
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
  renderExplorer();
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
  vi.mocked(queryTransit).mockImplementation(async (query) => query.action !== 'arrivals' ? stopResult() : {
    status: 'ready', kind: 'arrivals', fetchedAt: new Date().toISOString(),
    arrivals: [{ id: 'a', route: '300', direction: 0, destination: '', status: 0, seconds: 480, updatedAt: new Date().toISOString() }],
  });
  await act(async () => { renderExplorer(); });
  expect(screen.getByText('約 8 分鐘')).toBeTruthy();
  const calls = vi.mocked(queryTransit).mock.calls.length;
  vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
  await act(async () => {
    document.dispatchEvent(new Event('visibilitychange'));
    vi.advanceTimersByTime(90_000);
  });
  expect(screen.queryByText('約 8 分鐘')).toBeNull();
  expect(screen.getByText('資料待更新')).toBeTruthy();
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
      { id: 'live', route: '162', direction: 1, destination: '', status: 0, seconds: 180, updatedAt: now },
      { id: 'ended', route: '326', direction: 0, destination: '', status: 3, seconds: null, updatedAt: now },
    ],
  } : stopResult());
  renderExplorer();
  expect(await screen.findByText(/162 路 · 約 3 分鐘/)).toBeTruthy();
  expect(screen.getByText('下一班')).toBeTruthy();
  expect(screen.getAllByText('返程（終點未提供）')).toHaveLength(2);
  expect(screen.getByText('其他班次（目前沒有即時預估）')).toBeTruthy();
  expect(screen.getByText('末班車已駛離')).toBeTruthy();
});

it('keeps the last good arrivals and blocks repeated refreshes when rate limited', async () => {
  const now = new Date().toISOString();
  let arrivalCalls = 0;
  vi.mocked(queryTransit).mockImplementation(async (query) => {
    if (query.action !== 'arrivals') return stopResult();
    arrivalCalls += 1;
    return arrivalCalls === 1 ? {
      status: 'ready', kind: 'arrivals', fetchedAt: now,
      arrivals: [{ id: 'live', route: '162', direction: 1, destination: '', status: 0, seconds: 600, updatedAt: now }],
    } : { status: 'unavailable', reason: 'rate-limited' };
  });
  renderExplorer();
  expect(await screen.findByText(/162 路 · 約 10 分鐘/)).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: '更新班次' }));
  expect(await screen.findByText(/查詢的人較多，先顯示/)).toBeTruthy();
  expect(screen.getByText(/162 路 · 約 10 分鐘/)).toBeTruthy();
  const button = screen.getByRole('button', { name: '稍後自動再試' }) as HTMLButtonElement;
  expect(button.disabled).toBe(true);
});

it('warns that same-name stops cannot be told apart by stop code alone', async () => {
  renderExplorer();
  expect(await screen.findByText(/同名站牌不只一個，可能是道路兩側或行經路線不同/)).toBeTruthy();
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
  vi.mocked(queryTransit).mockResolvedValue(catalogResult());
  await act(async () => { renderExplorer(); });
  expect(screen.getByText('即時到站尚未接通')).toBeTruthy();
  expect(screen.queryByText(/到站時間為預估值/)).toBeNull();
  expect(screen.getByText('去程 · 往 臺中車站')).toBeTruthy();
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
  expect(vi.mocked(queryTransit).mock.calls.map(([query]) => query.action)).toEqual(['campus']);
});

it('preserves static provider metadata across browser favorites and does not turn a restored stop into a TDX query', async () => {
  vi.mocked(queryTransit).mockResolvedValue(catalogResult());
  const view = renderExplorer();
  fireEvent.click(await screen.findByRole('button', { name: '收藏 靜宜大學 300 路線 · 去程 · 靜態站牌資料 第 1 站牌' }));
  const saved = JSON.parse(localStorage.getItem('campus-one:transit-stops:v1') || '[]');
  expect(saved[0]).toMatchObject({ source: 'taichung-open-data', catalogDate: catalogStop.catalogDate, routes: catalogStop.routes, distance: null });
  view.unmount();
  vi.clearAllMocks();
  render(<TransitExplorer schoolId="nthu" schoolName="國立清華大學" />);
  fireEvent.click(screen.getByRole('button', { name: '常用站牌 1' }));
  fireEvent.click(screen.getByRole('button', { name: /01\s*靜宜大學.*300 路線.*去程/ }));
  expect(screen.getByText('即時到站尚未接通')).toBeTruthy();
  expect(screen.getByText('去程 · 往 臺中車站')).toBeTruthy();
  expect(queryTransit).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: '取消收藏 靜宜大學 300 路線 · 去程 · 靜態站牌資料 第 1 站牌' }));
  expect(screen.getByText(/在站牌旁按「收藏」/)).toBeTruthy();
});

it('aborts in-flight arrivals when switching to a static stop and resumes only when a TDX stop is selected', async () => {
  let finish!: (result: TransitResult) => void;
  let arrivalSignal!: AbortSignal;
  vi.mocked(queryTransit).mockImplementation(async (query, signal) => {
    if (query.action !== 'arrivals') return { ...catalogResult(), status: 'ready', kind: 'stops', stops: [stops[0], catalogStop], limited: false, fetchedAt: new Date().toISOString() };
    arrivalSignal = signal;
    return new Promise((resolve) => { finish = resolve; });
  });
  renderExplorer();
  await waitFor(() => expect(queryTransit).toHaveBeenCalledWith({ action: 'arrivals', city: 'Taichung', stopId: 'TXG001' }, expect.any(AbortSignal)));
  fireEvent.click(screen.getByRole('button', { name: /02\s*靜宜大學.*300 路線.*去程/ }));
  expect(arrivalSignal.aborted).toBe(true);
  expect(screen.getByText('即時到站尚未接通')).toBeTruthy();
  await act(async () => finish({ status: 'ready', kind: 'arrivals', fetchedAt: new Date().toISOString(), arrivals: [{ id: 'old', route: '舊路線', direction: 0, destination: '', status: 0, seconds: 600, updatedAt: new Date().toISOString() }] }));
  expect(screen.queryByText('舊路線')).toBeNull();
  expect(vi.mocked(queryTransit).mock.calls.filter(([query]) => query.action === 'arrivals')).toHaveLength(1);
  vi.mocked(queryTransit).mockResolvedValue(emptyArrivals());
  fireEvent.click(screen.getByRole('button', { name: /站牌代碼 TXG001/ }));
  await screen.findByText(/目前沒有班次預估/);
  expect(vi.mocked(queryTransit).mock.calls.filter(([query]) => query.action === 'arrivals')).toHaveLength(2);
});

});
