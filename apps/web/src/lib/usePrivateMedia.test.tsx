import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { usePrivateMedia } from './usePrivateMedia';
import { PrivateImage } from '@/components/PrivateImage';
const state = vi.hoisted(() => ({ resolve: vi.fn() }));
vi.mock('./privateFiles', async () => ({
  isPrivateFileObjectPath: (await import('@campus/shared/src/privateFileMedia'))
    .isPrivateFileObjectPath,
  resolvePrivateMedia: state.resolve,
}));
function Media({ value }: { value: string }) {
  const { url, loading } = usePrivateMedia(value);
  return <span>{url || (loading ? '讀取中' : '佔位')}</span>;
}
afterEach(() => vi.restoreAllMocks());
it('uses old HTTPS media directly', () => {
  render(<Media value="https://example.com/image" />);
  expect(screen.getByText('https://example.com/image')).toBeTruthy();
});
it('uses downloaded blob URLs and revokes them on close', async () => {
  state.resolve.mockResolvedValue(new Blob(['image']));
  vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:private');
  const revoke = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
  const view = render(<Media value="schools/pu/stories/s/image" />);
  await waitFor(() => expect(screen.getByText('blob:private')).toBeTruthy());
  view.unmount();
  expect(revoke).toHaveBeenCalledWith('blob:private');
});
it('shows a placeholder for unavailable private media', async () => {
  state.resolve.mockResolvedValue(null);
  render(<Media value="schools/pu/stories/s/image" />);
  await waitFor(() => expect(state.resolve).toHaveBeenCalled());
  expect(screen.getByText('佔位')).toBeTruthy();
});

it.each(['groups/g/cover.png', 'groups/g/cover.12345678-1234-1234-1234-123456789abc.png'])('downloads cover paths as blobs (%s)', async (path) => {
  state.resolve.mockResolvedValue(new Blob(['image']));
  vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:cover');
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
  const view = render(<Media value={path} />);
  await waitFor(() => expect(screen.getByText('blob:cover')).toBeTruthy());
  expect(state.resolve).toHaveBeenCalledWith(path);
  view.unmount();
});

it('does not redisplay revoked media or accept a late result when switching A to B to A', async () => {
  const pathA = 'groups/a/cover.png';
  const pathB = 'groups/b/cover.png';
  let finishB!: (value: Blob) => void;
  let finishA!: (value: Blob | null) => void;
  state.resolve
    .mockResolvedValueOnce(new Blob(['A']))
    .mockReturnValueOnce(new Promise((resolve) => { finishB = resolve; }))
    .mockReturnValueOnce(new Promise((resolve) => { finishA = resolve; }));
  const create = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:first');
  const revoke = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
  const view = render(<Media value={pathA} />);
  await screen.findByText('blob:first');
  view.rerender(<Media value={pathB} />);
  expect(revoke).toHaveBeenCalledWith('blob:first');
  view.rerender(<Media value={pathA} />);
  expect(screen.getByText('讀取中')).toBeTruthy();
  await act(async () => { finishB(new Blob(['B'])); });
  expect(create).toHaveBeenCalledTimes(1);
  expect(screen.getByText('讀取中')).toBeTruthy();
  await act(async () => { finishA(null); });
  expect(screen.getByText('佔位')).toBeTruthy();
});

it('shows a meaningful preview as loading, then handles a decode failure without announcing decorative thumbnails', async () => {
  let finish!: (value: Blob) => void;
  state.resolve.mockReturnValueOnce(new Promise((resolve) => { finish = resolve; }));
  vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:preview');
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
  const props = { src: 'groups/a/cover.png', alt: '群組封面', width: 360, height: 240, className: 'responsive-preview' };
  const view = render(<PrivateImage {...props} />);
  const frame = screen.getByRole('status').parentElement!;
  expect(frame.classList.contains('responsive-preview')).toBe(true);
  expect(frame.style.aspectRatio).toBe('360 / 240');
  expect(screen.getByRole('status').textContent).toBe('正在載入照片…');
  await act(async () => { finish(new Blob(['broken'])); });
  expect(screen.getByAltText('群組封面').parentElement).toBe(frame);
  fireEvent.error(screen.getByAltText('群組封面'));
  expect(screen.getByRole('status').parentElement).toBe(frame);
  expect(screen.getByRole('status').textContent).toBe('照片暫時無法顯示');
  view.rerender(<PrivateImage {...props} alt="" />);
  expect(screen.queryByRole('status')).toBeNull();
});
