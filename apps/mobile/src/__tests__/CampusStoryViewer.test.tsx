import React from 'react';
import { AppState, Pressable, Text } from 'react-native';
import { act, fireEvent, render } from '@testing-library/react-native';
import { CampusStoryViewer, useCampusStories } from '../screens/social/CampusStoryViewer';
import type { CampusStoryDoc } from '../services/stories';

jest.mock('../firebase', () => ({ isFirebaseMockMode: () => false }));
jest.mock('../services/stories', () => ({
  ...jest.requireActual('../services/stories'),
  markStoryViewed: jest.fn(async () => {}),
}));
jest.mock('expo-av', () => ({
  Video: jest.requireActual('react-native').View,
  ResizeMode: { CONTAIN: 'contain' },
}));
jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));

function Shelf({ rows }: { rows: CampusStoryDoc[] }) {
  const deck = useCampusStories(rows, 'pu', 'alice');
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
const common = { schoolId: 'pu', authorUid: 'bob', kind: 'text' as const };
describe('story playback clock', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });
  afterEach(() => {
    jest.useRealTimers();
  });

  test('removes the open story and its ring at the instant of expiry', () => {
    const view = render(
      <Shelf rows={[{ ...common, id: 'a', text: '即將結束', expiresAt: Date.now() + 500 }]} />,
    );
    fireEvent.press(view.getByText('開啟bob'));
    act(() => jest.advanceTimersByTime(499));
    expect(view.getByText('即將結束')).toBeTruthy();
    act(() => jest.advanceTimersByTime(1));
    expect(view.queryByText('即將結束')).toBeNull();
    expect(view.queryByText('開啟bob')).toBeNull();
    view.unmount();
  });

  test('waits for the photo before autoplay and resumes the remaining time after pause', () => {
    const expiresAt = Date.now() + 90_000;
    const view = render(
      <Shelf
        rows={[
          {
            ...common,
            id: 'a',
            createdAt: 1,
            kind: 'image',
            text: '現場照片',
            mediaUrl: 'https://example.com/p.jpg',
            expiresAt,
          },
          { ...common, id: 'b', createdAt: 2, text: '集合時間', expiresAt },
        ]}
      />,
    );
    fireEvent.press(view.getByText('開啟bob'));
    fireEvent.press(view.getByLabelText('自動播放'));
    act(() => jest.advanceTimersByTime(8000));
    expect(view.getByText('現場照片')).toBeTruthy();
    fireEvent(view.getByLabelText('限時動態照片'), 'load');
    act(() => jest.advanceTimersByTime(3000));
    fireEvent.press(view.getByLabelText('暫停播放'));
    act(() => jest.advanceTimersByTime(8000));
    expect(view.getByText('現場照片')).toBeTruthy();
    fireEvent.press(view.getByLabelText('自動播放'));
    act(() => jest.advanceTimersByTime(4000));
    expect(view.getByText('集合時間')).toBeTruthy();
    view.unmount();
  });

  test('a failed photo pauses its countdown and can be retried without losing the story', () => {
    const expiresAt = Date.now() + 100_000;
    const view = render(
      <Shelf rows={[
        { ...common, id: 'photo', kind: 'image', createdAt: 1, mediaUrl: 'https://example.com/photo.jpg', expiresAt },
        { ...common, id: 'next', text: '下一則文字', createdAt: 2, expiresAt },
      ]} />,
    );
    fireEvent.press(view.getByText('開啟bob'));
    fireEvent.press(view.getByLabelText('自動播放'));
    fireEvent(view.getByLabelText('限時動態照片'), 'error');
    expect(view.getByText('照片暫時無法顯示')).toBeTruthy();
    act(() => jest.advanceTimersByTime(8_000));
    expect(view.queryByText('下一則文字')).toBeNull();
    fireEvent.press(view.getByLabelText('重新載入照片'));
    expect(view.getByLabelText('限時動態照片').props.source.uri).toBe('https://example.com/photo.jpg');
    fireEvent(view.getByLabelText('限時動態照片'), 'load');
    act(() => jest.advanceTimersByTime(8_000));
    expect(view.queryByText('下一則文字')).toBeNull();
    fireEvent.press(view.getByLabelText('自動播放'));
    act(() => jest.advanceTimersByTime(7_100));
    expect(view.getByText('下一則文字')).toBeTruthy();
    view.unmount();
  });

  test('a muted clip uses the native end event rather than the photo timer and keeps its caption', () => {
    const expiresAt = Date.now() + 100_000;
    const view = render(
      <Shelf
        rows={[
          {
            ...common,
            id: 'v',
            kind: 'video',
            createdAt: 1,
            mediaUrl: 'https://example.com/clip.mp4',
            text: '社團影片',
            expiresAt,
          },
          { ...common, id: 't', createdAt: 2, text: '下一則文字', expiresAt },
        ]}
      />,
    );
    fireEvent.press(view.getByText('開啟bob'));
    const player = () => view.getByLabelText('限時動態影片');
    expect(player().props.isMuted).toBe(true);
    expect(player().props.shouldPlay).toBe(false);
    fireEvent.press(view.getByLabelText('播放影片'));
    fireEvent.press(view.getByLabelText('開啟影片聲音'));
    expect(player().props.isMuted).toBe(false);
    act(() => jest.advanceTimersByTime(9000));
    expect(view.getByText('社團影片')).toBeTruthy();
    fireEvent.press(view.getByLabelText('暫停播放'));
    fireEvent(player(), 'playbackStatusUpdate', { isLoaded: true, didJustFinish: true });
    expect(view.getByText('社團影片')).toBeTruthy();
    fireEvent.press(view.getByLabelText('播放影片'));
    fireEvent(player(), 'playbackStatusUpdate', { isLoaded: true, didJustFinish: true });
    expect(view.getByText('下一則文字')).toBeTruthy();
    view.unmount();
  });

  test('backgrounding pauses the clip and a queued completion after dismissal cannot change selection', () => {
    const listener = jest.mocked(AppState.addEventListener);
    const view = render(
      <Shelf
        rows={[
          {
            ...common,
            id: 'clip',
            kind: 'video',
            mediaUrl: 'https://example.com/clip',
            expiresAt: Date.now() + 100_000,
          },
        ]}
      />,
    );
    fireEvent.press(view.getByText('開啟bob'));
    fireEvent.press(view.getByLabelText('播放影片'));
    const nativeEnd = view.getByLabelText('限時動態影片').props.onPlaybackStatusUpdate;
    const onBackground = listener.mock.calls[listener.mock.calls.length - 1]![1];
    act(() => onBackground('background'));
    expect(view.getByLabelText('限時動態影片').props.shouldPlay).toBe(false);
    fireEvent.press(view.getByLabelText('關閉限時動態'));
    act(() => nativeEnd({ isLoaded: true, didJustFinish: true }));
    expect(view.queryByLabelText('限時動態影片')).toBeNull();
    view.unmount();
  });

  test('a failed video retains navigation and can be loaded again muted', () => {
    const view = render(
      <Shelf
        rows={[
          {
            ...common,
            id: 'v',
            kind: 'video',
            mediaUrl: 'https://example.com/v',
            expiresAt: Date.now() + 100_000,
          },
        ]}
      />,
    );
    fireEvent.press(view.getByText('開啟bob'));
    fireEvent.press(view.getByLabelText('播放影片'));
    fireEvent(view.getByLabelText('限時動態影片'), 'error', 'decode');
    expect(view.getByText('影片暫時無法播放')).toBeTruthy();
    fireEvent.press(view.getByText('重新載入影片'));
    expect(view.getByLabelText('限時動態影片').props.shouldPlay).toBe(false);
    fireEvent.press(view.getByText('看完了'));
    expect(view.queryByLabelText('限時動態影片')).toBeNull();
    view.unmount();
  });
});
