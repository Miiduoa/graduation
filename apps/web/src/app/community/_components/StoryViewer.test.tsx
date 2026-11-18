import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { StoryViewer } from './StoryViewer';
import type { CampusStoryDoc } from '@/lib/community/firestore';

vi.mock('@/lib/privateFiles', async () => ({
  isPrivateFileObjectPath: (await import('@campus/shared/src/privateFileMedia')).isPrivateFileObjectPath,
  resolvePrivateMedia: async () => null,
}));

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

it('advances automatic playback after the media helper returns null', async () => {
  vi.useFakeTimers();
  const next = vi.fn();
  const viewer = {
    group: { stories: [{ id: 's', kind: 'image', mediaUrl: 'schools/pu/stories/s/image' }] },
    index: 0, next, previous: vi.fn(), close: vi.fn(), switchAuthor: vi.fn(), hasPrevious: false, hasNext: true,
  } as unknown as Parameters<typeof StoryViewer>[0]['viewer'];
  await act(async () => { render(<StoryViewer viewer={viewer} author="同學" />); });
  fireEvent.click(screen.getByText('自動播放'));
  act(() => vi.advanceTimersByTime(7000));
  expect(next).toHaveBeenCalledTimes(1);
});


it('does not change stories on arrow keys used by focused controls, but keeps dialog shortcuts', () => {
  const { viewer } = renderVideo();
  const dialog = screen.getByRole('dialog', { name: '限時動態' });
  const controls = [
    screen.getByRole('button', { name: '關閉限時動態' }),
    screen.getByRole('button', { name: '連續播放' }),
    screen.getByRole('button', { name: /下一則/ }),
    screen.getByRole('button', { name: '私下回覆' }),
  ];

  for (const control of controls) {
    control.focus();
    fireEvent.keyDown(control, { key: 'ArrowRight' });
    fireEvent.keyDown(control, { key: 'ArrowLeft' });
  }
  expect(viewer.next).not.toHaveBeenCalled();
  expect(viewer.previous).not.toHaveBeenCalled();

  dialog.focus();
  fireEvent.keyDown(dialog, { key: 'ArrowRight' });
  fireEvent.keyDown(dialog, { key: 'ArrowLeft' });
  expect(viewer.next).toHaveBeenCalledOnce();
  expect(viewer.previous).toHaveBeenCalledOnce();
});


it('gives keyboard readers a focusable story surface for deliberate arrow navigation', () => {
  const { viewer, video } = renderVideo();
  const canvas = screen.getByRole('region', { name: '限時動態內容，左右方向鍵切換' });

  expect(canvas).toHaveProperty('tabIndex', 0);
  canvas.focus();
  expect(document.activeElement).toBe(canvas);
  fireEvent.keyDown(canvas, { key: 'ArrowRight' });
  fireEvent.keyDown(canvas, { key: 'ArrowLeft' });
  expect(viewer.next).toHaveBeenCalledOnce();
  expect(viewer.previous).toHaveBeenCalledOnce();

  video.focus();
  fireEvent.keyDown(video, { key: 'ArrowRight' });
  expect(viewer.next).toHaveBeenCalledOnce();
});


it('pauses timed text stories while a keyboard reader focuses the story content, then resumes the remaining time', () => {
  vi.useFakeTimers();
  const viewer = {
    group: {
      authorUid: 'one',
      latestAt: 0,
      stories: [{
        id: 'text-reading',
        schoolId: 'pu',
        authorUid: 'one',
        kind: 'text' as const,
        text: '學生會活動時間與地點',
      }],
    },
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
  fireEvent.click(screen.getByRole('button', { name: '自動播放' }));
  act(() => vi.advanceTimersByTime(3_000));

  const readingRegion = screen.getByRole('region', { name: '限時動態內容，左右方向鍵切換' });
  act(() => readingRegion.focus());
  expect(document.activeElement).toBe(readingRegion);
  act(() => vi.advanceTimersByTime(10_000));
  expect(viewer.next).not.toHaveBeenCalled();

  act(() => screen.getByRole('button', { name: '暫停' }).focus());
  act(() => vi.advanceTimersByTime(3_999));
  expect(viewer.next).not.toHaveBeenCalled();
  act(() => vi.advanceTimersByTime(1));
  expect(viewer.next).toHaveBeenCalledOnce();
});

it('pauses a playing video while its caption is focused and resumes only playback that was active', () => {
  const { viewer, video } = renderVideo();
  let paused = true;
  Object.defineProperty(video, 'paused', { configurable: true, get: () => paused });
  const play = vi.spyOn(HTMLMediaElement.prototype, 'play').mockImplementation(() => {
    paused = false;
    return Promise.resolve();
  });
  const pause = vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {
    paused = true;
  });

  fireEvent.click(screen.getByRole('button', { name: '連續播放' }));
  expect(paused).toBe(false);
  // Focusing the native video controls must not interrupt playback.
  act(() => video.focus());
  expect(paused).toBe(false);

  const caption = screen.getByRole('region', { name: '限時動態說明文字' });
  act(() => caption.focus());
  expect(paused).toBe(true);
  expect(pause).toHaveBeenCalled();
  fireEvent.ended(video);
  expect(viewer.next).not.toHaveBeenCalled();

  act(() => screen.getByRole('button', { name: '停止連播' }).focus());
  expect(paused).toBe(false);
  expect(play).toHaveBeenCalledTimes(2);

  // A video manually paused before caption reading must stay paused afterward.
  fireEvent.click(screen.getByRole('button', { name: '停止連播' }));
  expect(paused).toBe(true);
  const priorPlayCount = play.mock.calls.length;
  act(() => caption.focus());
  act(() => screen.getByRole('button', { name: '連續播放' }).focus());
  expect(paused).toBe(true);
  expect(play).toHaveBeenCalledTimes(priorPlayCount);
});

it('defers newly enabled continuous playback while the caption is focused', () => {
  const { viewer, video } = renderVideo();
  let paused = true;
  Object.defineProperty(video, 'paused', { configurable: true, get: () => paused });
  const play = vi.spyOn(HTMLMediaElement.prototype, 'play').mockImplementation(() => {
    paused = false;
    return Promise.resolve();
  });
  vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {
    paused = true;
  });

  // A keyboard reader is still on the caption; a touch/assistive activation need not blur it.
  const caption = screen.getByRole('region', { name: '限時動態說明文字' });
  act(() => caption.focus());
  expect(paused).toBe(true);
  fireEvent.click(screen.getByRole('button', { name: '連續播放' }));
  expect(screen.getByRole('button', { name: '停止連播' }).getAttribute('aria-pressed')).toBe('true');
  expect(paused).toBe(true);
  expect(play).not.toHaveBeenCalled();

  // Starting continuous playback is an explicit new choice, but it must wait until reading ends.
  act(() => screen.getByRole('button', { name: '停止連播' }).focus());
  expect(paused).toBe(false);
  expect(play).toHaveBeenCalledTimes(1);
  expect(viewer.next).not.toHaveBeenCalled();
});

it('keeps a video stopped when the student disables continuous playback while reading its caption', () => {
  const { video } = renderVideo();
  let paused = true;
  Object.defineProperty(video, 'paused', { configurable: true, get: () => paused });
  const play = vi.spyOn(HTMLMediaElement.prototype, 'play').mockImplementation(() => {
    paused = false;
    return Promise.resolve();
  });
  vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => {
    paused = true;
  });

  fireEvent.click(screen.getByRole('button', { name: '連續播放' }));
  expect(paused).toBe(false);
  const caption = screen.getByRole('region', { name: '限時動態說明文字' });
  act(() => caption.focus());
  expect(paused).toBe(true);

  // Touch/screen-reader activation need not blur the focused caption first.
  fireEvent.click(screen.getByRole('button', { name: '停止連播' }));
  expect(paused).toBe(true);
  act(() => screen.getByRole('button', { name: '連續播放' }).focus());
  expect(paused).toBe(true);
  expect(play).toHaveBeenCalledTimes(1);
});

it('lets students focus and read media captions without switching stories by arrow keys or caption taps', () => {
  const { viewer } = renderVideo();
  const canvas = screen.getByRole('region', { name: '限時動態內容，左右方向鍵切換' });
  const caption = screen.getByRole('region', { name: '限時動態說明文字' });
  expect(caption).toHaveProperty('tabIndex', 0);

  act(() => caption.focus());
  expect(document.activeElement).toBe(caption);
  fireEvent.keyDown(caption, { key: 'ArrowRight' });
  fireEvent.keyDown(caption, { key: 'ArrowLeft' });
  expect(viewer.next).not.toHaveBeenCalled();
  expect(viewer.previous).not.toHaveBeenCalled();

  vi.spyOn(canvas, 'getBoundingClientRect').mockReturnValue({ left: 0, width: 100 } as DOMRect);
  const tap = { pointerId: 1, isPrimary: true, button: 0, clientX: 95, clientY: 80 };
  fireEvent.pointerDown(caption, tap);
  fireEvent.pointerUp(caption, tap);
  expect(viewer.next).not.toHaveBeenCalled();

  fireEvent.pointerDown(canvas, tap);
  fireEvent.pointerUp(canvas, tap);
  expect(viewer.next).toHaveBeenCalledOnce();

  act(() => canvas.focus());
  fireEvent.keyDown(canvas, { key: 'ArrowRight' });
  expect(viewer.next).toHaveBeenCalledTimes(2);
});

it('pauses image-story auto-advance while the caption is focused and resumes the remaining time', async () => {
  vi.useFakeTimers();
  const viewer = {
    group: {
      authorUid: 'one',
      latestAt: 0,
      stories: [{
        id: 'photo-caption',
        schoolId: 'pu',
        authorUid: 'one',
        kind: 'image' as const,
        mediaUrl: '/photo-caption.png',
        text: '較長的社團活動說明，可用方向鍵閱讀',
      }],
    },
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
  // Next/Image resolves image decoding asynchronously before invoking the supplied onLoad.
  // Flush that promise before advancing fake timers, just as a decoded image is ready in the browser.
  await act(async () => {
    fireEvent.load(screen.getByRole('img', { name: '限時動態照片' }));
  });
  fireEvent.click(screen.getByRole('button', { name: '自動播放' }));
  act(() => vi.advanceTimersByTime(3_000));

  const caption = screen.getByRole('region', { name: '限時動態說明文字' });
  act(() => caption.focus());
  act(() => vi.advanceTimersByTime(10_000));
  expect(viewer.next).not.toHaveBeenCalled();

  act(() => screen.getByRole('button', { name: '暫停' }).focus());
  act(() => vi.advanceTimersByTime(3_999));
  expect(viewer.next).not.toHaveBeenCalled();
  act(() => vi.advanceTimersByTime(1));
  expect(viewer.next).toHaveBeenCalledOnce();
});
