import React from 'react';
import { AppState, Pressable, Text, View } from 'react-native';
import { act, fireEvent, render } from '@testing-library/react-native';
import { CampusStoryViewer, useCampusStories } from '../screens/social/CampusStoryViewer';
import { listStoryViewers, markStoryViewed, type CampusStoryDoc } from '../services/stories';

jest.mock('../firebase', () => ({ isFirebaseMockMode: () => false }));
jest.mock('../services/stories', () => ({
  ...jest.requireActual('../services/stories'),
  markStoryViewed: jest.fn(),
  listStoryViewers: jest.fn(),
}));
jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));
jest.mock('expo-av', () => ({
  Video: jest.requireActual('react-native').View,
  ResizeMode: { CONTAIN: 'contain' },
}));

function Shelf({ uid, rows }: { uid: string; rows: CampusStoryDoc[] }) {
  const deck = useCampusStories(rows, 'pu', uid);
  return (
    <>
      {deck.groups.map((group) => (
        <Pressable key={group.authorUid} onPress={() => deck.openGroup(group)}>
          <Text>開啟{group.authorUid}</Text>
        </Pressable>
      ))}
      <CampusStoryViewer deck={deck} names={{ bob: '小柏' }} />
    </>
  );
}
const load = jest.mocked(listStoryViewers);
const record = jest.mocked(markStoryViewed);
const power = {
  id: 'rain',
  authorUid: 'alice',
  schoolId: 'pu',
  kind: 'text' as const,
  text: '體育館停電',
};
type Page = Awaited<ReturnType<typeof listStoryViewers>>;
function shelf(uid = 'alice', authorUid = 'alice') {
  return (
    <View>
      <Shelf
        key={uid}
        uid={uid}
        rows={[{ ...power, authorUid, expiresAt: Date.now() + 120_000 }]}
      />
    </View>
  );
}

beforeEach(() => {
  load.mockReset();
  record.mockReset().mockResolvedValue(undefined);
});

test('only the author can inspect viewers; the list pauses autoplay and back returns to the same story', async () => {
  jest.useFakeTimers();
  const view = render(shelf());
  load.mockResolvedValue({ viewers: [], nextCursor: null });
  fireEvent.press(view.getByText('開啟alice'));
  expect(record).not.toHaveBeenCalled();
  expect(load).not.toHaveBeenCalled();
  fireEvent.press(view.getByLabelText('自動播放'));
  act(() => jest.advanceTimersByTime(3000));
  await act(async () => fireEvent.press(view.getByText('誰看過')));
  expect(load).toHaveBeenCalledWith({ id: 'rain', schoolId: 'pu', authorUid: 'alice' }, null);
  expect(view.getByText('目前還沒有觀看紀錄')).toBeTruthy();
  act(() => jest.advanceTimersByTime(8000));
  fireEvent.press(view.getByLabelText('返回限時動態'));
  expect(view.getByText('體育館停電')).toBeTruthy();
  expect(view.getByLabelText('暫停播放')).toBeTruthy();
  act(() => jest.advanceTimersByTime(3999));
  expect(view.getByText('體育館停電')).toBeTruthy();
  act(() => jest.advanceTimersByTime(1));
  expect(view.queryByText('體育館停電')).toBeNull();
  jest.useRealTimers();
  view.rerender(shelf('bob'));
  fireEvent.press(view.getByText('開啟alice'));
  expect(view.queryByText('誰看過')).toBeNull();
  expect(view.getByText('作者可查看誰看過')).toBeTruthy();
  expect(load).toHaveBeenCalledTimes(1);
  expect(record).toHaveBeenCalledWith({ id: 'rain', schoolId: 'pu', authorUid: 'alice' }, 'bob');
});

test('a failed receipt retries only on an explicit reopening', async () => {
  const view = render(shelf('bob'));
  record.mockRejectedValueOnce(new Error('offline'));
  await act(async () => fireEvent.press(view.getByText('開啟alice')));
  expect(record).toHaveBeenCalledTimes(1);
  fireEvent.press(view.getByLabelText('關閉限時動態'));
  await act(async () => fireEvent.press(view.getByText('開啟alice')));
  expect(record).toHaveBeenCalledTimes(2);
  fireEvent.press(view.getByLabelText('關閉限時動態'));
  fireEvent.press(view.getByText('開啟alice'));
  expect(record).toHaveBeenCalledTimes(2);
});

test('keeps the first page while retrying the next page and labels partial counts', async () => {
  const cursor = { id: 'last' } as NonNullable<Page['nextCursor']>;
  load
    .mockResolvedValueOnce({
      viewers: [{ uid: 'secret-id', displayName: '小安' }],
      nextCursor: cursor,
    })
    .mockRejectedValueOnce(new Error('offline'))
    .mockResolvedValueOnce({
      viewers: [{ uid: 'other-id', displayName: '同學' }],
      nextCursor: null,
    });
  const view = render(shelf());
  fireEvent.press(view.getByText('開啟alice'));
  await act(async () => fireEvent.press(view.getByText('誰看過')));
  expect(view.getByText('已顯示 1 位 · 最近觀看優先')).toBeTruthy();
  await act(async () => fireEvent.press(view.getByText('載入更多觀看者')));
  expect(view.getByText('小安')).toBeTruthy();
  expect(view.getByText('暫時無法載入觀看名單')).toBeTruthy();
  await act(async () => fireEvent.press(view.getByText('再試一次')));
  expect(load.mock.calls.map((args) => args[1])).toEqual([null, cursor, cursor]);
  expect(view.getByText('已顯示 2 位 · 最近觀看優先')).toBeTruthy();
  expect(view.getByText('同學')).toBeTruthy();
  expect(view.queryByText('other-id')).toBeNull();
  expect(view.queryByText('載入更多觀看者')).toBeNull();
});

test('clears previously loaded identities when access is denied', async () => {
  load
    .mockResolvedValueOnce({
      viewers: [{ uid: 'secret-id', displayName: '小安' }],
      nextCursor: { id: 'last' } as Page['nextCursor'],
    })
    .mockRejectedValueOnce(Object.assign(new Error('denied'), { code: 'permission-denied' }));
  const view = render(shelf());
  fireEvent.press(view.getByText('開啟alice'));
  await act(async () => fireEvent.press(view.getByText('誰看過')));
  await act(async () => fireEvent.press(view.getByText('載入更多觀看者')));
  expect(view.getByText('目前無法存取這則限時動態的觀看名單')).toBeTruthy();
  expect(view.queryByText('小安')).toBeNull();
  expect(view.queryByText('再試一次')).toBeNull();
});

test('ignores a response arriving after the owner switches account', async () => {
  let finish!: (value: Page) => void;
  load.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const view = render(shelf());
  fireEvent.press(view.getByText('開啟alice'));
  fireEvent.press(view.getByText('誰看過'));
  expect(view.getByText('正在載入觀看名單…')).toBeTruthy();
  view.rerender(shelf('bob'));
  fireEvent.press(view.getByText('開啟alice'));
  await act(async () =>
    finish({ viewers: [{ uid: 'secret-id', displayName: '小安' }], nextCursor: null }),
  );
  expect(view.queryByText('小安')).toBeNull();
  expect(view.getByText('體育館停電')).toBeTruthy();
});

test('checking a video audience pauses the same native player and ignores a queued end event', async () => {
  const clip = {
    ...power,
    kind: 'video' as const,
    mediaUrl: 'https://example.com/v.mp4',
    expiresAt: Date.now() + 60_000,
  };
  const view = render(<Shelf rows={[clip]} uid="alice" />);
  load.mockResolvedValue({ viewers: [], nextCursor: null });
  fireEvent.press(view.getByText('開啟alice'));
  fireEvent.press(view.getByLabelText('播放影片'));
  const player = view.getByLabelText('限時動態影片');
  fireEvent(player, 'readyForDisplay', { status: { isLoaded: true, durationMillis: 12_000 } });
  fireEvent(player, 'playbackStatusUpdate', {
    isLoaded: true,
    durationMillis: 12_000,
    positionMillis: 5000,
  });
  expect(view.getByText('5 / 12 秒')).toBeTruthy();
  const queued = player.props.onPlaybackStatusUpdate;
  await act(async () => fireEvent.press(view.getByText('誰看過')));
  expect(view.queryByLabelText('限時動態影片')).toBeNull();
  expect(player.props.shouldPlay).toBe(false);
  act(() => queued({ isLoaded: true, didJustFinish: true }));
  fireEvent.press(view.getByLabelText('返回限時動態'));
  expect(view.getByLabelText('限時動態影片')).toBe(player);
  expect(view.getByText('5 / 12 秒')).toBeTruthy();
  expect(player.props.shouldPlay).toBe(true);
  act(() => queued({ isLoaded: true, didJustFinish: true }));
  expect(view.getByText('5 / 12 秒')).toBeTruthy();
  fireEvent.press(view.getByLabelText('暫停播放'));
  await act(async () => fireEvent.press(view.getByText('誰看過')));
  fireEvent.press(view.getByLabelText('返回限時動態'));
  expect(player.props.shouldPlay).toBe(false);
  expect(view.getByText('5 / 12 秒')).toBeTruthy();
  fireEvent.press(view.getByLabelText('播放影片'));
  await act(async () => fireEvent.press(view.getByText('誰看過')));
  const subscription = jest.mocked(AppState.addEventListener).mock.calls.at(-1)![1];
  act(() => subscription('background'));
  fireEvent.press(view.getByLabelText('返回限時動態'));
  expect(player.props.shouldPlay).toBe(false);
});
