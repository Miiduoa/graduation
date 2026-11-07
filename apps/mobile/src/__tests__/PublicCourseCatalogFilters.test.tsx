import React from 'react';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { PublicCatalogCourse, PublicCourseCatalogResponse } from '@campus/shared/src/publicCourseCatalog';
import type { PublicCourseFilters } from '@campus/shared/src/publicCourseFilters';
import { resolvePublicCourseOperation } from '@campus/shared/src/publicCourseOperations';
import { PublicCourseCatalogScreen } from '../screens/PublicCourseCatalogScreen';

jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));
jest.mock('../ui/navigationTheme', () => ({ useTabBarContentBottomPadding: () => 0, TAB_BAR_CONTENT_BOTTOM_PADDING: 0 }));
jest.mock('../state/personalImportScope', () => ({
  usePersonalImportScope: () => ({ owner: 'guest:device', schoolId: 'nthu' }),
}));

const originalFetch = globalThis.fetch;
const fetchSource = jest.fn();
const course: PublicCatalogCourse = {
  code: '11510AES 520300', section: '00', title: '分析化學專題', department: 'AES', teacher: '王老師',
  time: 'M3M4\nR5R6', room: '教室甲\n教室乙', semester: '1151', credits: '3',
  meetings: [{ time: 'M3M4', room: '教室甲' }, { time: 'R5R6', room: '教室乙' }],
};
function catalog(filters?: PublicCourseFilters, changes: Partial<PublicCourseCatalogResponse> = {}): PublicCourseCatalogResponse {
  const operation = resolvePublicCourseOperation('nthu', filters ? 2 : 1)!;
  return {
    schoolId: 'nthu', sourceUrl: operation.sourceUrl,
    operation: filters
      ? { id: operation.id, version: 2, responseSchemaVersion: 2, access: operation.access }
      : { id: operation.id, version: 1, responseSchemaVersion: 1, access: operation.access },
    fetchedAt: '2026-11-07T08:00:00.000Z', courses: [course], truncated: false,
    ...(filters ? { filters, unresolvedCount: 0 } : {}), ...changes,
  };
}
function response(data = catalog(), url?: string) {
  return { ok: true, headers: { get: () => null }, text: async () => JSON.stringify(data), ...(url ? { url } : {}) };
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}
function query(index: number) {
  return Object.fromEntries(new URL(fetchSource.mock.calls[index][0]).searchParams);
}
beforeEach(() => {
  jest.clearAllMocks();
  fetchSource.mockReset().mockResolvedValue(response());
  globalThis.fetch = fetchSource;
});
afterEach(() => { globalThis.fetch = originalFetch; jest.restoreAllMocks(); jest.useRealTimers(); });

test('manual weekday and exact-credit filters are submitted together, with unknown data disclosed and every meeting retained', async () => {
  fetchSource.mockResolvedValue(response(catalog({ weekday: 1, credits: 3 }, { unresolvedCount: 2 })));
  const view = render(<PublicCourseCatalogScreen schoolId="nthu" />);
  fireEvent.changeText(view.getByLabelText('搜尋清大課程'), 'AES');
  fireEvent.press(view.getByRole('button', { name: '星期一' }));
  fireEvent.changeText(view.getByLabelText('課程學分'), '3');
  expect(fetchSource).not.toHaveBeenCalled();
  fireEvent.press(view.getByText('查詢課程'));
  await view.findByText('分析化學專題');
  expect(query(0)).toEqual({ schoolId: 'nthu', q: 'AES', weekday: '1', credits: '3' });
  expect(view.getByRole('button', { name: '星期一' }).props.accessibilityState.selected).toBe(true);
  expect(view.getByText('本次查詢條件：星期一有課 · 3 學分')).toBeTruthy();
  expect(view.getByText('星期條件表示當天有課，同一門課也可能在其他天上課。')).toBeTruthy();
  expect(view.getByText('星期一 3、4 節 · 10:10–12:00 · 教室甲')).toBeTruthy();
  expect(view.getByText('星期四 5、6 節 · 13:20–15:10 · 教室乙')).toBeTruthy();
  expect(view.getByText('另有 2 筆課程的篩選資料不足，未列入符合結果。')).toBeTruthy();
  expect(fetchSource.mock.calls[0][1]).toMatchObject({ credentials: 'omit', redirect: 'error' });
  expect(fetchSource.mock.calls[0][1]).not.toHaveProperty('cache');
  expect(AsyncStorage.setItem).not.toHaveBeenCalled();
});

test('filter-only entry works with an empty keyword and equivalent props do not refetch', async () => {
  fetchSource.mockResolvedValue(response(catalog({ weekday: 4, credits: 0.5 }, { courses: [{ ...course, credits: '0.5' }] })));
  const view = render(<PublicCourseCatalogScreen schoolId="nthu" initialFilters={{ weekday: 4, credits: 0.5 }} autoSearch />);
  await view.findByText('分析化學專題');
  expect(query(0)).toEqual({ schoolId: 'nthu', q: '', weekday: '4', credits: '0.5' });
  expect(view.getByLabelText('搜尋清大課程').props.value).toBe('');
  expect(view.getByLabelText('課程學分').props.value).toBe('0.5');
  view.rerender(<PublicCourseCatalogScreen schoolId="nthu" initialFilters={{ weekday: 4, credits: 0.5 }} autoSearch />);
  expect(fetchSource).toHaveBeenCalledTimes(1);
});

test('manual changes accept zero credits, then clearing filters returns to a keyword-only v1 read', async () => {
  fetchSource.mockResolvedValueOnce(response(catalog({ weekday: 1, credits: 3 })))
    .mockResolvedValueOnce(response(catalog({ weekday: 4, credits: 0 }, { courses: [{ ...course, credits: '0' }] })))
    .mockResolvedValueOnce(response());
  const view = render(<PublicCourseCatalogScreen schoolId="nthu" initialQuery="AES" initialFilters={{ weekday: 1, credits: 3 }} />);
  await view.findByText('分析化學專題');
  fireEvent.press(view.getByRole('button', { name: '星期四' }));
  fireEvent.changeText(view.getByLabelText('課程學分'), '0');
  expect(view.queryByText('分析化學專題')).toBeNull();
  expect(view.queryByText('本次查詢條件：星期一有課 · 3 學分')).toBeNull();
  fireEvent.press(view.getByText('查詢課程'));
  await view.findByText('分析化學專題');
  expect(query(1)).toEqual({ schoolId: 'nthu', q: 'AES', weekday: '4', credits: '0' });
  expect(view.getByText('本次查詢條件：星期四有課 · 0 學分')).toBeTruthy();
  fireEvent.press(view.getByText('清除星期與學分'));
  fireEvent.changeText(view.getByLabelText('課程學分'), '   ');
  expect(view.getByLabelText('搜尋清大課程').props.value).toBe('AES');
  expect(view.getByRole('button', { name: '星期不限' }).props.accessibilityState.selected).toBe(true);
  expect(fetchSource).toHaveBeenCalledTimes(2);
  fireEvent.press(view.getByText('查詢課程'));
  await view.findByText('分析化學專題');
  expect(query(2)).toEqual({ schoolId: 'nthu', q: 'AES' });
  expect(view.queryByText(/本次查詢條件：/)).toBeNull();
});

test.each(['-1', '40.01', '3.001', '3 學分', 'NaN', 'Infinity', '1e1'])('invalid manual credits stay editable and cannot silently become an unrestricted query: %s', (value) => {
  const view = render(<PublicCourseCatalogScreen schoolId="nthu" />);
  fireEvent.changeText(view.getByLabelText('課程學分'), value);
  fireEvent.press(view.getByText('查詢課程'));
  expect(view.getByLabelText('課程學分').props.value).toBe(value);
  expect(view.getByText(/學分請輸入 0–40 的數字/)).toBeTruthy();
  expect(fetchSource).not.toHaveBeenCalled();
  expect(view.queryByText('核對並加入課表')).toBeNull();
});

test.each(['weekday', 'credits', 'keyword', 'clear'])('editing %s cancels a pending read without submitting the draft or accepting its late result', async (change) => {
  const delayed = deferred<ReturnType<typeof response>>();
  fetchSource.mockReturnValueOnce(delayed.promise);
  const view = render(<PublicCourseCatalogScreen schoolId="nthu" initialQuery="AES" initialFilters={{ weekday: 1, credits: 3 }} />);
  await waitFor(() => expect(fetchSource).toHaveBeenCalledTimes(1));
  if (change === 'weekday') fireEvent.press(view.getByRole('button', { name: '星期四' }));
  else if (change === 'credits') fireEvent.changeText(view.getByLabelText('課程學分'), '0.5');
  else if (change === 'keyword') fireEvent.changeText(view.getByLabelText('搜尋清大課程'), '資料庫');
  else fireEvent.press(view.getByText('清除星期與學分'));
  expect(fetchSource.mock.calls[0][1].signal.aborted).toBe(true);
  expect(fetchSource).toHaveBeenCalledTimes(1);
  await act(async () => delayed.resolve(response(catalog({ weekday: 1, credits: 3 }))));
  expect(view.queryByText('分析化學專題')).toBeNull();
  expect(view.queryByText(/本次查詢條件：/)).toBeNull();
  expect(view.queryByText(/正在查詢/)).toBeNull();
  expect(AsyncStorage.setItem).not.toHaveBeenCalled();
});

test('a late response body from the old filters cannot replace a newer successful search', async () => {
  const delayed = deferred<string>();
  const oldBody = jest.fn(() => delayed.promise);
  fetchSource.mockResolvedValueOnce({ ...response(), text: oldBody })
    .mockResolvedValueOnce(response(catalog({ weekday: 4, credits: 3 }, { courses: [{ ...course, title: '新條件課程' }] })));
  const view = render(<PublicCourseCatalogScreen schoolId="nthu" initialQuery="AES" initialFilters={{ weekday: 1, credits: 3 }} />);
  await waitFor(() => expect(oldBody).toHaveBeenCalledTimes(1));
  fireEvent.press(view.getByRole('button', { name: '星期四' }));
  fireEvent.press(view.getByText('查詢課程'));
  await view.findByText('新條件課程');
  expect(fetchSource.mock.calls[0][1].signal.aborted).toBe(true);
  await act(async () => delayed.resolve(JSON.stringify(catalog({ weekday: 1, credits: 3 }))));
  expect(view.getByText('新條件課程')).toBeTruthy();
  expect(view.queryByText('分析化學專題')).toBeNull();
  expect(view.getByText('本次查詢條件：星期四有課 · 3 學分')).toBeTruthy();
});

test('timeout retry preserves both filters and the original query', async () => {
  jest.useFakeTimers();
  try {
    fetchSource.mockReturnValueOnce(new Promise(() => {})).mockResolvedValueOnce(response(catalog({ weekday: 1, credits: 3 })));
    const view = render(<PublicCourseCatalogScreen schoolId="nthu" initialQuery="AES" initialFilters={{ weekday: 1, credits: 3 }} />);
    await act(async () => jest.advanceTimersByTime(25_000));
    expect(view.getByText('暫時無法讀取清大課程，請重試或查看官方課程目錄。')).toBeTruthy();
    expect(view.getByText('本次查詢條件：星期一有課 · 3 學分')).toBeTruthy();
    expect(fetchSource.mock.calls[0][1].signal.aborted).toBe(true);
    await act(async () => fireEvent.press(view.getByText('重新查詢')));
    expect(view.getByText('分析化學專題')).toBeTruthy();
    expect(query(1)).toEqual(query(0));
    view.unmount();
  } finally { jest.useRealTimers(); }
});

test.each(['v1', 'missing-filters', 'different-filters', 'wrong-course', 'different-url'])('an unverifiable filtered response fails closed before rendering import controls: %s', async (kind) => {
  const filters = { weekday: 1, credits: 3 };
  const data = kind === 'v1' ? catalog() : catalog(filters,
    kind === 'missing-filters' ? { filters: undefined } :
      kind === 'different-filters' ? { filters: { weekday: 4, credits: 3 } } :
        kind === 'wrong-course' ? { courses: [{ ...course, credits: '4' }] } : {});
  const body = jest.fn(async () => JSON.stringify(data));
  fetchSource.mockResolvedValue({ ...response(data, kind === 'different-url'
    ? 'https://nuni.tw/api/public-course-catalog?schoolId=nthu&q=AES&weekday=4&credits=3' : undefined), text: body });
  const view = render(<PublicCourseCatalogScreen schoolId="nthu" initialQuery="AES" initialFilters={filters} />);
  expect(await view.findByText('暫時無法讀取清大課程，請重試或查看官方課程目錄。')).toBeTruthy();
  expect(view.queryByText('分析化學專題')).toBeNull();
  expect(view.queryByText('核對並加入課表')).toBeNull();
  if (kind === 'different-url') expect(body).not.toHaveBeenCalled();
});

test('the real native Request keeps filters and never adds an unsupported cache-busting query', async () => {
  const { Request: NativeRequest } = jest.requireActual('whatwg-fetch') as {
    Request: new (url: string, init?: RequestInit) => Request;
  };
  let request: Request | undefined;
  fetchSource.mockImplementation(async (url: string, options: RequestInit) => {
    request = new NativeRequest(url, options);
    return response(catalog({ weekday: 1, credits: 3 }), request.url);
  });
  const view = render(<PublicCourseCatalogScreen schoolId="nthu" initialQuery="AES" initialFilters={{ weekday: 1, credits: 3 }} />);
  await view.findByText('分析化學專題');
  expect(Object.fromEntries(new URL(request!.url).searchParams)).toEqual({ schoolId: 'nthu', q: 'AES', weekday: '1', credits: '3' });
  expect(request!.credentials).toBe('omit');
  expect(fetchSource.mock.calls[0][1]).not.toHaveProperty('cache');
});
