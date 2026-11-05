import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { StoryViewer } from './StoryViewer';
import type { CampusStoryDoc } from '@/lib/community/firestore';

vi.mock('@/components/ui/modalSession', () => ({
  openModalSession(dialog: HTMLDialogElement) {
    dialog.setAttribute('open', '');
  },
}));

beforeEach(() => {
  vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined);
  vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {});
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

function renderVideo() {
  const story: CampusStoryDoc = {
    id: 'clip',
    schoolId: 'pu',
    authorUid: 'one',
    kind: 'video',
    text: '社團彩排',
    mediaUrl: '/clip.mp4',
  };
  const viewer = {
    group: { authorUid: 'one', latestAt: 0, stories: [story] },
    isOwner: false,
    index: 0,
    hasPrevious: false,
    hasNext: true,
    next: vi.fn(),
    previous: vi.fn(),
    close: vi.fn(),
    switchAuthor: vi.fn(),
  };
  render(<StoryViewer author="同學" viewer={viewer} />);
  const video = screen.getByLabelText('限時動態影片');
  return { viewer, video };
}

it('keeps the video muted with native controls; only continuous playback advances on its real end', async () => {
  vi.useFakeTimers();
  const { viewer, video } = renderVideo();
  expect(video).toHaveProperty('muted', true);
  expect(video).toHaveProperty('controls', true);
  expect(screen.getByText('社團彩排')).toBeTruthy();
  expect(HTMLMediaElement.prototype.play).not.toHaveBeenCalled();
  fireEvent.keyDown(video, { key: 'ArrowRight' });
  fireEvent.ended(video);
  expect(viewer.next).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: '連續播放' }));
  expect(HTMLMediaElement.prototype.play).toHaveBeenCalled();
  act(() => vi.advanceTimersByTime(8_000));
  expect(viewer.next).not.toHaveBeenCalled();
  fireEvent.ended(video);
  expect(viewer.next).toHaveBeenCalledOnce();
});

it('preserves an explicit next button and caption when the codec cannot play', () => {
  const { viewer, video } = renderVideo();
  fireEvent.error(video);
  expect(screen.getByRole('status').textContent).toContain('無法播放');
  expect(screen.getByText('社團彩排')).toBeTruthy();
  expect(screen.getByRole('button', { name: '連續播放' })).toHaveProperty('disabled', true);
  fireEvent.click(screen.getByRole('button', { name: /下一則/ }));
  expect(viewer.next).toHaveBeenCalledOnce();
});

it.each([true, false])(
  'restores only active continuous playback on return (user paused: %s)',
  (paused) => {
    let hidden = false;
    vi.spyOn(document, 'hidden', 'get').mockImplementation(() => hidden);
    const { viewer, video } = renderVideo();
    fireEvent.click(screen.getByRole('button', { name: '連續播放' }));
    expect(HTMLMediaElement.prototype.play).toHaveBeenCalledTimes(1);
    Object.defineProperty(video, 'paused', { value: paused });
    if (paused) fireEvent.pause(video);
    hidden = true;
    fireEvent(document, new Event('visibilitychange'));
    expect(HTMLMediaElement.prototype.pause).toHaveBeenCalled();
    hidden = false;
    fireEvent(document, new Event('visibilitychange'));
    expect(HTMLMediaElement.prototype.play).toHaveBeenCalledTimes(paused ? 1 : 2);
    expect(viewer.next).not.toHaveBeenCalled();
  },
);
