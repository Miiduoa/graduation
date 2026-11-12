import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { DmPhotoComposer } from './DmPhotos';
const runtime = vi.hoisted(() => ({ configured: true, upload: vi.fn(), confirm: vi.fn() }));
vi.mock('@/lib/cloudFunctions', () => ({ areFunctionsConfigured: () => runtime.configured }));
vi.mock('@/lib/privateMessages', () => ({ newPrivateMessageId: () => 'photo-message-000000001' }));
vi.mock('@/lib/dmPhotos', async (original) => ({
  ...await original<typeof import('@/lib/dmPhotos')>(),
  uploadDmPhoto: runtime.upload, confirmDmPhoto: runtime.confirm,
}));
beforeEach(() => {
  vi.resetAllMocks();
  runtime.configured = true;
  URL.createObjectURL = vi.fn(() => 'blob:preview');
  URL.revokeObjectURL = vi.fn();
});
const scope = { viewerUid: 'alice', schoolId: 'pu', peerUid: 'bob', conversationId: 'dm_pu_alice_bob' };
it('retains the photo button and honestly explains Spark availability', () => {
  runtime.configured = false;
  render(<DmPhotoComposer scope={scope} ready onSent={vi.fn()} />);
  fireEvent.click(screen.getByRole('button', { name: '加入照片' }));
  expect(screen.getByRole('alert').textContent).toBe('照片私訊尚未開通');
  expect(screen.getByRole('button', { name: '加入照片' })).toBeTruthy();
  expect(runtime.upload).not.toHaveBeenCalled();
});
it.each(['upload', 'confirm'] as const)('reports an absent %s callable without fake success', async (stage) => {
  const onSent = vi.fn();
  runtime.upload.mockResolvedValue('conversations/dm_pu_alice_bob/photos/p/photo.jpg');
  runtime[stage].mockRejectedValue({ code: 'functions/not-found' });
  render(<DmPhotoComposer scope={scope} ready onSent={onSent} />);
  fireEvent.change(screen.getByLabelText('選擇私訊照片'), {
    target: { files: [new File(['image'], 'photo.jpg', { type: 'image/jpeg' })] },
  });
  fireEvent.load(screen.getByRole('img', { name: '待傳送照片預覽' }));
  fireEvent.click(screen.getByRole('button', { name: '傳送照片' }));
  await waitFor(() => expect(screen.getByRole('alert').textContent).toBe('照片私訊尚未開通'));
  expect(onSent).not.toHaveBeenCalled();
  expect(screen.queryByText('照片已傳送')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: '移除照片' }));
  expect(screen.getByRole('button', { name: '加入照片' })).toBeTruthy();
});
