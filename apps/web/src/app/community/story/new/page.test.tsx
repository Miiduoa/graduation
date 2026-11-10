import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
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
  uploadStoryImage: mock.upload,
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
  fireEvent.change(screen.getByLabelText('限動照片'), { target: { files: [file] } });
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
    poiId: null,
    poiName: null,
    mediaUrl: null,
    bgColor: '#3e5169',
    expiresAtMs: expect.any(Number),
  });
  expect(mock.publish.mock.calls[0][0].expiresAtMs - start).toBeGreaterThanOrEqual(86_400_000);
  expect(mock.publish.mock.calls[0][0].expiresAtMs - Date.now()).toBeLessThanOrEqual(86_400_000);
});

it('keeps the caption, photo and reserved ID for retry after the document write fails', async () => {
  mock.publish.mockRejectedValueOnce(new Error('offline'));
  const file = new File(['jpeg'], 'campus.jpg', { type: 'image/jpeg' });
  render(<StoryComposePage />);
  chooseImage(file);
  await screen.findByAltText('已選取的照片');
  fireEvent.change(screen.getByLabelText('照片說明（選填）'), { target: { value: '午後校園' } });
  fireEvent.click(screen.getByRole('button', { name: '發布限時動態' }));
  await screen.findByRole('alert');
  expect(mock.replace).not.toHaveBeenCalled();
  expect(screen.getByLabelText('照片說明（選填）')).toHaveProperty('value', '午後校園');
  fireEvent.click(screen.getByRole('button', { name: '發布限時動態' }));
  await waitFor(() => expect(mock.replace).toHaveBeenCalledOnce());
  expect(mock.id).toHaveBeenCalledOnce();
  expect(mock.upload).toHaveBeenCalledExactlyOnceWith({
    schoolId: 'ncku',
    storyId: 'new-story',
    uid: 'student',
    file,
  });
  expect(mock.publish).toHaveBeenCalledTimes(2);
  expect(mock.publish.mock.calls[1][0]).toMatchObject({
    kind: 'image',
    text: '午後校園',
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

it('reserves a fresh story for a different photo after an unsuccessful publication', async () => {
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
    expect(screen.getByRole('button', { name: '發布限時動態' })).toHaveProperty('disabled', false),
  );
  fireEvent.click(screen.getByRole('button', { name: '發布限時動態' }));
  await waitFor(() => expect(mock.replace).toHaveBeenCalledOnce());
  expect(mock.upload.mock.calls[1][0]).toMatchObject({
    file: second,
    storyId: 'replacement',
    uid: 'student',
  });
  expect(mock.publish.mock.calls[1][0]).toMatchObject({ mediaUrl: 'https://example.test/second' });
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
  expect(screen.getByRole('link', { name: '連線學校帳號' }).getAttribute('href')).toBe(
    '/login?reconnect=school&returnUrl=%2Fcommunity%2Fstory%2Fnew%3FschoolId%3Dncku',
  );
  expect(screen.getByRole('link', { name: '前往公開交流' }).getAttribute('href')).toBe('/social?schoolId=ncku');
  expect(screen.queryByRole('form')).toBeNull();
});

it('confirms a previously published private image after claim succeeds on retry', async () => {
  const files = await import('@/lib/privateFiles');
  const claim = vi.spyOn(files, 'claimPrivateFile').mockResolvedValue(undefined);
  mock.upload.mockResolvedValue({ url: 'schools/ncku/stories/new-story/image.jpg' });
  mock.publish.mockRejectedValueOnce(new Error('response lost')).mockResolvedValueOnce('new-story');
  render(<StoryComposePage />);
  try {
    chooseImage(new File(['image'], 'photo.jpg', { type: 'image/jpeg' }));
    await screen.findByAltText('已選取的照片');
    fireEvent.click(screen.getByRole('button', { name: '發布限時動態' }));
    await screen.findByRole('alert');
    fireEvent.click(screen.getByRole('button', { name: '發布限時動態' }));
    await waitFor(() => expect(mock.replace).toHaveBeenCalledOnce());
    expect(claim).toHaveBeenCalledTimes(2);
    expect(claim).toHaveBeenLastCalledWith('schools/ncku/stories/new-story/image.jpg', 'schools/ncku/stories/new-story');
    expect(mock.publish).toHaveBeenCalledTimes(2);
    expect(mock.publish.mock.calls[1][0]).toEqual({ ...mock.publish.mock.calls[0][0], expiresAtMs: expect.any(Number) });
    expect(mock.upload).toHaveBeenCalledOnce();
  } finally { claim.mockRestore(); }
});

it('accepts an image exactly at the shared 10 MiB boundary', async () => {
  render(<StoryComposePage />);
  const file = new File([new Uint8Array(10 * 1024 * 1024)], 'photo.jpg', { type: 'image/jpeg' });
  chooseImage(file);
  await screen.findByAltText('已選取的照片');
  expect(screen.queryByRole('alert')).toBeNull();
});
