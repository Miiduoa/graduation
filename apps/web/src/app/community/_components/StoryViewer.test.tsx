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
    viewerUid: 'reader',
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

function renderPhoto() {
  const story: CampusStoryDoc = {
    id: 'photo', schoolId: 'pu', authorUid: 'one', kind: 'image',
    mediaUrl: '/campus-photo.jpg', text: '社團合照',
  };
  const viewer = {
    group: { authorUid: 'one', latestAt: 0, stories: [story] },
    viewerUid: 'reader', isOwner: false, index: 0,
    hasPrevious: false, hasNext: true,
    next: vi.fn(), previous: vi.fn(), close: vi.fn(), switchAuthor: vi.fn(),
  };
  render(<StoryViewer author="同學" viewer={viewer} />);
  return viewer;
}

it('keeps a failed photo in place, retries without modifying its URL, and resumes only on request', () => {
  vi.useFakeTimers();
  const viewer = renderPhoto();
  fireEvent.click(screen.getByRole('button', { name: '自動播放' }));
  const original = screen.getByRole('img', { name: '限時動態照片' });
  fireEvent.error(original);
  expect(screen.getByRole('status').textContent).toContain('照片暫時無法顯示');
  expect(screen.getByRole('button', { name: '自動播放' })).toHaveProperty('disabled', true);
  act(() => vi.advanceTimersByTime(8_000));
  expect(viewer.next).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: '重新載入照片' }));
  const retried = screen.getByRole('img', { name: '限時動態照片' });
  expect(retried).not.toBe(original);
  expect(retried.getAttribute('src')).toContain('/campus-photo.jpg');
  fireEvent.load(retried);
  act(() => vi.advanceTimersByTime(8_000));
  expect(viewer.next).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: '自動播放' }));
  act(() => vi.advanceTimersByTime(7_100));
  expect(viewer.next).toHaveBeenCalledOnce();
});

it('lets a failed video retry muted while keeping its caption and next navigation', () => {
  const { viewer, video } = renderVideo();
  fireEvent.error(video);
  expect(screen.getByRole('button', { name: '連續播放' })).toHaveProperty('disabled', true);
  fireEvent.click(screen.getByRole('button', { name: '重新載入影片' }));
  const retried = screen.getByLabelText('限時動態影片');
  expect(retried).not.toBe(video);
  expect(retried).toHaveProperty('muted', true);
  expect(screen.getByText('社團彩排')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: /下一則/ }));
  expect(viewer.next).toHaveBeenCalledOnce();
});
