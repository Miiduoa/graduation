import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { CreatorCardPanel } from './CreatorCardPanel';

const mock = vi.hoisted(() => ({ read: vi.fn(), save: vi.fn() }));
vi.mock('@/lib/community/creatorCard', () => ({
  readCreatorCard: mock.read,
  saveCreatorCard: mock.save,
}));

beforeEach(() => {
  vi.clearAllMocks();
  mock.read.mockResolvedValue(null);
  mock.save.mockResolvedValue({ headline: '校園攝影', bio: '分享校園生活', linkUrl: '' });
});

it('allows only the owner to edit and confirms a published biography', async () => {
  render(<CreatorCardPanel schoolId="pu" ownerUid="alice" own />);
  fireEvent.click(await screen.findByRole('button', { name: '建立社群簡介' }));
  fireEvent.change(screen.getByRole('textbox', { name: '一句話介紹' }), { target: { value: '校園攝影' } });
  fireEvent.change(screen.getByRole('textbox', { name: '個人簡介' }), { target: { value: '分享校園生活' } });
  fireEvent.click(screen.getByRole('button', { name: '儲存簡介' }));
  await waitFor(() => expect(mock.save).toHaveBeenCalledWith('pu', 'alice', {
    headline: '校園攝影', bio: '分享校園生活', linkUrl: '',
  }));
  await screen.findByText('社群簡介已儲存，所屬校園成員可以看到。');
  expect(screen.getByText('校園攝影')).toBeTruthy();
  expect(screen.queryByRole('form', { name: '編輯社群簡介' })).toBeNull();
});

it('keeps the draft and does not show fake success if saving fails', async () => {
  mock.save.mockRejectedValueOnce(new Error('permission-denied'));
  render(<CreatorCardPanel schoolId="pu" ownerUid="alice" own />);
  fireEvent.click(await screen.findByRole('button', { name: '建立社群簡介' }));
  fireEvent.change(screen.getByRole('textbox', { name: '個人簡介' }), { target: { value: '不要遺失的草稿' } });
  fireEvent.click(screen.getByRole('button', { name: '儲存簡介' }));
  await screen.findByText(/已保留你輸入的內容/);
  expect((screen.getByRole('textbox', { name: '個人簡介' }) as HTMLTextAreaElement).value).toBe('不要遺失的草稿');
  expect(screen.queryByText('社群簡介已儲存，所屬校園成員可以看到。')).toBeNull();
});

it('shows the published card to a peer without editor or private data', async () => {
  mock.read.mockResolvedValue({
    headline: '校園攝影', bio: '分享校園生活',
    linkUrl: 'https://example.org/me', phone: 'private',
  });
  render(<CreatorCardPanel schoolId="pu" ownerUid="alice" own={false} />);
  expect(await screen.findByText('分享校園生活')).toBeTruthy();
  expect(screen.queryByRole('button', { name: /編輯社群簡介/ })).toBeNull();
  expect(screen.queryByText('private')).toBeNull();
  const link = screen.getByRole('link', { name: '查看作品連結' });
  expect(link.getAttribute('href')).toBe('https://example.org/me');
  expect(link.getAttribute('rel')).toMatch(/noopener/);
});

it('allows retry after failed read, without treating access errors as empty cards', async () => {
  mock.read.mockRejectedValueOnce(new Error('permission-denied')).mockResolvedValueOnce(null);
  render(<CreatorCardPanel schoolId="pu" ownerUid="alice" own />);
  expect(await screen.findByRole('alert')).toBeTruthy();
  expect(screen.queryByRole('button', { name: '建立社群簡介' })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: '重新讀取' }));
  await screen.findByRole('button', { name: '建立社群簡介' });
  expect(mock.read).toHaveBeenCalledTimes(2);
});
