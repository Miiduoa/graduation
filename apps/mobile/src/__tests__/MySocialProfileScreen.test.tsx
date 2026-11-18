import React from 'react';
import { act, fireEvent, render } from '@testing-library/react-native';
import MySocialProfileScreen from '../screens/MySocialProfileScreen';
import { loadOwnCampusPosts, type OwnPostPage } from '../services/myPosts';
import type { CampusPostDoc } from '../services/feed';

let mockFocused = true;
jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ goBack: jest.fn() }),
  useFocusEffect: (callback: () => void | (() => void)) => {
    require('react').useEffect(() => mockFocused ? callback() : undefined, [callback, mockFocused]);
  },
}));
jest.mock('../state/auth', () => ({
  useAuth: () => ({ user: { uid: 'author' }, profile: null }),
}));
jest.mock('../state/school', () => ({
  useSchool: () => ({ selectionReady: true, schoolId: 'school', school: { name: '校園' } }),
}));
jest.mock('../app/rootNavigation', () => ({ rootNavigateNested: jest.fn() }));
jest.mock('../services/myPosts', () => ({ loadOwnCampusPosts: jest.fn() }));
jest.mock('../ui/aiFirst', () => ({
  AIDetailScreen: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

const loadPosts = jest.mocked(loadOwnCampusPosts);
function page(titles: string[], hasMore = false): OwnPostPage {
  return {
    items: titles.map((title) => ({ id: title, title, content: title + '內容' } as CampusPostDoc)),
    cursor: hasMore ? {} as OwnPostPage['cursor'] : null,
    hasMore,
  };
}
function deferred() {
  let resolve!: (value: OwnPostPage) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<OwnPostPage>((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
}
async function flush() { await act(async () => {}); }

beforeEach(() => {
  mockFocused = true;
  loadPosts.mockReset();
});

const mutationCases: [string, string[], string[]][] = [
  ['新增', ['原貼文'], ['新貼文', '原貼文']],
  ['編輯', ['編輯前'], ['編輯後']],
  ['刪除', ['待刪除'], []],
];

it.each(mutationCases)('%s後返回仍掛載的作品頁會更新內容', async (_action, before, after) => {
  loadPosts.mockResolvedValueOnce(page(before)).mockResolvedValueOnce(page(after));
  const screen = render(<MySocialProfileScreen />);
  await flush();
  expect(screen.getByText(before[0])).toBeTruthy();
  mockFocused = false;
  screen.rerender(<MySocialProfileScreen />);
  expect(loadPosts).toHaveBeenCalledTimes(1);
  mockFocused = true;
  screen.rerender(<MySocialProfileScreen />);
  await flush();
  expect(loadPosts).toHaveBeenCalledTimes(2);
  expect(loadPosts).toHaveBeenLastCalledWith('school', 'author');
  for (const title of after) expect(screen.getByText(title)).toBeTruthy();
  for (const title of before.filter((title) => !after.includes(title))) {
    expect(screen.queryByText(title)).toBeNull();
  }
  if (!after.length) expect(screen.getByText('還沒有署名貼文')).toBeTruthy();
});

it.each(['resolve', 'reject'] as const)('忽略失焦前首頁請求的過期 %s 結果', async (settle) => {
  const stale = deferred();
  loadPosts.mockReturnValueOnce(stale.promise).mockResolvedValueOnce(page(['最新貼文']));
  const screen = render(<MySocialProfileScreen />);
  mockFocused = false;
  screen.rerender(<MySocialProfileScreen />);
  mockFocused = true;
  screen.rerender(<MySocialProfileScreen />);
  await flush();
  await act(async () => {
    if (settle === 'resolve') stale.resolve(page(['過期貼文']));
    else stale.reject(new Error('stale'));
  });
  expect(screen.getByText('最新貼文')).toBeTruthy();
  expect(screen.queryByText('過期貼文')).toBeNull();
  expect(screen.queryByText('暫時無法讀取這個校園的貼文。')).toBeNull();
});

it.each(['resolve', 'reject'] as const)('忽略過期分頁的 %s 結果，返回後可重新分頁', async (settle) => {
  const stale = deferred();
  loadPosts.mockResolvedValueOnce(page(['原貼文'], true))
    .mockReturnValueOnce(stale.promise)
    .mockResolvedValueOnce(page(['最新貼文'], true))
    .mockResolvedValueOnce(page(['更早貼文']));
  const screen = render(<MySocialProfileScreen />);
  await flush();
  fireEvent.press(screen.getByText('載入較早的貼文'));
  mockFocused = false;
  screen.rerender(<MySocialProfileScreen />);
  mockFocused = true;
  screen.rerender(<MySocialProfileScreen />);
  await flush();
  await act(async () => {
    if (settle === 'resolve') stale.resolve(page(['過期分頁']));
    else stale.reject(new Error('stale'));
  });
  expect(screen.getByText('最新貼文')).toBeTruthy();
  expect(screen.queryByText('過期分頁')).toBeNull();
  expect(screen.queryByRole('alert')).toBeNull();
  fireEvent.press(screen.getByText('載入較早的貼文'));
  await flush();
  expect(screen.getByText('更早貼文')).toBeTruthy();
});
