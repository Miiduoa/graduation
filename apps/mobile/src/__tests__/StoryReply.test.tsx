import React from 'react';
import { Pressable, Text } from 'react-native';
import { act, fireEvent, render } from '@testing-library/react-native';
import { CampusStoryViewer, useCampusStories } from '../screens/social/CampusStoryViewer';
import type { CampusStoryDoc } from '../services/stories';

const mockNavigate = jest.fn();
jest.mock('../screens/social/CampusSocialNavContext', () => ({
  useCampusSocialStackNav: () => ({ navigate: mockNavigate }),
}));
let mockAuthUid: string | null = 'alice';
let mockDemo = false;
let mockSerial = 0;
const mockSend = jest.fn();
jest.mock('expo-crypto', () => ({
  randomUUID: () => `00000000-0000-4000-8000-00000000000${++mockSerial}`,
}));
jest.mock('../firebase', () => ({
  isFirebaseMockMode: () => mockDemo,
  getFunctionsInstance: () => 'functions',
  getAuthInstance: () => ({ currentUser: { uid: mockAuthUid } }),
}));
jest.mock('firebase/functions', () => ({
  httpsCallable: (_functions: unknown, name: string) => {
    if (name !== 'replyToCampusStory') throw new Error('Unexpected callable');
    return mockSend;
  },
}));
jest.mock('../services/stories', () => ({
  ...jest.requireActual('../services/stories'),
  markStoryViewed: jest.fn(async () => {}),
}));
jest.mock('expo-av', () => ({
  Video: jest.requireActual('react-native').View,
  ResizeMode: { CONTAIN: 'contain' },
}));
jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));

const story: CampusStoryDoc = {
  id: 's1',
  schoolId: 'pu',
  authorUid: 'bob',
  kind: 'text',
  text: '球場集合',
  allowReplies: true,
};
function Shelf({ uid = 'alice', rows }: { uid?: string; rows: CampusStoryDoc[] }) {
  const deck = useCampusStories(rows, 'pu', uid);
  return (
    <>
      {deck.groups.map((g) => (
        <Pressable key={g.authorUid} onPress={() => deck.openGroup(g)}>
          <Text>開啟{g.authorUid}</Text>
        </Pressable>
      ))}
      <CampusStoryViewer deck={deck} names={{ bob: '小柏' }} />
    </>
  );
}

beforeEach(() => {
  mockDemo = false;
  mockAuthUid = 'alice';
  mockSerial = 0;
  mockSend.mockReset();
  mockNavigate.mockReset();
});
afterEach(() => jest.useRealTimers());

test('reply pauses the remaining countdown; a missing receipt retains the draft and retries the same ID', async () => {
  jest.useFakeTimers();
  const rows = [{ ...story, expiresAt: Date.now() + 120000 }];
  const view = render(<Shelf rows={rows} />);
  fireEvent.press(view.getByText('開啟bob'));
  fireEvent.press(view.getByLabelText('自動播放'));
  act(() => jest.advanceTimersByTime(2500));
  fireEvent.press(view.getByLabelText('私訊回覆給小柏'));
  act(() => jest.advanceTimersByTime(10000));
  const input = view.getByLabelText('私訊回覆內容');
  fireEvent.changeText(input, '   ');
  fireEvent.press(view.getByText('傳送私訊'));
  expect(mockSend).not.toHaveBeenCalled();
  fireEvent.changeText(input, ' 我也會到！ ');
  mockSend.mockResolvedValueOnce({ data: { conversationId: 'dm_pu_alice_bob' } });
  await act(async () => fireEvent.press(view.getByText('傳送私訊')));
  expect(view.getByDisplayValue(' 我也會到！ ')).toBeTruthy();
  mockSend.mockResolvedValueOnce({ data: { conversationId: 'dm_pu_alice_bob', messageId: 'm1' } });
  await act(async () => fireEvent.press(view.getByText('再試一次')));
  expect(mockSend.mock.calls[0]).toEqual([
    {
      viewerUid: 'alice',
      schoolId: 'pu',
      storyId: 's1',
      authorUid: 'bob',
      content: '我也會到！',
      replyId: expect.stringMatching(/^[a-zA-Z0-9_-]{20,64}$/),
    },
  ]);
  expect(mockSend.mock.calls[1]).toEqual(mockSend.mock.calls[0]);
  expect(view.getByText('已送出 · 查看私訊')).toBeTruthy();
  act(() => jest.advanceTimersByTime(4499));
  expect(view.getByText('球場集合')).toBeTruthy();
  act(() => jest.advanceTimersByTime(1));
  expect(view.queryByText('球場集合')).toBeNull();
  view.unmount();
  jest.useRealTimers();
});

test('a native video stays paused while composing and a stale completion cannot affect a new account', async () => {
  const rows = [
    {
      ...story,
      kind: 'video' as const,
      mediaUrl: 'https://example.com/v.mp4',
      expiresAt: Date.now() + 120000,
    },
  ];
  const view = render(<Shelf rows={rows} />);
  fireEvent.press(view.getByText('開啟bob'));
  fireEvent.press(view.getByLabelText('播放影片'));
  const player = view.getByLabelText('限時動態影片');
  const end = player.props.onPlaybackStatusUpdate;
  fireEvent.press(view.getByText('私訊回覆'));
  expect(player.props.shouldPlay).toBe(false);
  act(() => end({ isLoaded: true, didJustFinish: true }));
  fireEvent.press(view.getByLabelText('返回限時動態'));
  expect(view.getByLabelText('限時動態影片')).toBe(player);
  expect(player.props.shouldPlay).toBe(true);
  fireEvent.press(view.getByText('私訊回覆'));
  fireEvent.changeText(view.getByLabelText('私訊回覆內容'), '只給小柏');
  let finish!: (data: unknown) => void;
  mockSend.mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const submit = view.getByText('傳送私訊');
  act(() => {
    fireEvent.press(submit);
    fireEvent.press(submit);
  });
  expect(mockSend).toHaveBeenCalledTimes(1);
  mockAuthUid = 'carol';
  view.rerender(<Shelf rows={rows} uid="carol" />);
  await act(async () => finish({ data: { conversationId: 'x', messageId: 'y' } }));
  expect(view.queryByText('已送出 · 查看私訊')).toBeNull();
  expect(view.queryByDisplayValue('只給小柏')).toBeNull();
  fireEvent.press(view.getByText('私訊回覆'));
  expect(view.getByLabelText('私訊回覆內容').props.value).toBe('');
});

test.each([
  ['owner', 'bob', false],
  ['demo profile', 'demo_student', false],
  ['mock backend', 'alice', true],
])('%s does not offer sending', (_label, uid, demo) => {
  mockDemo = demo as boolean;
  const view = render(
    <Shelf rows={[{ ...story, expiresAt: Date.now() + 120000 }]} uid={uid as string} />,
  );
  fireEvent.press(view.getByText('開啟bob'));
  expect(view.queryByText('私訊回覆')).toBeNull();
  expect(mockSend).not.toHaveBeenCalled();
});

test.each([undefined, false])('a story with allowReplies=%s has no reply entry', (allowReplies) => {
  const view = render(
    <Shelf rows={[{ ...story, allowReplies, expiresAt: Date.now() + 120000 }]} />,
  );
  fireEvent.press(view.getByText('開啟bob'));
  expect(view.queryByText('私訊回覆')).toBeNull();
});

test('opens the confirmed private conversation, never a receipt for a different thread', async () => {
  const view = render(<Shelf rows={[{ ...story, expiresAt: Date.now() + 120000 }]} />);
  fireEvent.press(view.getByText('開啟bob'));
  fireEvent.press(view.getByText('私訊回覆'));
  fireEvent.changeText(view.getByLabelText('私訊回覆內容'), '等我一下');
  mockSend.mockResolvedValueOnce({
    data: { conversationId: 'dm_pu_bob_carol', messageId: 'wrong' },
  });
  await act(async () => fireEvent.press(view.getByText('傳送私訊')));
  expect(view.queryByText('已送出 · 查看私訊')).toBeNull();
  mockSend.mockResolvedValueOnce({ data: { conversationId: 'dm_pu_alice_bob', messageId: 'm1' } });
  await act(async () => fireEvent.press(view.getByText('再試一次')));
  fireEvent.press(view.getByLabelText('已送出私訊，查看對話'));
  expect(mockNavigate).toHaveBeenCalledWith('訊息', {
    screen: 'Chat',
    params: { peerId: 'bob', conversationId: 'dm_pu_alice_bob' },
  });
  expect(view.queryByText('球場集合')).toBeNull();
});
