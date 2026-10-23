import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
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
const list = () => ({ materials: [material], nextCursor: null });
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
    `class-workspaces/${workspace.id}/materials/page`,
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
    return { materials: stored ? [stored] : [], nextCursor: null };
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

it('publishes materials to the teacher-selected chapter using the original course API', async () => {
  const unitId = 'cwu_22222222-2222-4222-8222-222222222222';
  const unit = {
    id: unitId,
    workspaceId: workspace.id,
    title: '第二章',
    position: 1,
    createdAt: material.createdAt,
  };
  let saved: NuniMaterial | null = null;
  state.request.mockImplementation(async (_path, _context, input) => {
    if (input) {
      saved = { ...material, title: input.title, body: input.body, unitId, unitTitle: unit.title };
      return saved;
    }
    return { materials: saved ? [saved] : [], nextCursor: null };
  });
  render(<CourseMaterials workspace={workspace} units={[unit]} />);
  await screen.findByText(/目前還沒有教材/);
  fireEvent.change(screen.getByLabelText('教材標題'), { target: { value: '章節閱讀' } });
  fireEvent.change(screen.getByLabelText('教材內容或參考連結'), { target: { value: '內容' } });
  fireEvent.change(screen.getByLabelText('所屬章節（選填）'), { target: { value: unitId } });
  fireEvent.submit(screen.getByLabelText('教材標題').closest('form')!);
  await screen.findByText('已發布「章節閱讀」。');
  expect(state.request).toHaveBeenCalledWith(
    `class-workspaces/${workspace.id}/materials`,
    'session-a',
    expect.objectContaining({ unitId, idempotencyKey: expect.any(String) }),
  );
  expect(within(screen.getByRole('article', { name: '章節閱讀' })).getByText('第二章')).toBeTruthy();
});

it('preserves the same uncertain payload and key when confirming a lost publication response', async () => {
  state.request
    .mockResolvedValueOnce({ materials: [], nextCursor: null })
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
    .mockResolvedValueOnce({ materials: [], nextCursor: null })
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
    .mockResolvedValueOnce({ materials: [], nextCursor: null });
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
    .mockResolvedValueOnce({ materials: [], nextCursor: null });
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
    .mockResolvedValueOnce({ materials: [], nextCursor: null })
    .mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    )
    .mockResolvedValueOnce({ materials: [], nextCursor: null });
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
    .mockResolvedValueOnce({ materials: [], nextCursor: null })
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

const olderMaterial: NuniMaterial = {
  ...material,
  id: 'cwm_22222222-2222-4222-8222-222222222222',
  title: '較早的閱讀',
  createdAt: '2026-10-01T08:00:00.000Z',
};
const firstPage = () => ({ materials: [material], nextCursor: 'older-page' });
function deferred() {
  let resolve!: (value: unknown) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
}

it('appends older materials once, forwards the cursor, and removes pagination at the end', async () => {
  state.request.mockResolvedValueOnce(firstPage()).mockResolvedValueOnce({
    materials: [material, olderMaterial],
    nextCursor: null,
  });
  render(<CourseMaterials workspace={workspace} />);
  fireEvent.click(await screen.findByRole('button', { name: '載入較早教材' }));
  await screen.findByRole('heading', { name: olderMaterial.title });
  expect(screen.getAllByRole('heading', { name: material.title })).toHaveLength(1);
  expect(state.request).toHaveBeenLastCalledWith(
    `class-workspaces/${workspace.id}/materials/page`,
    'session-a',
    undefined,
    undefined,
    { cursor: 'older-page' },
  );
  expect(screen.queryByRole('button', { name: '載入較早教材' })).toBeNull();
  expect(screen.queryByText(/最近 100 則/)).toBeNull();
});

it('preserves rows and the retry cursor after a page failure and prevents duplicate page requests', async () => {
  const pending = deferred();
  state.request.mockResolvedValueOnce(firstPage())
    .mockReturnValueOnce(pending.promise)
    .mockResolvedValueOnce({ materials: [olderMaterial], nextCursor: null });
  render(<CourseMaterials workspace={workspace} />);
  const button = await screen.findByRole('button', { name: '載入較早教材' });
  act(() => { fireEvent.click(button); fireEvent.click(button); });
  expect(state.request).toHaveBeenCalledTimes(2);
  await act(async () => pending.reject(new Error('offline')));
  expect(screen.getByRole('heading', { name: material.title })).toBeTruthy();
  expect(screen.queryByText(/目前還沒有教材/)).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: '重試載入較早教材' }));
  await screen.findByRole('heading', { name: olderMaterial.title });
  expect(state.request.mock.calls[2]).toEqual(state.request.mock.calls[1]);
  expect(screen.queryByRole('alert')).toBeNull();
});

it('keeps loaded materials but requires a fresh first page after an invalid cursor', async () => {
  state.request.mockResolvedValueOnce(firstPage())
    .mockRejectedValueOnce(new NuniError(422, 'CLASS_WORKSPACE_MATERIAL_CURSOR_INVALID'))
    .mockResolvedValueOnce(list());
  render(<CourseMaterials workspace={workspace} />);
  fireEvent.click(await screen.findByRole('button', { name: '載入較早教材' }));
  expect((await screen.findByRole('alert')).textContent).toContain('請更新教材後再試');
  expect(screen.getByRole('heading', { name: material.title })).toBeTruthy();
  expect(screen.queryByRole('button', { name: /較早教材/ })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: '更新教材' }));
  await waitFor(() => expect(screen.queryByRole('alert')).toBeNull());
  expect(state.request).toHaveBeenLastCalledWith(
    `class-workspaces/${workspace.id}/materials/page`, 'session-a', undefined,
  );
});

it.each([403, 404])('clears all content and disables operations when a later page returns %i', async (status) => {
  state.request.mockResolvedValueOnce(firstPage())
    .mockRejectedValueOnce(new NuniError(status, 'REQUEST_FAILED'));
  render(<CourseMaterials workspace={workspace} />);
  fireEvent.click(await screen.findByRole('button', { name: '載入較早教材' }));
  await screen.findByRole('alert');
  expect(screen.queryByRole('heading', { name: material.title })).toBeNull();
  expect(screen.queryByLabelText('教材標題')).toBeNull();
  expect(screen.queryByRole('button', { name: /較早教材/ })).toBeNull();
  expect((screen.getByRole('button', { name: '更新教材' }) as HTMLButtonElement).disabled).toBe(true);
});

it.each(['account', 'course'])('ignores a pending older page when the %s changes', async (change) => {
  const pending = deferred();
  state.request.mockResolvedValueOnce(firstPage()).mockReturnValueOnce(pending.promise)
    .mockResolvedValueOnce({ materials: [], nextCursor: null });
  const view = render(<CourseMaterials workspace={workspace} />);
  fireEvent.click(await screen.findByRole('button', { name: '載入較早教材' }));
  if (change === 'account') state.context = 'session-b';
  view.rerender(<CourseMaterials workspace={change === 'course'
    ? { ...workspace, id: 'cw_22222222-2222-4222-8222-222222222222' }
    : workspace} />);
  await screen.findByText(/目前還沒有教材/);
  await act(async () => pending.resolve({ materials: [olderMaterial], nextCursor: 'stale-next' }));
  expect(screen.queryByRole('heading', { name: olderMaterial.title })).toBeNull();
  expect(screen.queryByRole('button', { name: /較早教材/ })).toBeNull();
});

it.each(['success', 'failure'])('refresh invalidates an older page with a late %s', async (outcome) => {
  const pending = deferred();
  const fresh = { ...material, title: '更新後的內容' };
  state.request.mockResolvedValueOnce(firstPage()).mockReturnValueOnce(pending.promise)
    .mockResolvedValueOnce({ materials: [fresh], nextCursor: 'fresh-next' });
  render(<CourseMaterials workspace={workspace} />);
  fireEvent.click(await screen.findByRole('button', { name: '載入較早教材' }));
  fireEvent.click(screen.getByRole('button', { name: '更新教材' }));
  await screen.findByRole('heading', { name: fresh.title });
  await act(async () => {
    if (outcome === 'failure') pending.reject(new NuniError(403, 'REQUEST_FAILED'));
    else pending.resolve({ materials: [olderMaterial], nextCursor: 'stale-next' });
  });
  expect(screen.queryByRole('alert')).toBeNull();
  expect(screen.queryByRole('heading', { name: olderMaterial.title })).toBeNull();
  expect(screen.getByRole('heading', { name: fresh.title })).toBeTruthy();
  state.request.mockResolvedValueOnce({ materials: [olderMaterial], nextCursor: null });
  fireEvent.click(screen.getByRole('button', { name: '載入較早教材' }));
  await screen.findByRole('heading', { name: olderMaterial.title });
  expect(state.request.mock.calls.at(-1)?.[4]).toEqual({ cursor: 'fresh-next' });
});

it('publication restarts pagination and ignores the pending older page', async () => {
  const pending = deferred();
  const published = { ...olderMaterial, title: '新教材' };
  state.request.mockResolvedValueOnce(firstPage()).mockReturnValueOnce(pending.promise)
    .mockResolvedValueOnce(published)
    .mockResolvedValueOnce({ materials: [published, material], nextCursor: 'after-publish' });
  render(<CourseMaterials workspace={workspace} />);
  fireEvent.click(await screen.findByRole('button', { name: '載入較早教材' }));
  fireEvent.change(screen.getByLabelText('教材標題'), { target: { value: published.title } });
  fireEvent.change(screen.getByLabelText('教材內容或參考連結'), { target: { value: published.body } });
  fireEvent.submit(screen.getByLabelText('教材標題').closest('form')!);
  await screen.findByText('已發布「新教材」。');
  await waitFor(() => expect(state.request).toHaveBeenCalledTimes(4));
  await act(async () => pending.reject(new NuniError(403, 'REQUEST_FAILED')));
  expect(screen.queryByRole('alert')).toBeNull();
  expect(screen.getByRole('heading', { name: published.title })).toBeTruthy();
  expect((screen.getByRole('button', { name: '載入較早教材' }) as HTMLButtonElement).disabled).toBe(false);
  expect(state.request.mock.calls[3]).toEqual([
    `class-workspaces/${workspace.id}/materials/page`, 'session-a', undefined,
  ]);
});

it('does not restore a pending publication or call onChanged after access is revoked by pagination', async () => {
  const publication = deferred();
  const changed = vi.fn();
  state.request.mockResolvedValueOnce(firstPage()).mockReturnValueOnce(publication.promise)
    .mockRejectedValueOnce(new NuniError(403, 'REQUEST_FAILED'));
  render(<CourseMaterials workspace={workspace} onChanged={changed} />);
  await screen.findByRole('heading', { name: material.title });
  fireEvent.change(screen.getByLabelText('教材標題'), { target: { value: olderMaterial.title } });
  fireEvent.change(screen.getByLabelText('教材內容或參考連結'), { target: { value: olderMaterial.body } });
  fireEvent.submit(screen.getByLabelText('教材標題').closest('form')!);
  fireEvent.click(screen.getByRole('button', { name: '載入較早教材' }));
  await screen.findByRole('alert');
  await act(async () => publication.resolve(olderMaterial));
  expect(screen.queryByRole('heading', { name: olderMaterial.title })).toBeNull();
  expect(screen.queryByText(/已發布「/)).toBeNull();
  expect(changed).not.toHaveBeenCalled();
  expect(state.request).toHaveBeenCalledTimes(3);
});
