import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { DmPhotoComposer } from './DmPhotos';
const runtime = vi.hoisted(() => ({ upload: vi.fn(), confirm: vi.fn() }));
vi.mock('@/lib/privateMessages', () => ({ newPrivateMessageId: () => 'photo-message-000000001' }));
vi.mock('@/lib/dmPhotos', async (original) => ({
  ...await original<typeof import('@/lib/dmPhotos')>(),
  uploadDmPhoto: runtime.upload, confirmDmPhoto: runtime.confirm,
}));
beforeEach(() => {
  vi.resetAllMocks();
  URL.createObjectURL = vi.fn(() => 'blob:preview');
  URL.revokeObjectURL = vi.fn();
});
const scope = { viewerUid: 'alice', schoolId: 'pu', peerUid: 'bob', conversationId: 'dm_pu_alice_bob' };
it('keeps the photo button even without a custom Functions URL', () => {
  render(<DmPhotoComposer scope={scope} ready onSent={vi.fn()} />);
  fireEvent.click(screen.getByRole('button', { name: '加入照片' }));
  expect(screen.queryByRole('alert')).toBeNull();
  expect(screen.getByRole('button', { name: '加入照片' })).toBeTruthy();
  expect(screen.getByLabelText('選擇私訊照片')).toBeTruthy();
});
it('shows 照片私訊尚未開通 on send without uploading', async () => {
  const onSent = vi.fn();
  render(<DmPhotoComposer scope={scope} ready onSent={onSent} />);
  fireEvent.change(screen.getByLabelText('選擇私訊照片'), {
    target: { files: [new File(['image'], 'photo.jpg', { type: 'image/jpeg' })] },
  });
  fireEvent.load(screen.getByRole('img', { name: '待傳送照片預覽' }));
  fireEvent.click(screen.getByRole('button', { name: '傳送照片' }));
  await waitFor(() => expect(screen.getByRole('alert').textContent).toBe('照片私訊尚未開通'));
  expect(runtime.upload).not.toHaveBeenCalled();
  expect(runtime.confirm).not.toHaveBeenCalled();
  expect(onSent).not.toHaveBeenCalled();
  expect(screen.queryByText('照片已傳送')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: '移除照片' }));
  expect(screen.getByRole('button', { name: '加入照片' })).toBeTruthy();
});
