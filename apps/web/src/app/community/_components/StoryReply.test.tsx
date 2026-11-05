import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { sendStoryReply } from '@/lib/community/storyReplies';
import { StoryViewer } from './StoryViewer';

vi.mock('@/lib/community/storyReplies', () => ({ sendStoryReply: vi.fn() }));
vi.mock('@/components/ui/modalSession', () => ({
  openModalSession(dialog: HTMLDialogElement, initial: HTMLElement) {
    const previous = document.activeElement as HTMLElement;
    dialog.open = true;
    initial.focus();
    return () => {
      dialog.open = false;
      previous?.focus();
    };
  },
}));
const send = vi.mocked(sendStoryReply);
function position(viewerUid = 'reader', storyId = 'one', allowReplies: boolean | undefined = true) {
  const story = {
    allowReplies,
    id: storyId,
    authorUid: 'writer',
    schoolId: 'pu',
    kind: 'text' as const,
    text: '春季社遊',
  };
  return {
    viewerUid,
    group: { authorUid: story.authorUid, latestAt: 0, stories: [story] },
    isOwner: story.authorUid === viewerUid,
    index: 0,
    hasPrevious: false,
    hasNext: true,
    next: vi.fn(),
    previous: vi.fn(),
    close: vi.fn(),
    switchAuthor: vi.fn(),
  };
}
function compose() {
  const trigger = screen.getByRole('button', { name: '私下回覆' });
  trigger.focus();
  fireEvent.click(trigger);
  return screen.getByRole('textbox', { name: '回覆內容' }) as HTMLTextAreaElement;
}
beforeEach(() => {
  send.mockReset();
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

it('keeps the same delivery id on retry, blocks duplicate clicks and only links a confirmed message', async () => {
  let confirm!: (conversation: string) => void;
  send.mockRejectedValueOnce(new Error('timeout')).mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        confirm = resolve;
      }),
  );
  render(<StoryViewer viewer={position()} author="阿雅" />);
  const input = compose();
  expect(document.activeElement).toBe(input);
  expect(screen.getByRole('button', { name: '送出回覆' })).toHaveProperty('disabled', true);
  fireEvent.change(input, { target: { value: '  還有名額嗎？  ' } });
  fireEvent.click(screen.getByRole('button', { name: '送出回覆' }));
  await screen.findByRole('alert');
  expect(input.value).toBe('  還有名額嗎？  ');
  fireEvent.click(screen.getByRole('button', { name: '重試送出' }));
  fireEvent.submit(input.form!);
  expect(send).toHaveBeenCalledTimes(2);
  expect(send.mock.calls[1]).toEqual(send.mock.calls[0]);
  expect(send).toHaveBeenCalledWith('reader', {
    schoolId: 'pu',
    authorUid: 'writer',
    storyId: 'one',
    replyId: expect.stringMatching(/^[a-zA-Z0-9_-]{20,64}$/),
    content: '還有名額嗎？',
  });
  expect(screen.queryByRole('link', { name: '開啟私訊' })).toBeNull();
  await act(async () => confirm('dm_pu_reader_writer'));
  expect(screen.getByRole('status').textContent).toBe('回覆已送出');
  expect(screen.getByRole('link', { name: '開啟私訊' }).getAttribute('href')).toBe(
    '/dms/dm_pu_reader_writer',
  );
});

it('keeps a draft when offline and pauses the story while typing, resuming the remaining dwell on Escape', () => {
  vi.useFakeTimers();
  vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
  const viewer = position();
  render(<StoryViewer viewer={viewer} author="阿雅" />);
  fireEvent.click(screen.getByRole('button', { name: '自動播放' }));
  act(() => vi.advanceTimersByTime(2000));
  const input = compose();
  fireEvent.change(input, { target: { value: '我想參加' } });
  fireEvent.keyDown(input, { key: 'ArrowRight' });
  fireEvent.submit(input.form!);
  expect(screen.getByRole('alert').textContent).toContain('離線');
  expect(send).not.toHaveBeenCalled();
  act(() => vi.advanceTimersByTime(10000));
  expect(viewer.next).not.toHaveBeenCalled();
  const dialog = screen.getByRole('dialog', { name: '回覆限時動態' });
  fireEvent(dialog, new Event('cancel', { cancelable: true }));
  expect(viewer.close).not.toHaveBeenCalled();
  expect(document.activeElement).toBe(screen.getByRole('button', { name: '私下回覆' }));
  expect(compose().value).toBe('我想參加');
  fireEvent.click(screen.getByRole('button', { name: '返回限時動態' }));
  act(() => vi.advanceTimersByTime(4999));
  expect(viewer.next).not.toHaveBeenCalled();
  act(() => vi.advanceTimersByTime(1));
  expect(viewer.next).toHaveBeenCalledOnce();
});

it.each([
  ['other', 'one'],
  ['reader', 'two'],
])('discards the private draft and late confirmation on a change to %s / %s', async (uid, id) => {
  let confirm!: (conversation: string) => void;
  send.mockImplementation(
    () =>
      new Promise((resolve) => {
        confirm = resolve;
      }),
  );
  const { rerender } = render(<StoryViewer viewer={position()} author="阿雅" />);
  const input = compose();
  fireEvent.change(input, { target: { value: '原帳號草稿' } });
  fireEvent.submit(input.form!);
  expect(send).toHaveBeenCalledOnce();
  rerender(<StoryViewer viewer={position(uid, id)} author="阿雅" />);
  await act(async () => confirm('private-thread'));
  expect(screen.queryByRole('dialog', { name: '回覆限時動態' })).toBeNull();
  expect(compose().value).toBe('');
  expect(screen.queryByRole('link', { name: '開啟私訊' })).toBeNull();
  rerender(<StoryViewer viewer={position('writer')} author="我" />);
  expect(screen.queryByRole('button', { name: '私下回覆' })).toBeNull();
});

it('keeps the reply action off older stories and stories published with replies disabled', () => {
  const viewer = position();
  const { allowReplies, ...legacy } = viewer.group.stories[0];
  expect(allowReplies).toBe(true);
  const { rerender } = render(
    <StoryViewer
      viewer={{ ...viewer, group: { ...viewer.group, stories: [legacy] } }}
      author="阿雅"
    />,
  );
  expect(screen.queryByRole('button', { name: '私下回覆' })).toBeNull();
  rerender(<StoryViewer viewer={position('reader', 'one', false)} author="阿雅" />);
  expect(screen.queryByRole('button', { name: '私下回覆' })).toBeNull();
});
