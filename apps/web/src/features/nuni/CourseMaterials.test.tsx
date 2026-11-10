import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { renderToString } from 'react-dom/server';
import { hydrateRoot, type Root } from 'react-dom/client';
import { beforeEach, expect, it, vi } from 'vitest';
import { NuniError, type NuniMaterial, type NuniWorkspace } from '@campus/shared/src/nuni';
import { COURSE_WORK_LANDING_ATTR, COURSE_WORK_MISSING_MATERIAL } from '@/lib/courseWorkLanding';
import { MATERIAL_READ_KEY_PREFIX, markMaterialRead } from '@/lib/courseMaterials';
import { CourseMaterials } from './CourseMaterials';
import { studySourceFromText } from '@/lib/studyTutor';
import { serializeCourseStudyProgress } from './courseStudyProgress';
import { emptyStudyPassage } from './courseStudySession';

const state = vi.hoisted(() => ({ context: 'session-a', request: vi.fn(), refresh: vi.fn() }));
vi.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams(window.location.search),
}));
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
  window.history.replaceState(null, '', '/');
  localStorage.clear();
});

it('opens the study board only on demand and returns focus when it closes', async () => {
  render(<CourseMaterials workspace={{ ...workspace, memberRole: 'student' }} />);
  expect(screen.queryByRole('heading', { name: '讀書白板' })).toBeNull();
  const open = await screen.findByRole('button', { name: `陪我讀「${material.title}」` });
  fireEvent.click(open);
  expect(await screen.findByRole('heading', { name: '讀書白板' })).toBeTruthy();
  expect(screen.getByText(/附件與外部連結的內容需另外選擇/)).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: '收起白板' }));
  expect(screen.queryByRole('heading', { name: '讀書白板' })).toBeNull();
  expect(document.activeElement).toBe(open);
});


it('keeps draft notes during an authorized material refresh and previews newer text', async () => {
  const pending = deferred();
  const changed = { ...material, body: '更新後的教材：主鍵和外鍵需要個別理解。' };
  state.request.mockResolvedValueOnce(list()).mockReturnValueOnce(pending.promise);
  render(<CourseMaterials workspace={{ ...workspace, memberRole: 'student' }} />);
  fireEvent.click(await screen.findByRole('button', { name: `陪我讀「${material.title}」` }));
  fireEvent.change(screen.getByLabelText('用自己的話記下這一段'),
    { target: { value: '還沒備份的資料庫筆記' } });

  fireEvent.click(screen.getByRole('button', { name: '更新教材' }));
  expect(screen.getByRole('heading', { name: '讀書白板' })).toBeTruthy();
  expect((screen.getByLabelText('用自己的話記下這一段') as HTMLTextAreaElement).value)
    .toBe('還沒備份的資料庫筆記');
  await act(async () => pending.resolve({ materials: [changed], nextCursor: null }));
  expect(screen.getByRole('heading', { name: '要改讀另一份教材嗎？' })).toBeTruthy();
  expect((screen.getByLabelText('用自己的話記下這一段') as HTMLTextAreaElement).value)
    .toBe('還沒備份的資料庫筆記');
  fireEvent.click(screen.getByRole('button', { name: '保留原本的學習內容' }));
  expect(screen.queryByRole('heading', { name: '要改讀另一份教材嗎？' })).toBeNull();
  expect((screen.getByLabelText('用自己的話記下這一段') as HTMLTextAreaElement).value)
    .toBe('還沒備份的資料庫筆記');
});


it('keeps unsaved study notes and warns when a complete refresh no longer lists the selected lecture', async () => {
  state.request.mockResolvedValueOnce(list())
    .mockResolvedValueOnce({ materials: [], nextCursor: null });
  render(<CourseMaterials workspace={{ ...workspace, memberRole: 'student' }} />);
  fireEvent.click(await screen.findByRole('button', { name: `陪我讀「${material.title}」` }));
  fireEvent.change(screen.getByLabelText('用自己的話記下這一段'),
    { target: { value: '我還沒備份的私人筆記' } });

  fireEvent.click(screen.getByRole('button', { name: '更新教材' }));
  expect((await screen.findByRole('status')).textContent).toContain(
    `先前開啟的「${material.title}」目前不在已載入的教材清單`,
  );
  expect(screen.getByText(material.body)).toBeTruthy();
  expect((screen.getByLabelText('用自己的話記下這一段') as HTMLTextAreaElement).value)
    .toBe('我還沒備份的私人筆記');
  expect(screen.queryByRole('button', { name: `陪我讀「${material.title}」` })).toBeNull();

  fireEvent.click(screen.getByRole('button', { name: '收起白板' }));
  fireEvent.click(screen.getByRole('button', { name: '確認關閉白板' }));
  expect(screen.queryByRole('heading', { name: '讀書白板' })).toBeNull();
  // Its lecture card has disappeared: return keyboard focus to a live entry.
  expect(document.activeElement).toBe(screen.getByRole('button', { name: '讀講義' }));
});

it('does not claim a selected lecture disappeared while older material pages remain', async () => {
  state.request.mockResolvedValueOnce(list())
    .mockResolvedValueOnce({ materials: [], nextCursor: 'older-page' });
  render(<CourseMaterials workspace={{ ...workspace, memberRole: 'student' }} />);
  fireEvent.click(await screen.findByRole('button', { name: `陪我讀「${material.title}」` }));
  fireEvent.click(screen.getByRole('button', { name: '更新教材' }));
  await screen.findByRole('button', { name: '載入較早教材' });
  expect(screen.queryByText(/目前不在已載入的教材清單/)).toBeNull();
  expect(screen.getByText(material.body)).toBeTruthy();
});

it('asks before switching lecture cards and lets the learner retry after cancelling', async () => {
  const another = { ...material, id: 'cwm_22222222-2222-4222-8222-222222222222',
    title: '第二章：交易', body: '交易必須遵守原子性與一致性。' };
  state.request.mockResolvedValueOnce({ materials: [material, another], nextCursor: null });
  render(<CourseMaterials workspace={{ ...workspace, memberRole: 'student' }} />);
  fireEvent.click(await screen.findByRole('button', { name: `陪我讀「${material.title}」` }));
  fireEvent.change(screen.getByLabelText('用自己的話記下這一段'),
    { target: { value: '第一章未保存的私人筆記' } });
  const next = screen.getByRole('button', { name: `陪我讀「${another.title}」` });
  fireEvent.click(next);
  expect(screen.getByRole('heading', { name: '要改讀另一份教材嗎？' })).toBeTruthy();
  expect((screen.getByLabelText('用自己的話記下這一段') as HTMLTextAreaElement).value)
    .toBe('第一章未保存的私人筆記');
  fireEvent.click(screen.getByRole('button', { name: '保留原本的學習內容' }));
  fireEvent.click(next);
  expect(screen.getByRole('heading', { name: '要改讀另一份教材嗎？' })).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: '確認改讀新教材' }));
  expect((screen.getByLabelText('用自己的話記下這一段') as HTMLTextAreaElement).value).toBe('');
  expect(screen.getByRole('group', { name: /目前閱讀段落/ })).toBeTruthy();
  expect(screen.queryByRole('heading', { name: '要改讀另一份教材嗎？' })).toBeNull();
});

it('clears study content when the course session changes', async () => {
  const view = render(<CourseMaterials workspace={{ ...workspace, memberRole: 'student' }} />);
  fireEvent.click(await screen.findByRole('button', { name: `陪我讀「${material.title}」` }));
  await screen.findByRole('heading', { name: '讀書白板' });
  fireEvent.change(screen.getByLabelText('用自己的話記下這一段'), { target: { value: '帳號 A 的私人學習筆記' } });
  fireEvent.click(screen.getByRole('button', { name: '加入待複習' }));
  state.context = 'session-b';
  state.request.mockResolvedValue({ materials: [], nextCursor: null });
  view.rerender(<CourseMaterials workspace={{ ...workspace, memberRole: 'student' }} />);
  expect(screen.queryByRole('heading', { name: '讀書白板' })).toBeNull();
  expect(await screen.findByText(/目前還沒有教材/)).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: '讀講義' }));
  fireEvent.change(screen.getByLabelText('或貼上課文與筆記'), { target: { value: '帳號 B 的教材' } });
  fireEvent.click(screen.getByRole('button', { name: '開始讀這份內容' }));
  expect((screen.getByLabelText('用自己的話記下這一段') as HTMLTextAreaElement).value).toBe('');
  expect(screen.queryByRole('region', { name: '待複習段落' })).toBeNull();
  expect(screen.getByRole('button', { name: '下載本次筆記' }).hasAttribute('disabled')).toBe(true);
});

it('closes the study board on refresh and prevents reopening after access is revoked', async () => {
  render(<CourseMaterials workspace={{ ...workspace, memberRole: 'student' }} />);
  fireEvent.click(await screen.findByRole('button', { name: `陪我讀「${material.title}」` }));
  await screen.findByRole('heading', { name: '讀書白板' });
  fireEvent.change(screen.getByLabelText('用自己的話記下這一段'), { target: { value: '權限撤銷前的筆記' } });
  state.request.mockRejectedValue(new NuniError(403, 'FORBIDDEN'));
  fireEvent.click(screen.getByRole('button', { name: '更新教材' }));
  await waitFor(() => expect(screen.queryByRole('heading', { name: '讀書白板' })).toBeNull());
  await waitFor(() => expect(screen.queryByRole('button', { name: `陪我讀「${material.title}」` })).toBeNull());
  expect(screen.getByRole('button', { name: '讀講義' }).hasAttribute('disabled')).toBe(true);
});

it.each(['context', 'access'] as const)('discards a late progress-file read after the %s boundary changes', async (boundary) => {
  const view = render(<CourseMaterials workspace={{ ...workspace, memberRole: 'student' }} />);
  fireEvent.click(await screen.findByRole('button', { name: `陪我讀「${material.title}」` }));
  await screen.findByRole('heading', { name: '讀書白板' });
  const saved = serializeCourseStudyProgress({
    scope: { platformAccountId: 'pa_11111111-1111-4111-8111-111111111111', workspaceId: workspace.id },
    source: studySourceFromText({ id: 'old-session', title: '上一個登入階段的教材', text: '舊的教材原文。' }),
    position: { sectionIndex: 0, passageIndex: 0, mode: 'understand' },
    passages: { '0:0': { ...emptyStudyPassage(), note: '不應流入新登入階段的私人筆記' } },
  });
  let finish!: (value: string) => void;
  const file = new File([saved], 'saved.campus-study.json', { type: 'application/json' });
  Object.defineProperty(file, 'text', { value: () => new Promise<string>((resolve) => { finish = resolve; }) });
  fireEvent.change(screen.getByLabelText('載入閱讀進度檔'), { target: { files: [file] } });
  if (boundary === 'context') {
    state.context = 'session-b';
    view.rerender(<CourseMaterials workspace={{ ...workspace, memberRole: 'student' }} />);
    expect(screen.queryByRole('heading', { name: '讀書白板' })).toBeNull();
    fireEvent.click(await screen.findByRole('button', { name: `陪我讀「${material.title}」` }));
    await screen.findByRole('heading', { name: '讀書白板' });
  } else {
    state.request.mockRejectedValue(new NuniError(403, 'FORBIDDEN'));
    fireEvent.click(screen.getByRole('button', { name: '更新教材' }));
    await waitFor(() => expect(screen.getByRole('button', { name: '讀講義' }).hasAttribute('disabled')).toBe(true));
  }
  await act(async () => finish(saved));
  expect(screen.queryByRole('region', { name: '閱讀進度預覽' })).toBeNull();
  expect(screen.queryByText('不應流入新登入階段的私人筆記')).toBeNull();
  if (boundary === 'context') {
    expect((screen.getByLabelText('用自己的話記下這一段') as HTMLTextAreaElement).value).toBe('');
  } else {
    expect(screen.queryByRole('heading', { name: '讀書白板' })).toBeNull();
  }
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

it('preserves course navigation context but keeps shared material links independent of private filters', async () => {
  const context = { campus: 'tw-pu', q: '資料庫', courses: 'studying', task: 'feedback' };
  const query = new URLSearchParams({ ...context, view: 'materials', invite: 'not-for-return-links' });
  window.history.replaceState({}, '', `/classroom/course/${workspace.id}?${query}#material-${material.id}`);
  render(<CourseMaterials workspace={{ ...workspace, memberRole: 'student' }} />);
  await screen.findByRole('heading', { name: material.title });
  for (const [name, pathname] of [
    ['回課程首頁', `/classroom/course/${workspace.id}`],
    ['此裝置收藏', '/classroom/material-bookmarks'],
  ]) {
    const destination = new URL(screen.getByRole('link', { name }).getAttribute('href')!, window.location.origin);
    expect(destination.pathname).toBe(pathname);
    expect(Object.fromEntries(destination.searchParams)).toEqual(context);
    expect(destination.hash).toBe('');
  }
  expect(screen.getByRole('link', { name: '這份教材的連結' }).getAttribute('href'))
    .toBe(`/classroom/course/${workspace.id}#material-${material.id}`);
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

it('groups the cabinet by week, shows type and honest size, and opens the file in one tap', async () => {
  const unitId = 'cwu_22222222-2222-4222-8222-222222222222';
  const item = {
    ...material,
    unitId,
    unitTitle: '第 03 週',
    body: 'https://example.test/week3.pdf',
    createdAt: new Date().toISOString(),
  };
  state.request.mockResolvedValue({ materials: [item], nextCursor: null });
  render(
    <CourseMaterials
      workspace={{ ...workspace, memberRole: 'student' }}
      units={[
        {
          id: unitId,
          workspaceId: workspace.id,
          title: '第 03 週',
          position: 3,
          createdAt: item.createdAt,
        },
      ]}
    />,
  );
  expect(await screen.findByRole('heading', { name: '第 03 週' })).toBeTruthy();
  expect(screen.getByText('PDF')).toBeTruthy();
  expect(screen.getByText('大小未提供')).toBeTruthy();
  const open = screen.getByRole('link', { name: '下載' });
  expect(open.getAttribute('href')).toBe('https://example.test/week3.pdf');
  expect(open.getAttribute('download')).toBe('week3.pdf');
});

it('lands on a material hash with the same highlight used for assignments', async () => {
  window.history.replaceState(null, '', `/#material-${material.id}`);
  render(<CourseMaterials workspace={{ ...workspace, memberRole: 'student' }} />);
  const card = await screen.findByRole('article', { name: material.title });
  card.scrollIntoView = vi.fn();
  await waitFor(() => expect(card.getAttribute(COURSE_WORK_LANDING_ATTR)).toBe('true'));
});

it('loads later pages until a linked older material is found', async () => {
  window.history.replaceState(null, '', `/#material-${olderMaterial.id}`);
  state.request.mockResolvedValueOnce(firstPage()).mockResolvedValueOnce({
    materials: [olderMaterial],
    nextCursor: null,
  });
  render(<CourseMaterials workspace={{ ...workspace, memberRole: 'student' }} />);
  const card = await screen.findByRole('article', { name: olderMaterial.title });
  await waitFor(() => expect(card.getAttribute(COURSE_WORK_LANDING_ATTR)).toBe('true'));
});

it('explains a missing material instead of a blank cabinet', async () => {
  window.history.replaceState(null, '', '/#material-cwm_99999999-9999-4999-8999-999999999999');
  render(<CourseMaterials workspace={{ ...workspace, memberRole: 'student' }} />);
  expect(await screen.findByText(COURSE_WORK_MISSING_MATERIAL)).toBeTruthy();
  expect(screen.getByRole('article', { name: material.title })).toBeTruthy();
});

it('filters the current course cabinet by keyword without leaving the page', async () => {
  render(<CourseMaterials workspace={{ ...workspace, memberRole: 'student' }} />);
  await screen.findByRole('article', { name: material.title });
  fireEvent.change(screen.getByLabelText('在這門課找教材'), { target: { value: '沒有這份' } });
  expect(screen.queryByRole('article', { name: material.title })).toBeNull();
  expect(screen.getByText(/找不到符合「沒有這份」的教材/)).toBeTruthy();
  fireEvent.change(screen.getByLabelText('在這門課找教材'), { target: { value: '主鍵' } });
  expect(screen.getByRole('article', { name: material.title })).toBeTruthy();
});

it('hydrates the cabinet loading markup, then shows unread until the file is opened', async () => {
  const account = 'pa_11111111-1111-4111-8111-111111111111';
  localStorage.setItem(MATERIAL_READ_KEY_PREFIX + account, JSON.stringify([olderMaterial.id]));
  const app = <CourseMaterials workspace={{ ...workspace, memberRole: 'student' }} />;
  const container = document.createElement('div');
  container.innerHTML = renderToString(app);
  document.body.append(container);
  expect(container.textContent).toContain('正在讀取教材櫃…');
  expect(container.textContent).not.toContain('未讀');
  const onRecoverableError = vi.fn();
  let root: Root | undefined;
  try {
    await act(async () => {
      root = hydrateRoot(container, app, { onRecoverableError });
    });
    expect(onRecoverableError).not.toHaveBeenCalled();
    const card = await screen.findByRole('article', { name: material.title });
    expect(within(card).getByText('未讀')).toBeTruthy();
    fireEvent.click(within(card).getByRole('link', { name: '開啟' }));
    expect(within(card).queryByText('未讀')).toBeNull();
  } finally {
    await act(async () => root?.unmount());
    container.remove();
  }
});

it('marks a landed material as read on this device', async () => {
  window.history.replaceState(null, '', `/#material-${material.id}`);
  render(<CourseMaterials workspace={{ ...workspace, memberRole: 'student' }} />);
  const card = await screen.findByRole('article', { name: material.title });
  card.scrollIntoView = vi.fn();
  await waitFor(() => expect(card.getAttribute(COURSE_WORK_LANDING_ATTR)).toBe('true'));
  await waitFor(() => expect(within(card).queryByText('未讀')).toBeNull());
});

it('keeps unread badges after a client clock tick without inventing a read', async () => {
  markMaterialRead('pa_11111111-1111-4111-8111-111111111111', olderMaterial.id, localStorage);
  render(<CourseMaterials workspace={{ ...workspace, memberRole: 'student' }} />);
  const card = await screen.findByRole('article', { name: material.title });
  expect(within(card).getByText('未讀')).toBeTruthy();
});

it.each([403, 404])('offers a safe course return for inaccessible material links (%i)', async (status) => {
  window.history.replaceState(null, '', `/#material-${material.id}`);
  state.request.mockRejectedValueOnce(new NuniError(status, 'REQUEST_FAILED'));
  render(<CourseMaterials workspace={workspace} />);
  expect(await screen.findByRole('alert')).toBeTruthy();
  expect(screen.getByRole('link', { name: '回課程首頁' }).getAttribute('href')).toBe(`/classroom/course/${workspace.id}`);
  expect(screen.queryByRole('article')).toBeNull();
  // 提示文字先提交到畫面，清除 hash 的 effect 可能稍後才執行。
  await waitFor(() => expect(window.location.hash).toBe(''));
});
it('keeps a safe course entry available after a linked material was deleted', async () => {
  window.history.replaceState(null, '', '/#material-cwm_deleted');
  render(<CourseMaterials workspace={workspace} />);
  await screen.findByText(COURSE_WORK_MISSING_MATERIAL);
  // 提示文字先提交到畫面，清除 hash 的 effect 可能稍後才執行。
  await waitFor(() => expect(window.location.hash).toBe(''));
  expect(screen.getByRole('link', { name: '回課程首頁' }).getAttribute('href')).not.toContain('#');
});
it('stops automatic target lookup on a repeated cursor', async () => {
  window.history.replaceState(null, '', '/#material-cwm_missing');
  state.request
    .mockResolvedValueOnce({ materials: [material], nextCursor: 'page_a' })
    .mockResolvedValueOnce({ materials: [material], nextCursor: 'page_b' })
    .mockResolvedValueOnce({ materials: [material], nextCursor: 'page_a' });
  render(<CourseMaterials workspace={workspace} />);
  expect((await screen.findByRole('alert')).textContent).toContain('較早教材未能繼續載入');
  expect(state.request).toHaveBeenCalledTimes(3);
  expect(screen.queryByText(COURSE_WORK_MISSING_MATERIAL)).toBeNull();
});
