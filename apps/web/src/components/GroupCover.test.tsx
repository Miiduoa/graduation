import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { GroupCover } from './GroupCover';
const state = vi.hoisted(() => ({ upload: vi.fn(), write: vi.fn() }));
vi.mock('@/lib/firebase', () => ({ getDb: () => ({}) }));
vi.mock('firebase/firestore', () => ({
  doc: (...args: unknown[]) => args,
  updateDoc: state.write,
}));
vi.mock('@/lib/privateFiles', async () => ({
  ...(await vi.importActual('@/lib/privateFiles')),
  uploadPrivateFile: state.upload,
}));
vi.mock('./PrivateImage', () => ({
  PrivateImage: ({ src }: { src: string }) => <span>{src}</span>,
}));
afterEach(() => {
  delete process.env.NEXT_PUBLIC_FILE_STORAGE_BACKEND;
  vi.clearAllMocks();
});
it.each(['member', 'owner'])('hides upload when R2 is off (%s)', (role) => {
  render(<GroupCover groupId="g" role={role} />);
  expect(screen.queryByLabelText('更換群組封面')).toBeNull();
});
it('only offers R2 cover upload to managers and persists its object path', async () => {
  process.env.NEXT_PUBLIC_FILE_STORAGE_BACKEND = 'r2';
  const view = render(<GroupCover groupId="g" role="member" />);
  expect(screen.queryByLabelText('更換群組封面')).toBeNull();
  view.rerender(<GroupCover groupId="g" role="admin" />);
  fireEvent.change(screen.getByLabelText('更換群組封面'), {
    target: { files: [new File(['image'], 'a.png', { type: 'image/png' })] },
  });
  await waitFor(() =>
    expect(state.write).toHaveBeenCalledWith(expect.anything(), { coverUrl: 'groups/g/cover.png' }),
  );
  expect(state.upload).toHaveBeenCalledWith(
    expect.objectContaining({ path: 'groups/g/cover.png' }),
  );
});
