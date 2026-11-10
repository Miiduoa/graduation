import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { StoryViewer } from './StoryViewer';
vi.mock('@/components/ui/modalSession', () => ({ openModalSession: () => () => {} }));
vi.mock('@/lib/privateFiles', async () => ({
  isPrivateFileObjectPath: (await import('@campus/shared/src/privateFileMedia')).isPrivateFileObjectPath,
  resolvePrivateMedia: async () => null,
}));
afterEach(() => vi.useRealTimers());
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
