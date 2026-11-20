import { render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { usePrivateMedia } from './usePrivateMedia';
const state = vi.hoisted(() => ({ resolve: vi.fn() }));
vi.mock('./privateFiles', async () => ({
  isPrivateFileObjectPath: (await import('@campus/shared/src/privateFileMedia'))
    .isPrivateFileObjectPath,
  resolvePrivateMedia: state.resolve,
}));
function Media({ value }: { value: string }) {
  const url = usePrivateMedia(value);
  return <span>{url || '佔位'}</span>;
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
