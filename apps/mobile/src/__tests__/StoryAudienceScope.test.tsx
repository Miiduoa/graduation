import React from 'react';
import { act, fireEvent, render } from '@testing-library/react-native';
import { StoryAudiencePanel } from '../screens/social/StoryAudiencePanel';
import { listStoryViewers, type CampusStoryDoc } from '../services/stories';

jest.mock('../services/stories', () => ({
  listStoryViewers: jest.fn(),
}));
jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));

type Page = Awaited<ReturnType<typeof listStoryViewers>>;
type Cursor = Parameters<typeof listStoryViewers>[1];

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

const puStory: CampusStoryDoc = {
  id: 'shared-story-id',
  schoolId: 'pu',
  authorUid: 'owner',
  kind: 'text',
};
const otherStory: CampusStoryDoc = { ...puStory, schoolId: 'nchu' };

describe('story audience scope transitions', () => {
  beforeEach(() => {
    jest.resetAllMocks();
  });

  test('switching school with the same story ID immediately hides old viewers, resets the cursor, and ignores late pages', async () => {
    const oldCursor = { id: 'pu-cursor' } as Cursor;
    const oldPage = deferred<Page>();
    const newPage = deferred<Page>();
    const fetchViewers = jest.mocked(listStoryViewers);
    fetchViewers.mockImplementation((scope, cursor) => {
      if (scope.schoolId === 'pu' && cursor === null) {
        return Promise.resolve({
          viewers: [{ uid: 'pu-student', displayName: '甲校同學' }],
          nextCursor: oldCursor,
        });
      }
      if (scope.schoolId === 'pu' && cursor === oldCursor) return oldPage.promise;
      if (scope.schoolId === 'nchu' && cursor === null) return newPage.promise;
      return Promise.reject(new Error('Unexpected scope or cursor'));
    });

    const view = render(<StoryAudiencePanel story={puStory} onBack={jest.fn()} />);
    await act(async () => { await Promise.resolve(); });
    expect(view.getByText('甲校同學')).toBeTruthy();

    fireEvent.press(view.getByText('載入更多觀看者'));
    expect(fetchViewers).toHaveBeenCalledWith(
      { id: 'shared-story-id', schoolId: 'pu', authorUid: 'owner' },
      oldCursor,
    );

    view.rerender(<StoryAudiencePanel story={otherStory} onBack={jest.fn()} />);
    expect(view.queryByText('甲校同學')).toBeNull();
    expect(view.getByText('正在載入觀看名單…')).toBeTruthy();
    expect(fetchViewers).toHaveBeenCalledWith(
      { id: 'shared-story-id', schoolId: 'nchu', authorUid: 'owner' },
      null,
    );

    await act(async () => {
      newPage.resolve({
        viewers: [{ uid: 'nchu-student', displayName: '乙校同學' }],
        nextCursor: null,
      });
      await newPage.promise;
    });
    expect(view.getByText('乙校同學')).toBeTruthy();
    expect(view.queryByText('甲校同學')).toBeNull();

    await act(async () => {
      oldPage.resolve({
        viewers: [{ uid: 'pu-other', displayName: '甲校晚到名單' }],
        nextCursor: null,
      });
      await oldPage.promise;
    });
    expect(view.getByText('乙校同學')).toBeTruthy();
    expect(view.queryByText('甲校晚到名單')).toBeNull();
    view.unmount();
  });

  test('a fresh school permission denial cannot reveal the previous school audience', async () => {
    const denied = deferred<Page>();
    const fetchViewers = jest.mocked(listStoryViewers);
    fetchViewers.mockImplementation((scope, cursor) => {
      if (cursor !== null) throw new Error('Unexpected cursor');
      if (scope.schoolId === 'pu') {
        return Promise.resolve({
          viewers: [{ uid: 'pu-student', displayName: '上一校觀看者' }],
          nextCursor: null,
        });
      }
      return denied.promise;
    });

    const view = render(<StoryAudiencePanel story={puStory} onBack={jest.fn()} />);
    await act(async () => { await Promise.resolve(); });
    expect(view.getByText('上一校觀看者')).toBeTruthy();

    view.rerender(<StoryAudiencePanel story={otherStory} onBack={jest.fn()} />);
    expect(view.queryByText('上一校觀看者')).toBeNull();
    await act(async () => {
      denied.reject({ code: 'permission-denied' });
      await denied.promise.catch(() => {});
    });
    expect(view.getByText('目前無法存取這則限時動態的觀看名單')).toBeTruthy();
    expect(view.queryByText('上一校觀看者')).toBeNull();
    view.unmount();
  });
  test('a stalled first page offers an explicit retry and ignores its late response', async () => {
    jest.useFakeTimers();
    const stale = deferred<Page>();
    const fetchViewers = jest.mocked(listStoryViewers);
    fetchViewers
      .mockImplementationOnce(() => stale.promise)
      .mockResolvedValueOnce({
        viewers: [{ uid: 'fresh-student', displayName: '重試後的同學' }],
        nextCursor: null,
      });

    const view = render(<StoryAudiencePanel story={puStory} onBack={jest.fn()} />);
    expect(view.getByText('正在載入觀看名單…')).toBeTruthy();
    await act(async () => {
      jest.advanceTimersByTime(14_999);
      await Promise.resolve();
    });
    expect(view.queryByText('再試一次')).toBeNull();
    await act(async () => {
      jest.advanceTimersByTime(1);
      await Promise.resolve();
    });
    expect(view.getByText('暫時無法載入觀看名單')).toBeTruthy();
    await act(async () => {
      fireEvent.press(view.getByText('再試一次'));
      await Promise.resolve();
    });
    expect(fetchViewers.mock.calls.map((args) => args[1])).toEqual([null, null]);
    expect(view.getByText('重試後的同學')).toBeTruthy();

    await act(async () => {
      stale.resolve({
        viewers: [{ uid: 'stale-student', displayName: '過期的舊回應' }],
        nextCursor: null,
      });
      await stale.promise;
    });
    expect(view.getByText('重試後的同學')).toBeTruthy();
    expect(view.queryByText('過期的舊回應')).toBeNull();
    view.unmount();
    jest.useRealTimers();
  });

  test('a stalled next page keeps the first page and retries its exact cursor', async () => {
    jest.useFakeTimers();
    const cursor = { id: 'first-page-cursor' } as Cursor;
    const stale = deferred<Page>();
    const fetchViewers = jest.mocked(listStoryViewers);
    fetchViewers
      .mockResolvedValueOnce({
        viewers: [{ uid: 'first-student', displayName: '第一頁同學' }],
        nextCursor: cursor,
      })
      .mockImplementationOnce(() => stale.promise)
      .mockResolvedValueOnce({
        viewers: [{ uid: 'next-student', displayName: '下一頁同學' }],
        nextCursor: null,
      });

    const view = render(<StoryAudiencePanel story={puStory} onBack={jest.fn()} />);
    await act(async () => { await Promise.resolve(); });
    fireEvent.press(view.getByText('載入更多觀看者'));
    expect(view.getByText('第一頁同學')).toBeTruthy();
    await act(async () => {
      jest.advanceTimersByTime(15_000);
      await Promise.resolve();
    });
    expect(view.getByText('暫時無法載入觀看名單')).toBeTruthy();
    expect(view.getByText('第一頁同學')).toBeTruthy();
    await act(async () => {
      fireEvent.press(view.getByText('再試一次'));
      await Promise.resolve();
    });
    expect(fetchViewers.mock.calls.map((args) => args[1])).toEqual([null, cursor, cursor]);
    expect(view.getByText('第一頁同學')).toBeTruthy();
    expect(view.getByText('下一頁同學')).toBeTruthy();

    await act(async () => {
      stale.reject({ code: 'permission-denied' });
      await stale.promise.catch(() => {});
    });
    expect(view.queryByText('目前無法存取這則限時動態的觀看名單')).toBeNull();
    expect(view.getByText('第一頁同學')).toBeTruthy();
    expect(view.getByText('下一頁同學')).toBeTruthy();
    view.unmount();
    jest.useRealTimers();
  });

});
