import { act, renderHook } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { useStoryShelf } from './useStoryShelf';
import {
  markStoryViewed,
  type CampusStoryDoc,
  type StoryAuthorGroup,
} from '@/lib/community/firestore';

vi.mock('@/lib/community/firestore', () => ({
  markStoryViewed: vi.fn().mockResolvedValue(undefined),
}));

afterEach(() => {
  window.sessionStorage.clear();
  vi.clearAllMocks();
  vi.useRealTimers();
});

function group(authorUid: string, stories: Partial<CampusStoryDoc>[]): StoryAuthorGroup {
  return {
    authorUid,
    latestAt: 0,
    stories: stories.map((s, i) => ({
      schoolId: 'pu',
      authorUid,
      id: authorUid + i,
      kind: 'text',
      expiresAt: Date.now() + 60_000,
      ...s,
    })),
  };
}

it('resumes the first unseen story in this tab and crosses author boundaries in either direction', () => {
  const rows = [group('a', [{}, {}]), group('b', [{}])];
  const { result } = renderHook(() => useStoryShelf(rows, 'pu', 'student'));
  act(() => result.current.open(result.current.groups[0]));
  act(() => result.current.viewer!.close());
  act(() => result.current.open(result.current.groups[0]));
  expect(result.current.viewer?.index).toBe(1);
  act(() => result.current.viewer!.next());
  expect(result.current.viewer?.group.authorUid).toBe('b');
  act(() => result.current.viewer!.previous());
  expect(result.current.viewer?.index).toBe(1);
  expect(markStoryViewed).toHaveBeenCalledTimes(3);
  const fresh = renderHook(() => useStoryShelf(rows, 'pu', 'student'));
  expect(fresh.result.current.seen.has('a1')).toBe(true);
  const other = renderHook(() => useStoryShelf(rows, 'pu', 'another'));
  expect(other.result.current.seen.size).toBe(0);
});

it('removes expired stories while open and excludes other schools and invalid deadlines', () => {
  vi.useFakeTimers();
  const rows = [
    group('a', [
      { expiresAt: Date.now() + 500 },
      { schoolId: 'other' },
      { expiresAt: undefined },
      { expiresAt: Infinity },
    ]),
  ];
  const { result } = renderHook(() => useStoryShelf(rows, 'pu', 'student'));
  expect(result.current.groups[0].stories).toHaveLength(1);
  act(() => result.current.open(result.current.groups[0]));
  act(() => vi.advanceTimersByTime(500));
  expect(result.current.viewer).toBeNull();
  expect(result.current.groups).toEqual([]);
});

it('records no self-view and retries a failed receipt only on an explicit revisit', async () => {
  const rows = [group('me', [{}]), group('peer', [{}])];
  const { result } = renderHook(() => useStoryShelf(rows, 'pu', 'me'));
  act(() => result.current.open(rows[0]));
  expect(result.current.viewer?.isOwner).toBe(true);
  expect(markStoryViewed).not.toHaveBeenCalled();
  vi.mocked(markStoryViewed).mockRejectedValueOnce(new Error('offline'));
  await act(async () => result.current.open(rows[1]));
  expect(result.current.viewer?.isOwner).toBe(false);
  expect(markStoryViewed).toHaveBeenCalledTimes(1);
  await act(async () => result.current.open(rows[1]));
  await act(async () => result.current.open(rows[1]));
  expect(markStoryViewed).toHaveBeenCalledTimes(2);
});
