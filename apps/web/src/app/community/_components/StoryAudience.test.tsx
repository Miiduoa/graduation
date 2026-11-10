import { act, fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, expect, it, onTestFinished, vi } from 'vitest';
import { StoryViewer } from './StoryViewer';
import { listStoryViewersPage, type StoryAudiencePage } from '@/lib/community/storyViewers';

vi.mock('@/lib/community/storyViewers', () => ({ listStoryViewersPage: vi.fn() }));
const fetchPage = vi.mocked(listStoryViewersPage);
const cursor = { id: 'last' } as NonNullable<StoryAudiencePage['nextCursor']>;
const first = { uid: 'private-uid', displayName: '小文' };
const second = { uid: 'hidden-id', displayName: '同學' };
const story = {
  id: 'first',
  schoolId: 'pu',
  authorUid: 'alice',
  kind: 'text' as const,
  text: '校慶',
};
function viewer(isOwner = true) {
  return {
    group: { authorUid: story.authorUid, latestAt: 0, stories: [story] },
    isOwner,
    index: 0,
    hasPrevious: false,
    hasNext: true,
    next: vi.fn(),
    previous: vi.fn(),
    close: vi.fn(),
    switchAuthor: vi.fn(),
  };
}

beforeEach(() => {
  fetchPage.mockReset();
  for (const method of ['showModal', 'close'] as const) {
    const proto = HTMLDialogElement.prototype;
    const original = Object.getOwnPropertyDescriptor(proto, method);
    Object.defineProperty(proto, method, {
      configurable: true,
      value(this: HTMLDialogElement) {
        this.open = method === 'showModal';
      },
    });
    onTestFinished(() => {
      if (original) Object.defineProperty(proto, method, original);
      else Reflect.deleteProperty(proto, method);
    });
  }
});

it('loads private names on demand and retries the same page without losing earlier rows', async () => {
  fetchPage
    .mockResolvedValueOnce({ viewers: [first], nextCursor: cursor })
    .mockRejectedValueOnce(new Error('offline'))
    .mockResolvedValueOnce({ viewers: [second], nextCursor: null });
  render(<StoryViewer viewer={viewer()} author="我" />);
  const trigger = screen.getByRole('button', { name: '誰看過' });
  expect(fetchPage).not.toHaveBeenCalled();
  trigger.focus();
  fireEvent.click(trigger);
  expect(trigger.getAttribute('aria-expanded')).toBe('true');
  expect(screen.getByRole('status').textContent).toContain('載入');
  await screen.findByText('小文');
  expect(fetchPage).toHaveBeenCalledWith(storyFields(), null);
  fireEvent.click(screen.getByRole('button', { name: '顯示更多觀看者' }));
  await screen.findByRole('alert');
  expect(screen.getByText('小文')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: '再試一次' }));
  await screen.findByText('同學');
  expect(screen.getByText('已顯示 2 位')).toBeTruthy();
  expect(fetchPage.mock.calls.map(([, after]) => after)).toEqual([null, cursor, cursor]);
  expect(screen.queryByRole('button', { name: '顯示更多觀看者' })).toBeNull();
  expect(document.body.textContent).not.toContain(first.uid);
  expect(document.body.textContent).not.toContain(second.uid);
  fireEvent.click(screen.getByRole('button', { name: '返回限時動態' }));
  expect(document.activeElement).toBe(trigger);
  expect(trigger.getAttribute('aria-expanded')).toBe('false');
});

function storyFields() {
  return { id: story.id, schoolId: story.schoolId, authorUid: story.authorUid };
}

it('clears visible names when a later page loses authorization', async () => {
  fetchPage
    .mockResolvedValueOnce({ viewers: [first], nextCursor: cursor })
    .mockRejectedValueOnce({ code: 'permission-denied' });
  render(<StoryViewer viewer={viewer()} author="我" />);
  fireEvent.click(screen.getByRole('button', { name: '誰看過' }));
  fireEvent.click(await screen.findByRole('button', { name: '顯示更多觀看者' }));
  await screen.findByRole('alert');
  expect(screen.queryByText(first.displayName)).toBeNull();
  expect(screen.queryByRole('button', { name: '顯示更多觀看者' })).toBeNull();
});

it('rejects stale results after changing owner and explains receipt visibility to readers', async () => {
  let finish!: (value: StoryAudiencePage) => void;
  fetchPage.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const { rerender } = render(<StoryViewer viewer={viewer()} author="我" />);
  fireEvent.click(screen.getByRole('button', { name: '誰看過' }));
  rerender(<StoryViewer viewer={viewer(false)} author="同學" />);
  await act(async () => finish({ viewers: [first], nextCursor: null }));
  expect(screen.queryByText(first.displayName)).toBeNull();
  expect(screen.queryByRole('button', { name: '誰看過' })).toBeNull();
  expect(screen.getByText('作者可查看誰看過')).toBeTruthy();
});

it('pauses playback while browsing the audience and Escape returns to the same story', async () => {
  vi.useFakeTimers();
  onTestFinished(() => {
    vi.useRealTimers();
  });
  fetchPage.mockResolvedValue({ viewers: [], nextCursor: null });
  const position = viewer();
  render(<StoryViewer viewer={position} author="我" />);
  fireEvent.click(screen.getByRole('button', { name: '自動播放' }));
  act(() => {
    vi.advanceTimersByTime(2000);
  });
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: '誰看過' }));
  });
  expect(screen.getByText('目前還沒有觀看紀錄。')).toBeTruthy();
  const dialog = screen.getByRole('dialog', { name: '誰看過' });
  fireEvent.keyDown(dialog, { key: 'ArrowRight' });
  act(() => {
    vi.advanceTimersByTime(10000);
  });
  expect(position.next).not.toHaveBeenCalled();
  fireEvent(dialog, new Event('cancel', { cancelable: true }));
  expect(position.close).not.toHaveBeenCalled();
  expect(screen.queryByRole('dialog', { name: '誰看過' })).toBeNull();
  act(() => {
    vi.advanceTimersByTime(4999);
  });
  expect(position.next).not.toHaveBeenCalled();
  act(() => {
    vi.advanceTimersByTime(1);
  });
  expect(position.next).toHaveBeenCalledOnce();
});

it.each([
  { continuous: true, alreadyPaused: false },
  { continuous: true, alreadyPaused: true },
  { continuous: false, alreadyPaused: false },
])(
  'preserves native video playback across the audience ($continuous, paused $alreadyPaused)',
  async ({ continuous, alreadyPaused }) => {
    const play = vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined);
    const pause = vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {});
    const hidden = vi.spyOn(document, 'hidden', 'get').mockReturnValue(false);
    onTestFinished(() => {
      play.mockRestore();
      pause.mockRestore();
      hidden.mockRestore();
    });
    fetchPage.mockResolvedValue({ viewers: [], nextCursor: null });
    const position = viewer();
    const clip = { ...story, kind: 'video' as const, mediaUrl: '/clip.mp4' };
    const withClip = { ...position, group: { ...position.group, stories: [clip] } };
    render(<StoryViewer viewer={withClip} author="我" />);
    const video = screen.getByLabelText('限時動態影片') as HTMLVideoElement;
    if (continuous) fireEvent.click(screen.getByRole('button', { name: '連續播放' }));
    Object.defineProperty(video, 'paused', { value: alreadyPaused, configurable: true });
    video.currentTime = 3.75;
    play.mockClear();
    pause.mockClear();
    fireEvent.click(screen.getByRole('button', { name: '誰看過' }));
    await screen.findByText('目前還沒有觀看紀錄。');
    expect(pause).toHaveBeenCalled();
    fireEvent.ended(video);
    hidden.mockReturnValue(true);
    fireEvent(document, new Event('visibilitychange'));
    hidden.mockReturnValue(false);
    fireEvent(document, new Event('visibilitychange'));
    expect(position.next).not.toHaveBeenCalled();
    expect(play).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: '返回限時動態' }));
    expect(play).toHaveBeenCalledTimes(alreadyPaused ? 0 : 1);
    expect(video.currentTime).toBe(3.75);
    fireEvent.ended(video);
    expect(position.next).toHaveBeenCalledTimes(continuous ? 1 : 0);
  },
);
