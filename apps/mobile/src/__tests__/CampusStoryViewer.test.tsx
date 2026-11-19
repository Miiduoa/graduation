import React from 'react';
import { AppState, Pressable, Text } from 'react-native';
import { act, fireEvent, render } from '@testing-library/react-native';
import { CampusStoryViewer, useCampusStories } from '../screens/social/CampusStoryViewer';
import { markStoryViewed, type CampusStoryDoc } from '../services/stories';

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
function ScopedShelf({
  rows,
  schoolId,
  uid,
}: {
  rows: CampusStoryDoc[];
  schoolId: string;
  uid: string;
}) {
  const deck = useCampusStories(rows, schoolId, uid);
  return (
    <>
      {deck.groups.map((group) => (
        <Pressable key={group.authorUid} onPress={() => deck.openGroup(group)}>
          <Text>開啟{group.authorUid}</Text>
        </Pressable>
      ))}
      <Text>{deck.seen.has('shared') ? '已讀' : '未讀'}</Text>
      <CampusStoryViewer deck={deck} names={{ bob: '小柏' }} />
    </>
  );
}

const common = { schoolId: 'pu', authorUid: 'bob', kind: 'text' as const };
describe('story playback clock', () => {
  test('does not carry story navigation or view markers to another campus or student', () => {
    jest.mocked(markStoryViewed).mockClear();
    const expiresAt = Date.now() + 100_000;
    const rows: CampusStoryDoc[] = [
      { ...common, id: 'shared', createdAt: 1, text: '甲校活動', expiresAt },
      { ...common, id: 'shared', schoolId: 'other', createdAt: 2, text: '乙校活動', expiresAt },
    ];
    const view = render(<ScopedShelf rows={rows} schoolId="pu" uid="alice" />);

    fireEvent.press(view.getByText('開啟bob'));
    expect(view.getByText('甲校活動')).toBeTruthy();
    expect(view.getByText('已讀')).toBeTruthy();

    // The new campus reuses the document ID, but must not inherit an open story.
    view.rerender(<ScopedShelf rows={rows} schoolId="other" uid="alice" />);
    expect(view.queryByText('甲校活動')).toBeNull();
    expect(view.queryByText('乙校活動')).toBeNull();
    expect(view.getByText('未讀')).toBeTruthy();
    fireEvent.press(view.getByText('開啟bob'));
    expect(view.getByText('乙校活動')).toBeTruthy();
    expect(view.getByText('已讀')).toBeTruthy();

    // Switching student at the same campus must likewise require a fresh open.
    view.rerender(<ScopedShelf rows={rows} schoolId="other" uid="charlie" />);
    expect(view.queryByText('乙校活動')).toBeNull();
    expect(view.getByText('未讀')).toBeTruthy();
    fireEvent.press(view.getByText('開啟bob'));
    expect(view.getByText('乙校活動')).toBeTruthy();
    expect(markStoryViewed).toHaveBeenCalledTimes(3);
    expect(jest.mocked(markStoryViewed).mock.calls.map((call) => [call[0].schoolId, call[1]])).toEqual([
      ['pu', 'alice'],
      ['other', 'alice'],
      ['other', 'charlie'],
    ]);
    view.unmount();
  });

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


  test('keeps a failed photo visible and retries it before resuming autoplay', () => {
    const expiresAt = Date.now() + 100_000;
    const view = render(
      <Shelf
        rows={[
          {
            ...common,
            id: 'photo',
            kind: 'image',
            createdAt: 1,
            mediaUrl: 'https://example.com/photo-fails-once.jpg',
            text: '社團活動照片',
            expiresAt,
          },
          { ...common, id: 'next', createdAt: 2, text: '下一則限時動態', expiresAt },
        ]}
      />,
    );

    fireEvent.press(view.getByText('開啟bob'));
    fireEvent.press(view.getByLabelText('自動播放'));
    fireEvent(view.getByLabelText('限時動態照片'), 'error');
    expect(view.getByText('照片暫時無法顯示')).toBeTruthy();
    expect(view.getByLabelText('重新載入照片')).toBeTruthy();

    // A failed image must not silently advance while the student is trying to recover.
    act(() => jest.advanceTimersByTime(10_000));
    expect(view.getByText('照片暫時無法顯示')).toBeTruthy();

    fireEvent.press(view.getByLabelText('重新載入照片'));
    const retry = view.getByLabelText('限時動態照片');
    expect(retry.props.source.uri).toBe('https://example.com/photo-fails-once.jpg');
    act(() => jest.advanceTimersByTime(8_000));
    expect(view.getByLabelText('限時動態照片')).toBeTruthy();
    fireEvent(retry, 'load');
    act(() => jest.advanceTimersByTime(6_999));
    expect(view.getByLabelText('限時動態照片')).toBeTruthy();
    act(() => jest.advanceTimersByTime(1));
    expect(view.getByText('下一則限時動態')).toBeTruthy();
    view.unmount();
  });

  test('does not autoplay a previously seen photo again until its new image instance loads', () => {
    const expiresAt = Date.now() + 100_000;
    const view = render(
      <Shelf
        rows={[
          {
            ...common,
            id: 'photo-a',
            kind: 'image',
            createdAt: 1,
            mediaUrl: 'https://example.com/photo-a.jpg',
            text: '校園合照',
            expiresAt,
          },
          {
            ...common,
            id: 'photo-b',
            kind: 'image',
            createdAt: 2,
            mediaUrl: 'https://example.com/photo-b.jpg',
            text: '活動海報',
            expiresAt,
          },
        ]}
      />,
    );

    fireEvent.press(view.getByText('開啟bob'));
    fireEvent.press(view.getByLabelText('自動播放'));
    fireEvent(view.getByLabelText('限時動態照片'), 'load');
    fireEvent.press(view.getByText('下一則'));
    expect(view.getByText('活動海報')).toBeTruthy();
    fireEvent.press(view.getByText('上一則'));
    expect(view.getByText('校園合照')).toBeTruthy();

    // Returning to the same story creates a new Image; the previous onLoad is stale.
    act(() => jest.advanceTimersByTime(8_000));
    expect(view.getByText('校園合照')).toBeTruthy();
    fireEvent(view.getByLabelText('限時動態照片'), 'load');
    act(() => jest.advanceTimersByTime(6_999));
    expect(view.getByText('校園合照')).toBeTruthy();
    act(() => jest.advanceTimersByTime(1));
    expect(view.getByText('活動海報')).toBeTruthy();
    view.unmount();
  });


  test('pauses photo autoplay while a student reads its caption, then resumes the remaining time', () => {
    const expiresAt = Date.now() + 100_000;
    const view = render(
      <Shelf
        rows={[
          {
            ...common,
            id: 'caption-photo',
            kind: 'image',
            createdAt: 1,
            text: '社團集合說明與活動注意事項',
            mediaUrl: 'https://example.com/notice.jpg',
            expiresAt,
          },
          { ...common, id: 'caption-next', createdAt: 2, text: '下一則公告', expiresAt },
        ]}
      />,
    );

    fireEvent.press(view.getByText('開啟bob'));
    fireEvent.press(view.getByLabelText('自動播放'));
    fireEvent(view.getByLabelText('限時動態照片'), 'load');
    act(() => jest.advanceTimersByTime(3_000));
    fireEvent.press(view.getByLabelText('閱讀說明並暫停播放'));
    expect(view.getByLabelText('結束閱讀說明').props.accessibilityState.selected).toBe(true);
    act(() => jest.advanceTimersByTime(20_000));
    expect(view.getByText('社團集合說明與活動注意事項')).toBeTruthy();

    fireEvent.press(view.getByLabelText('結束閱讀說明'));
    act(() => jest.advanceTimersByTime(3_999));
    expect(view.getByText('社團集合說明與活動注意事項')).toBeTruthy();
    act(() => jest.advanceTimersByTime(1));
    expect(view.getByText('下一則公告')).toBeTruthy();
    view.unmount();
  });

  test('reading a video caption preserves the manual playback choice', () => {
    const view = render(
      <Shelf
        rows={[
          {
            ...common,
            id: 'caption-video',
            kind: 'video',
            mediaUrl: 'https://example.com/activity.mp4',
            text: '影片活動資訊',
            expiresAt: Date.now() + 100_000,
          },
        ]}
      />,
    );
    fireEvent.press(view.getByText('開啟bob'));
    const player = () => view.getByLabelText('限時動態影片');
    fireEvent.press(view.getByLabelText('閱讀說明並暫停播放'));
    fireEvent.press(view.getByLabelText('播放影片'));
    expect(player().props.shouldPlay).toBe(false);
    fireEvent.press(view.getByLabelText('結束閱讀說明'));
    expect(player().props.shouldPlay).toBe(true);

    fireEvent.press(view.getByLabelText('暫停播放'));
    fireEvent.press(view.getByLabelText('閱讀說明並暫停播放'));
    fireEvent.press(view.getByLabelText('結束閱讀說明'));
    expect(player().props.shouldPlay).toBe(false);
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
