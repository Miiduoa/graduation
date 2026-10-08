import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { NuniError, type NuniMaterial, type NuniWorkspace } from '@campus/shared/src/nuni';
import { CourseMaterials } from './CourseMaterials';

const state = vi.hoisted(() => ({ context: 'session-a', request: vi.fn(), refresh: vi.fn() }));
vi.mock('./Session', () => ({
  browserRequest: state.request,
  useNuniSession: () => ({
    session: {
      context: state.context,
      platformAccountId: 'pa_11111111-1111-4111-8111-111111111111',
    },
    pendingLogout: false,
    refresh: state.refresh,
  }),
}));
const workspace: NuniWorkspace = {
  id: 'cw_11111111-1111-4111-8111-111111111111',
  title: '資料庫',
  state: 'active',
  memberRole: 'owner-teacher',
};
const material: NuniMaterial = {
  id: 'cwm_11111111-1111-4111-8111-111111111111',
  workspaceId: workspace.id,
  title: '關聯與主鍵',
  body: '閱讀說明\nhttps://example.test/reading\njavascript:alert(1)',
  unitId: null,
  unitTitle: null,
  createdByPlatformAccountId: 'pa_11111111-1111-4111-8111-111111111111',
  createdAt: '2026-10-08T08:00:00.000Z',
};
const list = () => ({ materials: [material] });
beforeEach(() => {
  vi.clearAllMocks();
  state.context = 'session-a';
  state.request.mockResolvedValue(list());
});

it('renders real reading content and safe links for students without publication controls', async () => {
  render(<CourseMaterials workspace={{ ...workspace, memberRole: 'student' }} />);
  expect(await screen.findByRole('heading', { name: '關聯與主鍵' })).toBeTruthy();
  const link = screen.getByRole('link', { name: 'https://example.test/reading' });
  expect(link.getAttribute('href')).toBe('https://example.test/reading');
  expect(link.getAttribute('rel')).toBe('noopener noreferrer');
  expect(screen.queryByRole('link', { name: /javascript/ })).toBeNull();
  expect(screen.queryByText('發布教材')).toBeNull();
  expect(state.request).toHaveBeenCalledWith(
    `class-workspaces/${workspace.id}/materials`,
    'session-a',
    undefined,
  );
});

it('publishes only text and links, then displays the confirmed material', async () => {
  let stored: NuniMaterial | null = null;
  state.request.mockImplementation(async (_path, _context, input) => {
    if (input) {
      stored = { ...material, title: input.title, body: input.body };
      return stored;
    }
    return { materials: stored ? [stored] : [] };
  });
  render(<CourseMaterials workspace={workspace} />);
  await screen.findByText(/目前還沒有教材/);
  fireEvent.change(screen.getByLabelText('教材標題'), { target: { value: '閱讀材料' } });
  fireEvent.change(screen.getByLabelText('教材內容或參考連結'), {
    target: { value: 'https://example.test/book' },
  });
  fireEvent.submit(screen.getByLabelText('教材標題').closest('form')!);
  expect(await screen.findByText('已發布「閱讀材料」。')).toBeTruthy();
  expect(screen.getByRole('heading', { name: '閱讀材料' })).toBeTruthy();
  expect(state.request).toHaveBeenCalledWith(
    `class-workspaces/${workspace.id}/materials`,
    'session-a',
    expect.objectContaining({
      title: '閱讀材料',
      body: 'https://example.test/book',
      idempotencyKey: expect.any(String),
    }),
  );
  expect(document.querySelector('input[type="file"]')).toBeNull();
});

it('preserves the same uncertain payload and key when confirming a lost publication response', async () => {
  state.request
    .mockResolvedValueOnce({ materials: [] })
    .mockRejectedValueOnce(new TypeError('connection lost'))
    .mockResolvedValueOnce(material)
    .mockResolvedValue(list());
  render(<CourseMaterials workspace={workspace} />);
  await screen.findByText(/目前還沒有教材/);
  const title = screen.getByLabelText('教材標題') as HTMLInputElement;
  fireEvent.change(title, { target: { value: '關聯與主鍵' } });
  fireEvent.change(screen.getByLabelText('教材內容或參考連結'), {
    target: { value: material.body },
  });
  fireEvent.submit(title.closest('form')!);
  await screen.findByRole('button', { name: '確認送出結果' });
  expect(title.closest('fieldset')?.disabled).toBe(true);
  const input = state.request.mock.calls[1][2];
  fireEvent.submit(title.closest('form')!);
  await screen.findByText('已發布「關聯與主鍵」。');
  expect(state.request.mock.calls[2][2]).toEqual(input);
});

it('keeps rejected publication editable and never claims success', async () => {
  state.request
    .mockResolvedValueOnce({ materials: [] })
    .mockRejectedValueOnce(new NuniError(403, 'CLASS_WORKSPACE_TEACHER_REQUIRED'));
  render(<CourseMaterials workspace={workspace} />);
  await screen.findByText(/目前還沒有教材/);
  const title = screen.getByLabelText('教材標題') as HTMLInputElement;
  fireEvent.change(title, { target: { value: '尚未發布' } });
  fireEvent.change(screen.getByLabelText('教材內容或參考連結'), { target: { value: '內容' } });
  fireEvent.submit(title.closest('form')!);
  await screen.findByRole('alert');
  expect(title.value).toBe('尚未發布');
  expect(title.closest('fieldset')?.disabled).toBe(false);
  expect(screen.queryByText(/已發布「/)).toBeNull();
});

it('separates a failed read from an empty course and offers a working retry', async () => {
  state.request
    .mockRejectedValueOnce(new Error('offline'))
    .mockResolvedValueOnce({ materials: [] });
  render(<CourseMaterials workspace={workspace} />);
  await screen.findByRole('alert');
  expect(screen.queryByText(/目前還沒有教材/)).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: '更新教材' }));
  expect(await screen.findByText(/目前還沒有教材/)).toBeTruthy();
});

it('discards a late material read after the authenticated session changes', async () => {
  let finish!: (value: unknown) => void;
  state.request
    .mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    )
    .mockResolvedValueOnce({ materials: [] });
  const view = render(<CourseMaterials workspace={workspace} />);
  await waitFor(() => expect(state.request).toHaveBeenCalledTimes(1));
  state.context = 'session-b';
  view.rerender(<CourseMaterials workspace={workspace} />);
  await screen.findByText(/目前還沒有教材/);
  await act(async () => finish(list()));
  expect(screen.queryByRole('heading', { name: '關聯與主鍵' })).toBeNull();
});

it('does not reappear with an old publication after switching accounts', async () => {
  let finish!: (value: unknown) => void;
  state.request
    .mockResolvedValueOnce({ materials: [] })
    .mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    )
    .mockResolvedValueOnce({ materials: [] });
  const view = render(<CourseMaterials workspace={workspace} />);
  await screen.findByText(/目前還沒有教材/);
  fireEvent.change(screen.getByLabelText('教材標題'), { target: { value: material.title } });
  fireEvent.change(screen.getByLabelText('教材內容或參考連結'), {
    target: { value: material.body },
  });
  fireEvent.submit(screen.getByLabelText('教材標題').closest('form')!);
  await waitFor(() => expect(state.request).toHaveBeenCalledTimes(2));
  state.context = 'session-b';
  view.rerender(<CourseMaterials workspace={workspace} />);
  await act(async () => finish(material));
  expect(screen.queryByText(/已發布「/)).toBeNull();
  expect(screen.queryByRole('heading', { name: material.title })).toBeNull();
});

it('keeps archived course materials readable without publication controls', async () => {
  render(<CourseMaterials workspace={{ ...workspace, state: 'archived' }} />);
  await screen.findByRole('heading', { name: material.title });
  expect(screen.getByText('課程已封存，教材保留供成員閱讀。')).toBeTruthy();
  expect(screen.queryByLabelText('教材標題')).toBeNull();
});

it.each([403, 404])(
  'clears materials and teacher controls when refreshed access returns %i',
  async (status) => {
    state.request
      .mockResolvedValueOnce(list())
      .mockRejectedValueOnce(new NuniError(status, 'REQUEST_FAILED'));
    render(<CourseMaterials workspace={workspace} />);
    await screen.findByRole('heading', { name: material.title });
    fireEvent.click(screen.getByRole('button', { name: '更新教材' }));
    await screen.findByRole('alert');
    expect(screen.queryByRole('heading', { name: material.title })).toBeNull();
    expect(screen.queryByLabelText('教材標題')).toBeNull();
    expect((screen.getByRole('button', { name: '更新教材' }) as HTMLButtonElement).disabled).toBe(
      true,
    );
  },
);

it('ignores a stale read failure after a newer publication and refresh finish', async () => {
  let fail!: (reason: unknown) => void;
  state.request
    .mockResolvedValueOnce({ materials: [] })
    .mockImplementationOnce(
      () =>
        new Promise((_resolve, reject) => {
          fail = reject;
        }),
    )
    .mockResolvedValueOnce(material)
    .mockResolvedValueOnce(list());
  render(<CourseMaterials workspace={workspace} />);
  await screen.findByText(/目前還沒有教材/);
  fireEvent.click(screen.getByRole('button', { name: '更新教材' }));
  fireEvent.change(screen.getByLabelText('教材標題'), { target: { value: material.title } });
  fireEvent.change(screen.getByLabelText('教材內容或參考連結'), {
    target: { value: material.body },
  });
  fireEvent.submit(screen.getByLabelText('教材標題').closest('form')!);
  await screen.findByText(`已發布「${material.title}」。`);
  await act(async () => fail(new Error('old request failed')));
  expect(screen.queryByRole('alert')).toBeNull();
  expect(screen.getByRole('heading', { name: material.title })).toBeTruthy();
});
