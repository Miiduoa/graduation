import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { resolvePublicCourseOperation } from '@campus/shared/src/publicCourseOperations';
import { QuickCampusEntry } from './QuickCampusEntry';
import { interpretCampusRequest } from '@/lib/campusIntentClient';

const state = vi.hoisted(() => ({ uid: '' as string, schoolId: 'pu' }));
vi.mock('./AuthGuard', () => ({
  useAuth: () => ({ user: state.uid ? { uid: state.uid } : null }),
}));
vi.mock('./SelectedSchoolProvider', () => ({
  useOptionalSelectedSchool: () => ({
    selectedSchool: { id: state.schoolId, code: state.schoolId.toUpperCase() },
    loading: false,
    catalogStatus: 'ready',
  }),
}));
vi.mock('@/lib/campusIntentClient', () => ({ interpretCampusRequest: vi.fn() }));
vi.mock('./VoiceDictationButton', () => ({
  VoiceDictationButton: ({ onTranscript }: { onTranscript: (text: string) => void }) => (
    <button onClick={() => onTranscript('幫我找清大的資料庫課程')}>測試查課語音</button>
  ),
}));
const fetcher = vi.fn<typeof fetch>();
function result(title = '資料庫系統') {
  return new Response(
    JSON.stringify({
      schoolId: 'nthu',
      sourceUrl: resolvePublicCourseOperation('nthu')!.sourceUrl,
      fetchedAt: '2026-11-07T11:53:52.366Z',
      truncated: false,
      courses: [
        {
          code: '11510CS  200000',
          section: '00',
          title,
          teacher: '測試老師',
          department: '資工',
          semester: '1151',
          credits: '3',
          time: 'M3',
          room: 'R1',
        },
      ],
    }),
  );
}
const typeQuery = (value: string) =>
  fireEvent.change(screen.getByRole('searchbox', { name: '想做什麼？' }), { target: { value } });
beforeEach(() => {
  state.uid = '';
  state.schoolId = 'pu';
  vi.clearAllMocks();
  fetcher.mockReset();
  vi.stubGlobal('fetch', fetcher);
});
afterEach(() => vi.unstubAllGlobals());

it('lets a guest query another school from the current page, with a real result and same-query handoff', async () => {
  fetcher.mockResolvedValue(result());
  render(<QuickCampusEntry />);
  typeQuery('幫我找清大的資料庫課程');
  expect(fetcher).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: '查詢公開課程' }));
  expect(await screen.findByText('資料庫系統')).toBeTruthy();
  expect(interpretCampusRequest).not.toHaveBeenCalled();
  const [url, init] = fetcher.mock.calls[0];
  expect(new URL(String(url), 'https://nuni.tw').searchParams.get('schoolId')).toBe('nthu');
  expect(init?.credentials).toBe('omit');
  const href = new URL(
    screen.getByRole('link', { name: '查看課程與課表核對' }).getAttribute('href')!,
    'https://nuni.tw',
  );
  expect(href.searchParams.get('schoolId')).toBe('nthu');
  expect(href.searchParams.get('q')).toBe('資料庫');
  expect(screen.getByRole('link', { name: '校方資料來源' }).getAttribute('href')).toBe(
    resolvePublicCourseOperation('nthu')!.sourceUrl,
  );
});

it('uses a completed public voice request without sending it to a model', async () => {
  fetcher.mockResolvedValue(result());
  render(<QuickCampusEntry />);
  fireEvent.click(screen.getByRole('button', { name: '測試查課語音' }));
  expect(await screen.findByText('資料庫系統')).toBeTruthy();
  expect(interpretCampusRequest).not.toHaveBeenCalled();
});

it('keeps unsupported schools explicit without fetching another school or falling back to AI', async () => {
  render(<QuickCampusEntry />);
  typeQuery('查台大資料庫課程');
  fireEvent.click(screen.getByRole('button', { name: '查詢公開課程' }));
  expect(await screen.findByText(/這所學校尚未接通/)).toBeTruthy();
  expect(fetcher).not.toHaveBeenCalled();
  expect(interpretCampusRequest).not.toHaveBeenCalled();
});

it('cancels a pending result after editing the question and ignores a late body', async () => {
  let finish!: (response: Response) => void;
  fetcher.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  render(<QuickCampusEntry />);
  typeQuery('查清大資料庫課程');
  fireEvent.click(screen.getByRole('button', { name: '查詢公開課程' }));
  typeQuery('我要交作業');
  expect(fetcher.mock.calls[0][1]?.signal?.aborted).toBe(true);
  await act(async () => finish(result('不應顯示的舊課程')));
  expect(screen.queryByText('不應顯示的舊課程')).toBeNull();
  expect(interpretCampusRequest).not.toHaveBeenCalled();
});

it('cancels when selected campus or account changes', async () => {
  state.uid = 'alice';
  let finish!: (response: Response) => void;
  fetcher.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const view = render(<QuickCampusEntry />);
  typeQuery('查清大資料庫課程');
  fireEvent.click(screen.getByRole('button', { name: '查詢公開課程' }));
  state.uid = 'bob';
  state.schoolId = 'ncnu';
  view.rerender(<QuickCampusEntry />);
  expect(fetcher.mock.calls[0][1]?.signal?.aborted).toBe(true);
  await act(async () => finish(result('前一帳號的回覆')));
  expect(screen.queryByText('前一帳號的回覆')).toBeNull();
});

it('shows a retry route for upstream failure without claiming no courses exist', async () => {
  fetcher.mockResolvedValue(new Response('', { status: 502 }));
  render(<QuickCampusEntry />);
  typeQuery('查清大資料庫課程');
  fireEvent.click(screen.getByRole('button', { name: '查詢公開課程' }));
  expect(await screen.findByText(/暫時無法取得可核對的課程資料/)).toBeTruthy();
  expect(screen.getByRole('link', { name: '查看課程與課表核對' })).toBeTruthy();
  expect(screen.queryByText(/沒有符合的開課資料/)).toBeNull();
  expect(interpretCampusRequest).not.toHaveBeenCalled();
});

it('refuses to silently shorten a general AI question', async () => {
  state.uid = 'alice';
  render(<QuickCampusEntry />);
  typeQuery('想知道'.repeat(60));
  fireEvent.click(screen.getByRole('button', { name: '用 AI 理解這句話' }));
  await waitFor(() =>
    expect(screen.getByText('一般需求請縮短至 160 字以內，再送出分析。')).toBeTruthy(),
  );
  expect(fetcher).not.toHaveBeenCalled();
  expect(interpretCampusRequest).not.toHaveBeenCalled();
});
