import React from 'react';
import { Pressable, Text } from 'react-native';
import { act, fireEvent, render } from '@testing-library/react-native';
import { CampusStoryViewer, useCampusStories } from '../screens/social/CampusStoryViewer';
import type { CampusStoryDoc } from '../services/stories';

jest.mock('../firebase', () => ({ isFirebaseMockMode: () => false }));
jest.mock('../services/stories', () => ({
  ...jest.requireActual('../services/stories'),
  markStoryViewed: jest.fn(async () => {}),
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
});
