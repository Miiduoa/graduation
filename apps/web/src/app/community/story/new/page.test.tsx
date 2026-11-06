import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { StrictMode, type ReactNode } from 'react';
import { beforeEach, expect, it, vi } from 'vitest';
import StoryComposePage from './page';

const mock = vi.hoisted(() => ({
  school: 'ncku',
  uid: 'student' as string | null,
  query: new URLSearchParams(),
  id: vi.fn(),
  publish: vi.fn(),
  upload: vi.fn(),
  replace: vi.fn(),
}));
vi.mock('@/lib/community/firestore', () => ({
  createStoryId: mock.id,
  publishStory: mock.publish,
}));
vi.mock('@/lib/community/media', async (original) => ({
  ...(await original<typeof import('@/lib/community/media')>()),
  uploadStoryMedia: mock.upload,
}));
vi.mock('next/navigation', () => ({
  usePathname: () => '/community/story/new',
  useSearchParams: () => mock.query,
  useRouter: () => ({ replace: mock.replace }),
}));
vi.mock('@/lib/useBrowsingSchoolPageContext', () => ({
  useBrowsingSchoolPageContext: () => ({
    schoolId: mock.school,
    schoolName: mock.school,
    ready: true,
  }),
}));
vi.mock('@/components/AuthGuard', () => ({
  useAuth: () => ({ user: mock.uid ? { uid: mock.uid } : null, loading: false }),
}));
vi.mock('@/components/SiteShell', () => ({
  SiteShell: ({ children }: { children: ReactNode }) => <main>{children}</main>,
}));

beforeEach(() => {
  mock.school = 'ncku';
  mock.uid = 'student';
  mock.query = new URLSearchParams();
  mock.publish.mockReset().mockResolvedValue('new-story');
  mock.upload.mockReset().mockResolvedValue({ url: 'https://example.test/image' });
  mock.id.mockReset().mockReturnValue('new-story');
  mock.replace.mockReset();
  vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:story-photo');
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
  Object.defineProperty(HTMLImageElement.prototype, 'decode', {
    value: vi.fn().mockResolvedValue(undefined),
    configurable: true,
  });
});

function chooseImage(file: File) {
  fireEvent.change(screen.getByLabelText('限動照片或影片'), { target: { files: [file] } });
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
}

it('publishes only once to the selected school with the signed-in author, palette and 24h expiry', async () => {
  mock.query = new URLSearchParams('uid=stranger&poiId=pu-library&schoolId=pu');
  render(<StoryComposePage />);
  const submit = screen.getByRole('button', { name: '發布限時動態' });
  expect(submit).toHaveProperty('disabled', true);
  fireEvent.change(screen.getByLabelText('文字內容'), { target: { value: ' 放學去打球 ' } });
  fireEvent.click(screen.getByRole('button', { name: '灰藍' }));
  const form = screen.getByRole('form', { name: '編輯限時動態' });
  const start = Date.now();
  fireEvent.submit(form);
  fireEvent.submit(form);
  await waitFor(() => expect(mock.replace).toHaveBeenCalledOnce());
  expect(mock.replace).toHaveBeenCalledWith('/community?tab=realtime&schoolId=ncku');
  expect(mock.upload).not.toHaveBeenCalled();
  expect(mock.publish).toHaveBeenCalledExactlyOnceWith({
    storyId: 'new-story',
    schoolId: 'ncku',
    authorUid: 'student',
    kind: 'text',
    text: '放學去打球',
    allowReplies: true,
    poiId: null,
    poiName: null,
    mediaUrl: null,
    bgColor: '#3e5169',
    expiresAtMs: expect.any(Number),
  }, { signal: expect.any(AbortSignal), confirmFirst: false });
  expect(mock.publish.mock.calls[0][0].expiresAtMs - start).toBeGreaterThanOrEqual(86_400_000);
  expect(mock.publish.mock.calls[0][0].expiresAtMs - Date.now()).toBeLessThanOrEqual(86_400_000);
});

it('keeps the caption, photo and reserved ID for retry after the document write fails', async () => {
  mock.publish.mockRejectedValueOnce(new Error('offline'));
  const file = new File(['jpeg'], 'campus.jpg', { type: 'image/jpeg' });
  render(<StoryComposePage />);
  chooseImage(file);
  fireEvent.click(screen.getByRole('checkbox', { name: '允許同校成員私訊回覆' }));
  await screen.findByAltText('已選取的照片');
  fireEvent.change(screen.getByLabelText('照片說明（選填）'), { target: { value: '午後校園' } });
  fireEvent.click(screen.getByRole('button', { name: '發布限時動態' }));
  await screen.findByRole('alert');
  expect(mock.replace).not.toHaveBeenCalled();
  expect(screen.getByLabelText('照片說明（選填）')).toHaveProperty('value', '午後校園');
  fireEvent.click(screen.getByRole('button', { name: '確認／重試原版本' }));
  await waitFor(() => expect(mock.replace).toHaveBeenCalledOnce());
  expect(mock.id).toHaveBeenCalledOnce();
  expect(mock.upload).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
    schoolId: 'ncku',
    storyId: 'new-story',
    uid: 'student',
    file,
  }));
  expect(mock.publish).toHaveBeenCalledTimes(2);
  expect(mock.publish.mock.calls[1][0]).toMatchObject({
    kind: 'image',
    text: '午後校園',
    allowReplies: false,
    mediaUrl: 'https://example.test/image',
    storyId: 'new-story',
  });
});

it('keeps the selected photo when a replacement is unreadable and releases superseded previews', async () => {
  render(<StoryComposePage />);
  const first = new File(['one'], 'one.jpg', { type: 'image/jpeg' });
  const second = new File(['two'], 'two.jpg', { type: 'image/jpeg' });
  vi.mocked(URL.createObjectURL)
    .mockReturnValueOnce('blob:first')
    .mockReturnValueOnce('blob:bad')
    .mockReturnValueOnce('blob:second');
  chooseImage(first);
  await screen.findByAltText('已選取的照片');
  vi.mocked(HTMLImageElement.prototype.decode).mockRejectedValueOnce(new Error('corrupt image'));
  chooseImage(second);
  await screen.findByRole('alert');
  expect(screen.getByAltText('已選取的照片').getAttribute('src')).toBe('blob:first');
  expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:bad');

  chooseImage(second);
  await waitFor(() =>
    expect(screen.getByAltText('已選取的照片').getAttribute('src')).toBe('blob:second'),
  );
  expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:first');
  fireEvent.click(screen.getByRole('button', { name: '移除照片' }));
  expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:second');
  expect(screen.getByRole('button', { name: '發布限時動態' })).toHaveProperty('disabled', true);
});

it('confirms the original version before publishing a replacement photo with a fresh story ID', async () => {
  mock.id.mockReturnValueOnce('first-story').mockReturnValueOnce('replacement');
  mock.publish.mockRejectedValueOnce(new Error('offline'));
  mock.upload
    .mockResolvedValueOnce({ url: 'https://example.test/first' })
    .mockResolvedValueOnce({ url: 'https://example.test/second' });
  render(<StoryComposePage />);
  chooseImage(new File(['first'], 'first.jpg', { type: 'image/jpeg' }));
  await screen.findByAltText('已選取的照片');
  fireEvent.click(screen.getByRole('button', { name: '發布限時動態' }));
  await screen.findByRole('alert');
  const second = new File(['second'], 'second.png', { type: 'image/png' });
  chooseImage(second);
  await waitFor(() =>
    expect(screen.getByRole('button', { name: '確認／重試原版本' })).toHaveProperty('disabled', false),
  );
  fireEvent.click(screen.getByRole('button', { name: '確認／重試原版本' }));
  await screen.findByText('上一版已發布，修改後的草稿已保留。');
  expect(mock.replace).not.toHaveBeenCalled();
  expect(mock.upload).toHaveBeenCalledTimes(1);
  expect(mock.publish.mock.calls[1][0]).toEqual(mock.publish.mock.calls[0][0]);
  fireEvent.click(screen.getByRole('button', { name: '發布修改後的草稿' }));
  await waitFor(() => expect(mock.replace).toHaveBeenCalledOnce());
  expect(mock.upload.mock.calls[1][0]).toMatchObject({
    file: second,
    storyId: 'replacement',
    uid: 'student',
  });
  expect(mock.publish.mock.calls[2][0]).toMatchObject({ mediaUrl: 'https://example.test/second' });
});

it('discards a pending upload result after the selected school changes', async () => {
  let finish!: (value: { url: string }) => void;
  mock.upload.mockReturnValueOnce(
    new Promise((resolve) => {
      finish = resolve;
    }),
  );
  const { rerender } = render(<StoryComposePage />);
  chooseImage(new File(['image'], 'one.png', { type: 'image/png' }));
  await screen.findByAltText('已選取的照片');
  fireEvent.click(screen.getByRole('button', { name: '發布限時動態' }));
  await waitFor(() => expect(mock.upload).toHaveBeenCalledOnce());
  mock.school = 'tw-pu';
  rerender(<StoryComposePage />);
  await act(async () => finish({ url: 'https://example.test/old-school' }));
  expect(mock.publish).not.toHaveBeenCalled();
  expect(mock.replace).not.toHaveBeenCalled();
  expect(screen.getByLabelText('文字內容')).toHaveProperty('value', '');
});

it('sends visitors to sign-in with the original story URL', () => {
  mock.uid = null;
  mock.query = new URLSearchParams('schoolId=ncku');
  render(<StoryComposePage />);
  expect(screen.getByRole('link', { name: '登入帳號' }).getAttribute('href')).toBe(
    '/login?returnUrl=%2Fcommunity%2Fstory%2Fnew%3FschoolId%3Dncku',
  );
  expect(screen.queryByRole('form')).toBeNull();
});

function probeVideo(duration: number, width = 320) {
  vi.spyOn(HTMLMediaElement.prototype, 'load').mockImplementation(() => {});
  vi.spyOn(HTMLMediaElement.prototype, 'src', 'set').mockImplementation(function (
    this: HTMLVideoElement,
    value: string,
  ) {
    this.setAttribute('src', value);
    Object.defineProperties(this, {
      duration: { value: duration, configurable: true },
      videoWidth: { value: width, configurable: true },
      videoHeight: { value: width, configurable: true },
    });
    queueMicrotask(() => this.dispatchEvent(new Event('loadeddata')));
  });
}

it('previews the decoded MP4, then retries the captioned video using the same upload', async () => {
  probeVideo(30);
  mock.publish.mockRejectedValueOnce(new Error('offline'));
  render(<StoryComposePage />);
  chooseImage(new File(['clip'], 'clip.mp4', { type: 'video/mp4' }));
  const preview = await screen.findByLabelText('已選取的影片');
  expect(preview).toHaveProperty('controls', true);
  expect(preview).toHaveProperty('muted', true);
  expect(screen.getByText('限時動態預覽 · 30 秒')).toBeTruthy();
  fireEvent.change(screen.getByLabelText('影片說明（選填）'), { target: { value: '社團彩排' } });
  fireEvent.click(screen.getByRole('button', { name: '發布限時動態' }));
  await screen.findByRole('alert');
  fireEvent.click(screen.getByRole('button', { name: '確認／重試原版本' }));
  await waitFor(() => expect(mock.replace).toHaveBeenCalledOnce());
  expect(mock.upload).toHaveBeenCalledTimes(1);
  expect(mock.id).toHaveBeenCalledTimes(1);
  expect(mock.publish.mock.calls[1][0]).toMatchObject({
    kind: 'video',
    storyId: 'new-story',
    text: '社團彩排',
    mediaUrl: 'https://example.test/image',
  });
});

it.each([
  [30.01, 320],
  [Infinity, 320],
  [0, 320],
  [10, 0],
])('keeps the prior photo when video duration is %s and width is %s', async (duration, width) => {
  probeVideo(duration, width);
  render(<StoryComposePage />);
  chooseImage(new File(['original'], 'photo.jpg', { type: 'image/jpeg' }));
  await screen.findByAltText('已選取的照片');
  chooseImage(new File(['bad'], 'renamed.mp4', { type: 'video/mp4' }));
  await screen.findByRole('alert');
  expect(screen.queryByLabelText('已選取的影片')).toBeNull();
  expect(screen.getByAltText('已選取的照片')).toBeTruthy();
  expect(mock.upload).not.toHaveBeenCalled();
});

it('shows byte progress, cancels in place and isolates a new upload from late callbacks', async () => {
  const first = deferred<{ url: string; path: string }>();
  const second = deferred<{ url: string; path: string }>();
  mock.upload.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
  mock.school = 'pu';
  mock.query = new URLSearchParams('poiId=pu-library');
  render(<StoryComposePage />);
  fireEvent.change(screen.getByLabelText('文字內容'), { target: { value: '原本的文字與設定' } });
  fireEvent.click(screen.getByRole('button', { name: '灰藍' }));
  fireEvent.click(screen.getByRole('checkbox', { name: '允許同校成員私訊回覆' }));
  chooseImage(new File(['0123456789'], 'photo.jpg', { type: 'image/jpeg' }));
  await screen.findByAltText('已選取的照片');
  const location = screen.getByRole('button', { name: /移除地點/ }).textContent;
  fireEvent.click(screen.getByRole('button', { name: '發布限時動態' }));
  const old = mock.upload.mock.calls[0][0];
  act(() => old.onProgress({ bytesTransferred: 3, totalBytes: 10 }));
  expect(screen.getByRole('progressbar', { name: '上傳照片進度' })).toHaveProperty('value', 3);
  expect(screen.getByText('30%')).toBeTruthy();
  const cancel = screen.getByRole('button', { name: '取消上傳' });
  cancel.focus();
  fireEvent.click(cancel);
  expect(old.signal.aborted).toBe(true);
  await waitFor(() => expect(document.activeElement).toBe(screen.getByLabelText('照片說明（選填）')));
  expect(screen.getByLabelText('照片說明（選填）')).toHaveProperty('value', '原本的文字與設定');
  expect(screen.getByRole('checkbox', { name: '允許同校成員私訊回覆' })).toHaveProperty('checked', false);
  expect(screen.getByRole('button', { name: /移除地點/ }).textContent).toBe(location);
  expect(screen.getByAltText('已選取的照片')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: '發布限時動態' }));
  const current = mock.upload.mock.calls[1][0];
  act(() => current.onProgress({ bytesTransferred: 2, totalBytes: 10 }));
  act(() => {
    old.onProgress({ bytesTransferred: 10, totalBytes: 10 });
    old.onUploaded('schools/pu/stories/new-story/image');
  });
  await act(async () => first.resolve({ url: 'https://example.test/old', path: 'schools/pu/stories/new-story/image' }));
  expect(screen.getByText('20%')).toBeTruthy();
  expect(current.signal.aborted).toBe(false);
  expect(mock.publish).not.toHaveBeenCalled();
  await act(async () => second.resolve({ url: 'https://example.test/current', path: 'schools/pu/stories/new-story/image' }));
  expect(mock.publish.mock.calls[0][0]).toMatchObject({
    text: '原本的文字與設定', allowReplies: false, bgColor: '#3e5169', poiId: 'pu-library', mediaUrl: 'https://example.test/current',
  });
  expect(mock.replace).toHaveBeenCalledTimes(1);
});

it('keeps a completed stage when cancelled after 100 percent while the URL is pending', async () => {
  const first = deferred<{ url: string; path: string }>();
  mock.upload.mockReturnValueOnce(first.promise);
  render(<StoryComposePage />);
  chooseImage(new File(['photo'], 'photo.jpg', { type: 'image/jpeg' }));
  await screen.findByAltText('已選取的照片');
  fireEvent.click(screen.getByRole('button', { name: '發布限時動態' }));
  const old = mock.upload.mock.calls[0][0];
  const path = 'schools/ncku/stories/new-story/image';
  act(() => {
    old.onUploaded(path);
    old.onProgress({ bytesTransferred: 5, totalBytes: 5 });
  });
  expect(screen.getByText('100%')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: '取消上傳' }));
  fireEvent.click(screen.getByRole('button', { name: '發布限時動態' }));
  await waitFor(() => expect(mock.replace).toHaveBeenCalledTimes(1));
  expect(mock.upload.mock.calls[1][0]).toMatchObject({ uploadedPath: path, storyId: 'new-story' });
  await act(async () => first.resolve({ url: 'https://example.test/late', path }));
  expect(mock.publish).toHaveBeenCalledTimes(1);
  expect(mock.publish.mock.calls[0][0].mediaUrl).toBe('https://example.test/image');
});

it('retries the fixed original payload twice and preserves later edits until a separate publication', async () => {
  mock.id.mockReturnValueOnce('original').mockReturnValueOnce('edited');
  mock.publish.mockRejectedValueOnce({ code: 'unavailable' }).mockRejectedValueOnce({ code: 'unavailable' });
  render(<StoryComposePage />);
  fireEvent.change(screen.getByLabelText('文字內容'), { target: { value: '首次送出的版本' } });
  fireEvent.click(screen.getByRole('button', { name: '發布限時動態' }));
  await screen.findByRole('alert');
  await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('button', { name: '確認／重試原版本' })));
  const original = mock.publish.mock.calls[0][0];
  fireEvent.change(screen.getByLabelText('文字內容'), { target: { value: '後來修改的草稿' } });
  fireEvent.click(screen.getByRole('checkbox', { name: '允許同校成員私訊回覆' }));
  fireEvent.click(screen.getByRole('button', { name: '暮紫' }));
  fireEvent.click(screen.getByRole('button', { name: '確認／重試原版本' }));
  await screen.findByRole('alert');
  fireEvent.click(screen.getByRole('button', { name: '確認／重試原版本' }));
  await screen.findByText('上一版已發布，修改後的草稿已保留。');
  expect(mock.publish.mock.calls.slice(0, 3).map((call) => call[0])).toEqual([original, original, original]);
  expect(mock.publish.mock.calls.slice(1, 3).map((call) => call[1].confirmFirst)).toEqual([true, true]);
  expect(mock.replace).not.toHaveBeenCalled();
  expect(mock.id).toHaveBeenCalledTimes(1);
  expect(screen.getByLabelText('文字內容')).toHaveProperty('value', '後來修改的草稿');
  await waitFor(() => expect(document.activeElement).toBe(screen.getByLabelText('文字內容')));
  fireEvent.click(screen.getByRole('button', { name: '發布修改後的草稿' }));
  await waitFor(() => expect(mock.replace).toHaveBeenCalledTimes(1));
  expect(mock.publish.mock.calls[3][0]).toMatchObject({ storyId: 'edited', text: '後來修改的草稿', allowReplies: false, bgColor: '#554661' });
});

it('can confirm the original photo after the edited draft is cleared completely', async () => {
  mock.publish.mockRejectedValueOnce({ code: 'unavailable' });
  render(<StoryComposePage />);
  chooseImage(new File(['photo'], 'photo.jpg', { type: 'image/jpeg' }));
  await screen.findByAltText('已選取的照片');
  fireEvent.click(screen.getByRole('button', { name: '發布限時動態' }));
  await screen.findByRole('alert');
  fireEvent.click(screen.getByRole('button', { name: '移除照片' }));
  const confirm = screen.getByRole('button', { name: '確認／重試原版本' });
  expect(confirm).toHaveProperty('disabled', false);
  fireEvent.click(confirm);
  await screen.findByText('上一版已發布，修改後的草稿已保留。');
  expect(mock.publish.mock.calls[1][0]).toEqual(mock.publish.mock.calls[0][0]);
  expect(screen.getByLabelText('文字內容')).toHaveProperty('value', '');
  expect(screen.getByRole('button', { name: '發布修改後的草稿' })).toHaveProperty('disabled', true);
  expect(mock.replace).not.toHaveBeenCalled();
});

it.each(['account', 'school'])('aborts upload and hides old draft in the first commit after switching %s', async (scope) => {
  const uploading = deferred<{ url: string; path: string }>();
  mock.upload.mockReturnValueOnce(uploading.promise);
  const view = render(<StoryComposePage />);
  fireEvent.change(screen.getByLabelText('文字內容'), { target: { value: '舊範圍的草稿' } });
  chooseImage(new File(['photo'], 'photo.jpg', { type: 'image/jpeg' }));
  await screen.findByAltText('已選取的照片');
  fireEvent.click(screen.getByRole('button', { name: '發布限時動態' }));
  const old = mock.upload.mock.calls[0][0];
  if (scope === 'account') mock.uid = 'other-student';
  else mock.school = 'tw-pu';
  view.rerender(<StoryComposePage />);
  expect(old.signal.aborted).toBe(true);
  expect(screen.getByLabelText('文字內容')).toHaveProperty('value', '');
  expect(screen.queryByAltText('已選取的照片')).toBeNull();
  act(() => old.onProgress({ bytesTransferred: 5, totalBytes: 5 }));
  await act(async () => uploading.resolve({ url: 'https://example.test/old', path: 'schools/ncku/stories/new-story/image' }));
  expect(screen.queryByRole('progressbar')).toBeNull();
  expect(mock.publish).not.toHaveBeenCalled();
  expect(mock.replace).not.toHaveBeenCalled();
});

it('ignores a late publication receipt after an account change', async () => {
  const publication = deferred<string>();
  mock.publish.mockReturnValueOnce(publication.promise);
  const view = render(<StoryComposePage />);
  fireEvent.change(screen.getByLabelText('文字內容'), { target: { value: '舊帳號發文' } });
  fireEvent.click(screen.getByRole('button', { name: '發布限時動態' }));
  const signal = mock.publish.mock.calls[0][1].signal;
  mock.uid = 'new-student';
  view.rerender(<StoryComposePage />);
  fireEvent.change(screen.getByLabelText('文字內容'), { target: { value: '新帳號草稿' } });
  await act(async () => publication.resolve('new-story'));
  expect(signal.aborted).toBe(true);
  expect(screen.getByLabelText('文字內容')).toHaveProperty('value', '新帳號草稿');
  expect(mock.replace).not.toHaveBeenCalled();
});

it('remains usable after StrictMode effect cleanup and aborts an upload on unmount', async () => {
  const uploading = deferred<{ url: string; path: string }>();
  mock.upload.mockReturnValueOnce(uploading.promise);
  const view = render(<StrictMode><StoryComposePage /></StrictMode>);
  chooseImage(new File(['photo'], 'photo.jpg', { type: 'image/jpeg' }));
  await screen.findByAltText('已選取的照片');
  fireEvent.click(screen.getByRole('button', { name: '發布限時動態' }));
  const old = mock.upload.mock.calls[0][0];
  expect(old.signal.aborted).toBe(false);
  view.unmount();
  expect(old.signal.aborted).toBe(true);
  await act(async () => uploading.resolve({ url: 'https://example.test/old', path: 'schools/ncku/stories/new-story/image' }));
  expect(mock.publish).not.toHaveBeenCalled();
  expect(mock.replace).not.toHaveBeenCalled();
});

it.each([
  { phase: 'publishing', completion: 'success' },
  { phase: 'publishing', completion: 'failure' },
  { phase: 'confirming', completion: 'success' },
  { phase: 'confirming', completion: 'failure' },
])('stops waiting during $phase and ignores a late $completion while retrying the original', async ({ phase, completion }) => {
  const old = deferred<string>();
  const current = deferred<string>();
  if (phase === 'confirming') mock.publish.mockRejectedValueOnce({ code: 'unavailable' });
  mock.publish.mockReturnValueOnce(old.promise).mockReturnValueOnce(current.promise);
  render(<StoryComposePage />);
  fireEvent.change(screen.getByLabelText('文字內容'), { target: { value: '正在提交的原版本' } });
  fireEvent.click(screen.getByRole('button', { name: '發布限時動態' }));
  if (phase === 'confirming') {
    await screen.findByRole('alert');
    fireEvent.click(screen.getByRole('button', { name: '確認／重試原版本' }));
  }
  const original = mock.publish.mock.calls[0][0];
  const oldSignal = mock.publish.mock.lastCall![1].signal;
  const stop = screen.getByRole('button', { name: '停止等待' });
  stop.focus();
  fireEvent.click(stop);
  expect(oldSignal.aborted).toBe(true);
  expect(screen.getByText('已停止等待，可稍後確認原版本是否發布。')).toBeTruthy();
  await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('button', { name: '確認／重試原版本' })));
  const edited = phase === 'confirming' && completion === 'success' ? '' : '等待期間修改的草稿';
  fireEvent.change(screen.getByLabelText('文字內容'), { target: { value: edited } });
  fireEvent.click(screen.getByRole('button', { name: '確認／重試原版本' }));
  const currentSignal = mock.publish.mock.lastCall![1].signal;
  await act(async () => {
    if (completion === 'success') old.resolve('new-story');
    else old.reject({ code: 'unavailable' });
  });
  expect(screen.getByText('正在確認或重試原版本…')).toBeTruthy();
  expect(currentSignal.aborted).toBe(false);
  expect(mock.replace).not.toHaveBeenCalled();
  expect(mock.publish.mock.calls.every((call) => call[0] === original)).toBe(true);
  await act(async () => current.resolve('new-story'));
  expect(screen.getByText('上一版已發布，修改後的草稿已保留。')).toBeTruthy();
  expect(screen.getByLabelText('文字內容')).toHaveProperty('value', edited);
  expect(mock.id).toHaveBeenCalledTimes(1);
  expect(mock.replace).not.toHaveBeenCalled();
});

it('describes a stop at the upload-to-publication boundary as stopping its pending confirmation', async () => {
  const upload = deferred<{ url: string; path: string }>();
  const publication = deferred<string>();
  mock.upload.mockReturnValueOnce(upload.promise);
  mock.publish.mockReturnValueOnce(publication.promise);
  render(<StoryComposePage />);
  chooseImage(new File(['photo'], 'photo.jpg', { type: 'image/jpeg' }));
  await screen.findByAltText('已選取的照片');
  fireEvent.click(screen.getByRole('button', { name: '發布限時動態' }));
  const previousButton = screen.getByRole('button', { name: '取消上傳' });
  await act(async () => {
    upload.resolve({ url: 'https://example.test/photo', path: 'schools/ncku/stories/new-story/image' });
    await Promise.resolve();
    expect(mock.publish).toHaveBeenCalledTimes(1);
    fireEvent.click(previousButton);
  });
  expect(screen.getByText('已停止等待，可稍後確認原版本是否發布。')).toBeTruthy();
  expect(mock.publish.mock.calls[0][1].signal.aborted).toBe(true);
  await act(async () => publication.resolve('new-story'));
  expect(mock.replace).not.toHaveBeenCalled();
  expect(screen.getByRole('button', { name: '確認／重試原版本' })).toHaveProperty('disabled', false);
});
