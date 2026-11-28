import React from 'react';
import { FlatList, Modal } from 'react-native';
import { act, fireEvent, render, within } from '@testing-library/react-native';
import { webBrowserOpenWithPuTronClassGate } from '../services/tronClassWebUiGate';
import { PuWebView } from '../ui/PuWebView';
import LibraryCatalogScreen from '../screens/LibraryCatalogScreen';
import {
  fetchOpacBookDetail,
  searchOpacBiblios,
  type OpacSearchResult,
} from '../services/libraryOpacSearchClient';

let mockSchool = { id: 'pu', name: '靜宜大學' };

jest.mock('../state/school', () => ({
  useSchool: () => ({
    school: mockSchool,
    selectionReady: true,
    selection: { schoolId: mockSchool.id },
  }),
}));
jest.mock('../services/tronClassWebUiGate', () => ({
  webBrowserOpenWithPuTronClassGate: jest.fn(),
}));
jest.mock('../services/analytics', () => ({ analytics: { logScreenView: jest.fn() } }));
jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));
jest.mock('../services/libraryOpacClient', () => ({
  ...jest.requireActual('../services/libraryOpacClient'),
  validateLibraryOpacReachable: jest.fn(async () => ({ ok: true })),
}));
jest.mock('../services/libraryOpacSearchClient', () => ({
  ...jest.requireActual('../services/libraryOpacSearchClient'),
  searchOpacBiblios: jest.fn(),
  fetchOpacBookDetail: jest.fn(),
}));
jest.mock('../hooks/useReducedMotion', () => ({ useReducedMotion: () => true }));

const mockSearch = jest.mocked(searchOpacBiblios);

function pendingSearch() {
  let resolve!: (result: OpacSearchResult) => void;
  const promise = new Promise<OpacSearchResult>((done) => {
    resolve = done;
  });
  mockSearch.mockReturnValueOnce(promise);
  return resolve;
}

function result(title: string): OpacSearchResult {
  return { source: 'live', hits: [{ sid: title, title, author: '', publisher: '', year: '' }] };
}

beforeEach(() => {
  mockSearch.mockReset();
  mockSchool = { id: 'pu', name: '靜宜大學' };
});

test('the submitted library search opens directly with results and a way back', async () => {
  const finish = pendingSearch();
  const goBack = jest.fn();
  const view = render(
    <LibraryCatalogScreen
      navigation={{ goBack, canGoBack: () => true }}
      route={{ params: { initialQuery: ' 互動設計 ', autoSearch: true } }}
    />,
  );
  const input = view.getByLabelText('館藏關鍵字');
  expect(view.getByText('正在查詢全文「互動設計」…')).toBeTruthy();
  fireEvent(input, 'submitEditing');
  expect(mockSearch).toHaveBeenCalledTimes(1);
  expect(mockSearch).toHaveBeenCalledWith('互動設計', 'FullText', { signal: expect.anything() });
  await act(async () => finish(result('日常的互動設計')));
  expect(view.getByText('日常的互動設計')).toBeTruthy();
  fireEvent.changeText(input, '下一本');
  expect(view.getByLabelText('館藏關鍵字')).toBe(input);
  expect(within(view.UNSAFE_getByType(FlatList)).getByText('日常的互動設計')).toBeTruthy();
  expect(view.getByRole('header', { name: '全文「互動設計」 · 顯示 1 筆' })).toBeTruthy();
  expect(mockSearch).toHaveBeenCalledTimes(1);
  fireEvent.press(view.getByRole('button', { name: '返回' }));
  expect(goBack).toHaveBeenCalledTimes(1);
});

test('plain prefilled links wait for submit and an older response cannot replace a new field search', async () => {
  const finishFirst = pendingSearch();
  const finishSecond = pendingSearch();
  const view = render(<LibraryCatalogScreen route={{ params: { initialQuery: '李明' } }} />);
  const input = view.getByLabelText('館藏關鍵字');
  expect(input.props.value).toBe('李明');
  expect(mockSearch).not.toHaveBeenCalled();
  fireEvent.press(view.getByRole('button', { name: '查詢館藏' }));
  const firstSignal = mockSearch.mock.calls[0][2]?.signal;
  fireEvent.press(view.getByRole('button', { name: '作者' }));
  expect(view.getByRole('button', { name: '作者', selected: true })).toBeTruthy();
  fireEvent(input, 'submitEditing');
  expect(firstSignal?.aborted).toBe(true);
  expect(mockSearch).toHaveBeenLastCalledWith('李明', 'Author', { signal: expect.anything() });
  await act(async () => finishSecond(result('李明作品集')));
  await act(async () => finishFirst({ hits: [], source: 'live', error: 'HTTP 503' }));
  expect(view.getByText('作者「李明」 · 顯示 1 筆')).toBeTruthy();
  expect(view.getByText('李明作品集')).toBeTruthy();
  expect(view.queryByText(/官方頁面繼續查詢/)).toBeNull();
});

test('changing schools cancels the active request and discards the submitted query on return', async () => {
  const finish = pendingSearch();
  const route = { params: { initialQuery: '原校研究', autoSearch: true } };
  const view = render(<LibraryCatalogScreen route={route} />);
  const signal = mockSearch.mock.calls[0][2]?.signal;
  mockSchool = { id: 'nthu', name: '國立清華大學' };
  view.rerender(<LibraryCatalogScreen route={route} />);
  expect(signal?.aborted).toBe(true);
  await act(async () => finish(result('原校結果')));
  expect(view.queryByText('原校結果')).toBeNull();
  mockSchool = { id: 'pu', name: '靜宜大學' };
  view.rerender(<LibraryCatalogScreen route={route} />);
  expect(view.getByLabelText('館藏關鍵字').props.value).toBe('');
  expect(view.getByRole('button', { name: '查詢館藏', disabled: true })).toBeTruthy();
  expect(mockSearch).toHaveBeenCalledTimes(1);
});

test('recovery opens the official page for the failed search, even when the input has a new draft', async () => {
  mockSearch.mockRejectedValueOnce(new Error('offline'));
  const view = render(
    <LibraryCatalogScreen route={{ params: { initialQuery: '舊查詢', autoSearch: true } }} />,
  );
  expect(await view.findByText('館藏查詢暫時無法連線，請再試一次。')).toBeTruthy();
  fireEvent.changeText(view.getByLabelText('館藏關鍵字'), '尚未送出');
  fireEvent.press(view.getByRole('link', { name: '在瀏覽器查看' }));
  const target = new URL(jest.mocked(webBrowserOpenWithPuTronClassGate).mock.lastCall![0]);
  expect(target.hostname).toBe('webpacx.lib.pu.edu.tw');
  expect(target.searchParams.get('searchInput')).toBe('舊查詢');
});

test('book details respect reduced motion and close back to the same search results', async () => {
  const results = result('設計與生活');
  mockSearch.mockResolvedValueOnce(results);
  jest.mocked(fetchOpacBookDetail).mockResolvedValueOnce({ ...results.hits[0], fields: [] });
  const view = render(
    <LibraryCatalogScreen route={{ params: { initialQuery: '設計', autoSearch: true } }} />,
  );
  fireEvent.press(await view.findByText('更多資料'));
  await act(async () => {});
  expect(view.UNSAFE_getByType(Modal).props.animationType).toBe('none');
  fireEvent.press(view.getByRole('button', { name: '關閉館藏書目' }));
  expect(view.getByText('全文「設計」 · 顯示 1 筆')).toBeTruthy();
  expect(view.getByText('設計與生活')).toBeTruthy();
  expect(mockSearch).toHaveBeenCalledTimes(1);
});

test('in a short viewport the recovery notice, controls and bounded official site share the results scroll area', async () => {
  mockSearch.mockResolvedValueOnce({ source: 'live', hits: [], error: 'HTTP 503' });
  const view = render(
    <LibraryCatalogScreen route={{ params: { initialQuery: '人機互動', autoSearch: true } }} />,
  );
  const list = view.UNSAFE_getByType(FlatList);
  const scrollContent = within(list);
  expect(await scrollContent.findByText(/圖書館官方頁面繼續查詢/)).toBeTruthy();
  expect(scrollContent.getByLabelText('館藏關鍵字')).toBeTruthy();
  expect(scrollContent.getByRole('link', { name: '在瀏覽器查看' })).toBeTruthy();
  fireEvent(list, 'layout', { nativeEvent: { layout: { x: 0, y: 0, width: 320, height: 200 } } });
  const web = scrollContent.UNSAFE_getByType(PuWebView);
  expect(web.props.nestedScrollEnabled).toBe(true);
  expect(web.parent).toHaveStyle({ height: 150 });
});
