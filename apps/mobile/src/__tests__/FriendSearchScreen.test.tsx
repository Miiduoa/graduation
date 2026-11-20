import React from 'react';
import { act, fireEvent, render } from '@testing-library/react-native';
import { FriendSearchScreen } from '../screens/FriendSearchScreen';
import { searchSchoolDirectoryByDisplayNamePrefix } from '../services/memberDirectory';

let mockUser: { uid: string } | null = { uid: 'alice' };
let mockSchoolId = 'pu';
let mockAuthLoading = false;
const navigation = { setOptions: jest.fn(), navigate: jest.fn() };
jest.mock('../state/auth', () => ({ useAuth: () => ({ user: mockUser, loading: mockAuthLoading }) }));
jest.mock('../state/school', () => ({ useSchool: () => ({ school: { id: mockSchoolId } }) }));
jest.mock('../firebase', () => ({ isFirebaseMockMode: () => false }));
jest.mock('../services/memberDirectory', () => ({
  searchSchoolDirectoryByDisplayNamePrefix: jest.fn(),
}));
jest.mock('../services/friends', () => ({ getFriendshipBetween: jest.fn(async () => null) }));
jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));
jest.mock('../ui/components', () => ({
  Screen: ({ children }: { children: React.ReactNode }) => children,
}));
jest.mock('../components/PeerFollowButton', () => ({ PeerFollowButton: () => null }));
jest.mock('../components/RelationshipButtons', () => ({
  RelationshipButtons: ({ profileUid }: { profileUid: string }) => {
    const { Text } = require('react-native');
    return <Text>{`invite:${profileUid}`}</Text>;
  },
}));

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
const member = (uid: string, displayName: string) => ({ uid, displayName, isDiscoverable: true });
const search = searchSchoolDirectoryByDisplayNamePrefix as jest.MockedFunction<
  typeof searchSchoolDirectoryByDisplayNamePrefix
>;

beforeEach(() => {
  jest.clearAllMocks();
  mockUser = { uid: 'alice' };
  mockSchoolId = 'pu';
  mockAuthLoading = false;
  search.mockResolvedValue([]);
});

async function enter(view: ReturnType<typeof render>, value: string) {
  fireEvent.changeText(view.getByLabelText('搜尋同校成員'), value);
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 400));
  });
}

test('failed searches retain the query, show retry, and do not claim an empty result', async () => {
  search.mockRejectedValueOnce(Object.assign(new Error('offline'), { code: 'unavailable' }));
  const view = render(<FriendSearchScreen navigation={navigation} />);
  await enter(view, '小林');
  expect(view.getByDisplayValue('小林')).toBeTruthy();
  expect(view.getByText('暫時無法搜尋。請確認網路後再試，輸入的內容仍保留。')).toBeTruthy();
  expect(view.queryByText(/找不到符合的成員/)).toBeNull();
  search.mockResolvedValueOnce([member('lin', '小林同學')]);
  await act(async () => {
    fireEvent.press(view.getByText('重新搜尋'));
  });
  expect(view.getByText('小林同學')).toBeTruthy();
  expect(search).toHaveBeenCalledTimes(2);
  expect(view.queryByText(/Firestore|displayName|directory/)).toBeNull();
});

test('permission failure explains school access instead of saying nobody matched', async () => {
  search.mockRejectedValueOnce(Object.assign(new Error('denied'), { code: 'permission-denied' }));
  const view = render(<FriendSearchScreen navigation={navigation} />);
  await enter(view, '小林');
  expect(
    view.getByText('目前無法查詢這所學校的成員。請確認登入狀態與學校資格後再試。'),
  ).toBeTruthy();
  expect(view.queryByText(/找不到符合的成員/)).toBeNull();
});

test('an older search cannot replace newer results or expose stale invitation controls', async () => {
  const first = deferred<ReturnType<typeof member>[]>();
  const second = deferred<ReturnType<typeof member>[]>();
  search.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
  const view = render(<FriendSearchScreen navigation={navigation} />);
  await enter(view, '小林');
  await enter(view, '小陳');
  await act(async () => {
    second.resolve([member('chen', '小陳同學')]);
  });
  expect(view.getByText('invite:chen')).toBeTruthy();
  await act(async () => {
    first.resolve([member('lin', '小林同學')]);
  });
  expect(view.queryByText('小林同學')).toBeNull();
  expect(view.queryByText('invite:lin')).toBeNull();
  expect(view.getByText('小陳同學')).toBeTruthy();
});

test('changing or clearing the input hides existing results before debounce finishes', async () => {
  search.mockResolvedValueOnce([member('lin', '小林同學')]);
  const view = render(<FriendSearchScreen navigation={navigation} />);
  await enter(view, '小林');
  expect(view.getByText('invite:lin')).toBeTruthy();
  fireEvent.changeText(view.getByLabelText('搜尋同校成員'), '小陳');
  expect(view.queryByText('invite:lin')).toBeNull();
  fireEvent.press(view.getByLabelText('清除搜尋'));
  expect(view.queryByText('小林同學')).toBeNull();
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 400));
  });
  expect(view.getByText('輸入名字開頭或帳號 ID，尋找想加的朋友。')).toBeTruthy();
});

test.each(['school', 'account', 'logout'])(
  'a %s change discards pending search results',
  async (change) => {
    const pending = deferred<ReturnType<typeof member>[]>();
    search.mockReturnValueOnce(pending.promise);
    const view = render(<FriendSearchScreen navigation={navigation} />);
    await enter(view, '小林');
    if (change === 'school') mockSchoolId = 'other';
    if (change === 'account') mockUser = { uid: 'bob' };
    if (change === 'logout') mockUser = null;
    view.rerender(<FriendSearchScreen navigation={navigation} />);
    await act(async () => {
      pending.resolve([member('lin', '小林同學')]);
    });
    expect(view.queryByText('小林同學')).toBeNull();
    expect(view.queryByText('invite:lin')).toBeNull();
    expect(view.queryByDisplayValue('小林')).toBeNull();
  },
);

test('visitors never start member or relationship reads', async () => {
  mockUser = null;
  render(
    <FriendSearchScreen
      navigation={navigation}
      route={{ params: { presetUid: 'shared_member_123456789' } }}
    />,
  );
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 400));
  });
  expect(search).not.toHaveBeenCalled();
});

test('revalidating the same account removes search results until login is confirmed', async () => {
  search.mockResolvedValueOnce([member('lin', '小林同學')]);
  const view = render(<FriendSearchScreen navigation={navigation} />);
  await enter(view, '小林');
  expect(view.getByText('invite:lin')).toBeTruthy();
  mockAuthLoading = true;
  view.rerender(<FriendSearchScreen navigation={navigation} />);
  expect(view.getByText('正在確認登入狀態…')).toBeTruthy();
  expect(view.queryByText('invite:lin')).toBeNull();
  mockAuthLoading = false;
  view.rerender(<FriendSearchScreen navigation={navigation} />);
  expect(view.queryByText('invite:lin')).toBeNull();
  expect(view.queryByDisplayValue('小林')).toBeNull();
});
