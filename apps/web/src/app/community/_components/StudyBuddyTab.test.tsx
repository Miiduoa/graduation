import { StrictMode, useState } from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { CreateGroupModal, ReviewModal, StudyBuddyTab } from './StudyBuddyTab';

const mocks = vi.hoisted(() => ({
  auth: {
    user: { uid: 'alice', displayName: 'Alice' } as { uid: string; displayName: string } | null,
  },
  submitReview: vi.fn(),
  listReviews: vi.fn(),
  addDoc: vi.fn(),
  getDocs: vi.fn(),
}));

vi.mock('@/components/AuthGuard', () => ({ useAuth: () => mocks.auth }));
vi.mock('@/lib/firebase', () => ({ getDb: () => 'db' }));
vi.mock('firebase/firestore', () => ({
  addDoc: mocks.addDoc,
  getDocs: mocks.getDocs,
  collection: (...parts: unknown[]) => parts,
  doc: (...parts: unknown[]) => parts,
  query: (...parts: unknown[]) => parts,
  limit: (value: number) => value,
  orderBy: (value: string) => value,
  serverTimestamp: () => 'server-time',
  arrayUnion: vi.fn(),
  updateDoc: vi.fn(),
}));
vi.mock('@/lib/community/firestore', () => ({
  submitCourseReview: mocks.submitReview,
  listCourseReviews: mocks.listReviews,
  toggleReviewHelpful: vi.fn(),
  aggregateReviews: (reviews: unknown[]) => ({
    totalCount: reviews.length,
    avgRating: 4,
    avgDifficulty: 3,
    avgWorkload: 3,
    avgUsefulness: 4,
    sentiment: { positive: reviews.length, neutral: 0, negative: 0 },
    topTags: [],
  }),
}));

const originalShow = Object.getOwnPropertyDescriptor(HTMLDialogElement.prototype, 'showModal');
const originalClose = Object.getOwnPropertyDescriptor(HTMLDialogElement.prototype, 'close');

beforeEach(() => {
  mocks.auth.user = { uid: 'alice', displayName: 'Alice' };
  mocks.submitReview.mockReset().mockResolvedValue('review-1');
  mocks.listReviews.mockReset().mockResolvedValue([]);
  mocks.addDoc.mockReset().mockResolvedValue({ id: 'group-1' });
  mocks.getDocs.mockReset().mockResolvedValue({ docs: [] });
  Object.defineProperty(HTMLDialogElement.prototype, 'showModal', {
    configurable: true,
    writable: true,
    value: vi.fn(function (this: HTMLDialogElement) {
      this.setAttribute('open', '');
    }),
  });
  Object.defineProperty(HTMLDialogElement.prototype, 'close', {
    configurable: true,
    writable: true,
    value: vi.fn(function (this: HTMLDialogElement) {
      this.removeAttribute('open');
    }),
  });
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
  if (originalShow) Object.defineProperty(HTMLDialogElement.prototype, 'showModal', originalShow);
  else Reflect.deleteProperty(HTMLDialogElement.prototype, 'showModal');
  if (originalClose) Object.defineProperty(HTMLDialogElement.prototype, 'close', originalClose);
  else Reflect.deleteProperty(HTMLDialogElement.prototype, 'close');
  document.body.style.removeProperty('overflow');
});

function fill(label: string, value: string) {
  fireEvent.change(screen.getByLabelText(label), { target: { value } });
}

function rate(label: string, stars: number) {
  fireEvent.click(
    within(screen.getByRole('radiogroup', { name: label })).getByRole('radio', {
      name: `${stars} 顆星`,
    }),
  );
}

function completeReview() {
  fill('課程名稱', ' 程式設計 ');
  rate('整體評分（必填）', 4);
}

it('owns one pending review, allows immediate dismissal and locks fields, and preserves the existing payload', async () => {
  let resolve!: (value: string) => void;
  mocks.submitReview.mockImplementation(
    () =>
      new Promise<string>((done) => {
        resolve = done;
      }),
  );
  const close = vi.fn();
  const saved = vi.fn();
  render(<ReviewModal schoolId="pu" myUid="alice" onClose={close} onSubmitted={saved} />);
  completeReview();
  fill('課程代碼（選填）', ' CS101 ');
  fill('評論（選填）', ' 實作有幫助 ');
  fill('標籤（選填）', '實作，必修');
  rate('難度（選填）', 3);
  fireEvent.click(screen.getByLabelText('匿名評價'));
  const dialog = screen.getByRole('dialog', { name: '寫課程評價' });
  const form = dialog.querySelector('form')!;
  act(() => {
    fireEvent.submit(form);
    fireEvent.submit(form);
  });
  expect(mocks.submitReview).toHaveBeenCalledOnce();
  expect(mocks.submitReview).toHaveBeenCalledWith({
    schoolId: 'pu',
    courseCode: 'CS101',
    courseName: '程式設計',
    rating: 4,
    difficulty: 3,
    workload: 0,
    usefulness: 0,
    comment: '實作有幫助',
    tags: ['實作', '必修'],
    anonymous: false,
    authorUid: 'alice',
    aliasSnapshot: undefined,
  });
  expect(screen.getByLabelText('課程名稱').matches(':disabled')).toBe(true);
  expect(screen.getByLabelText('匿名評價').matches(':disabled')).toBe(true);
  expect(
    within(screen.getByRole('radiogroup', { name: '整體評分（必填）' }))
      .getByRole('radio', { name: '4 顆星' })
      .matches(':checked'),
  ).toBe(true);
  fireEvent.click(screen.getByRole('button', { name: '取消' }));
  fireEvent.click(screen.getByRole('button', { name: '關閉視窗' }));
  fireEvent(dialog, new Event('cancel', { bubbles: true, cancelable: true }));
  fireEvent.pointerDown(dialog, { clientX: -1, clientY: -1 });
  fireEvent.click(dialog, { clientX: -1, clientY: -1 });
  expect(close.mock.calls).toEqual(Array.from({ length: 4 }, () => ['retain']));
  await act(async () => {
    resolve('review-1');
  });
  expect(saved).toHaveBeenCalledOnce();
});

it('keeps review fields, rating and privacy choice after failure and allows a deliberate retry', async () => {
  mocks.submitReview.mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce('review-1');
  render(<StudyBuddyTab schoolId="pu" />);
  const opener = await screen.findByRole('button', { name: '＋ 寫評價' });
  opener.focus();
  fireEvent.click(opener);
  completeReview();
  fill('評論（選填）', '保留的心得');
  fireEvent.click(screen.getByRole('button', { name: '送出評價' }));
  await screen.findByText(
    '暫時無法確認送出結果，內容已保留。請先查看列表是否已出現，再決定是否重試。',
  );
  fireEvent.click(screen.getByRole('button', { name: '關閉視窗' }));
  expect(screen.queryByRole('dialog')).toBeNull();
  expect(document.body.style.overflow).toBe('');
  expect(document.activeElement).toBe(opener);
  fireEvent.click(opener);
  expect((screen.getByLabelText('課程名稱') as HTMLInputElement).value).toBe(' 程式設計 ');
  expect((screen.getByLabelText('評論（選填）') as HTMLTextAreaElement).value).toBe('保留的心得');
  expect((screen.getByLabelText('匿名評價') as HTMLInputElement).checked).toBe(true);
  expect(screen.getByLabelText('課程名稱').matches(':disabled')).toBe(false);
  fireEvent.click(screen.getByRole('button', { name: '送出評價' }));
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  expect(document.activeElement).toBe(opener);
  expect(document.body.style.overflow).toBe('');
  fireEvent.click(opener);
  expect(screen.getByLabelText<HTMLInputElement>('課程名稱').value).toBe('');
  expect(mocks.submitReview).toHaveBeenCalledTimes(2);
  expect(mocks.submitReview.mock.calls[1][0]).toMatchObject({
    anonymous: true,
    authorUid: null,
    aliasSnapshot: '匿名同學',
    rating: 4,
  });
});

it('focuses missing review fields and never sends invalid ratings', () => {
  render(<ReviewModal schoolId="pu" myUid="alice" onClose={vi.fn()} onSubmitted={vi.fn()} />);
  fireEvent.click(screen.getByRole('button', { name: '送出評價' }));
  expect(document.activeElement).toBe(screen.getByLabelText('課程名稱'));
  fill('課程名稱', '程式設計');
  fireEvent.click(screen.getByRole('button', { name: '送出評價' }));
  const firstStar = within(screen.getByRole('radiogroup', { name: '整體評分（必填）' })).getByRole(
    'radio',
    { name: '1 顆星' },
  );
  expect(document.activeElement).toBe(firstStar);
  expect(
    screen.getByRole('radiogroup', { name: '整體評分（必填）' }).getAttribute('aria-invalid'),
  ).toBe('true');
  expect(screen.getByText('請選擇整體評分。')).toBeTruthy();
  expect(mocks.submitReview).not.toHaveBeenCalled();
});

it('restores the opener after cancelling without submitting', async () => {
  function Harness() {
    const [open, setOpen] = useState(false);
    return (
      <>
        <button onClick={() => setOpen(true)}>開始寫評價</button>
        {open && (
          <ReviewModal
            schoolId="pu"
            myUid="alice"
            onClose={() => setOpen(false)}
            onSubmitted={vi.fn()}
          />
        )}
      </>
    );
  }
  render(
    <StrictMode>
      <Harness />
    </StrictMode>,
  );
  const opener = screen.getByRole('button', { name: '開始寫評價' });
  opener.focus();
  fireEvent.click(opener);
  expect(document.activeElement).toBe(screen.getByLabelText('課程名稱'));
  fireEvent.click(screen.getByRole('button', { name: '取消' }));
  await waitFor(() => expect(document.activeElement).toBe(opener));
  expect(mocks.submitReview).not.toHaveBeenCalled();
});

it('does not let an old review completion close a new account or school form', async () => {
  let resolve!: (value: string) => void;
  mocks.submitReview.mockImplementation(
    () =>
      new Promise<string>((done) => {
        resolve = done;
      }),
  );
  const view = render(<StudyBuddyTab schoolId="pu" />);
  await screen.findByText('尚無評價');
  fireEvent.click(screen.getByRole('button', { name: '＋ 寫評價' }));
  completeReview();
  fireEvent.click(screen.getByRole('button', { name: '送出評價' }));
  mocks.auth.user = { uid: 'bob', displayName: 'Bob' };
  view.rerender(<StudyBuddyTab schoolId="nthu" />);
  await screen.findByText('尚無評價');
  expect(screen.queryByRole('dialog')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: '＋ 寫評價' }));
  fill('課程名稱', '新帳號的草稿');
  const reads = mocks.listReviews.mock.calls.length;
  await act(async () => {
    resolve('old-review');
  });
  expect(screen.getByRole('dialog', { name: '寫課程評價' })).toBeTruthy();
  expect((screen.getByLabelText('課程名稱') as HTMLInputElement).value).toBe('新帳號的草稿');
  expect(mocks.listReviews).toHaveBeenCalledTimes(reads);
});

it('retains a slow review across closing and tab changes without another write or stealing focus on hidden success', async () => {
  let resolve!: (value: string) => void;
  mocks.submitReview.mockImplementation(
    () =>
      new Promise<string>((done) => {
        resolve = done;
      }),
  );
  render(<StudyBuddyTab schoolId="pu" />);
  await screen.findByText('尚無評價');
  vi.useFakeTimers();
  const opener = screen.getByRole('button', { name: '＋ 寫評價' });
  opener.focus();
  fireEvent.click(opener);
  completeReview();
  fill('評論（選填）', '等待送達的心得');
  fireEvent.click(screen.getByRole('button', { name: '送出評價' }));
  await act(async () => {
    await vi.advanceTimersByTimeAsync(14_999);
  });
  expect((screen.getByRole('button', { name: '取消' }) as HTMLButtonElement).disabled).toBe(false);
  await act(async () => {
    await vi.advanceTimersByTimeAsync(1);
  });
  expect(screen.getByText(/這次送出仍可能完成，請勿重複送出/)).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: '取消' }));
  expect(screen.queryByRole('dialog')).toBeNull();
  expect(document.body.style.overflow).toBe('');
  expect(document.activeElement).toBe(opener);

  await act(async () => {
    fireEvent.click(screen.getByRole('tab', { name: '讀書會' }));
  });
  fireEvent.click(screen.getByRole('tab', { name: '課程評價' }));
  fireEvent.click(screen.getByRole('button', { name: '＋ 寫評價' }));
  const resumed = screen.getByRole('dialog', { name: '寫課程評價' });
  expect((screen.getByLabelText('課程名稱') as HTMLInputElement).value).toBe(' 程式設計 ');
  expect((screen.getByLabelText('評論（選填）') as HTMLTextAreaElement).value).toBe(
    '等待送達的心得',
  );
  expect(screen.getByLabelText('課程名稱').matches(':disabled')).toBe(true);
  expect(
    within(screen.getByRole('radiogroup', { name: '整體評分（必填）' }))
      .getByRole('radio', { name: '4 顆星' })
      .matches(':checked'),
  ).toBe(true);
  fireEvent.submit(resumed.querySelector('form')!);
  expect(mocks.submitReview).toHaveBeenCalledOnce();
  fireEvent(resumed, new Event('cancel', { bubbles: true, cancelable: true }));
  expect(screen.queryByRole('dialog')).toBeNull();
  fireEvent.click(screen.getByRole('tab', { name: '讀書會' }));
  fireEvent.click(screen.getByRole('button', { name: '＋ 建立讀書會' }));
  fill('讀書會名稱', '另一份表單');
  const focused = screen.getByLabelText('讀書會名稱');
  focused.focus();
  const reads = mocks.listReviews.mock.calls.length;
  await act(async () => {
    resolve('review-1');
  });
  expect(mocks.listReviews).toHaveBeenCalledTimes(reads + 1);
  expect(screen.getByRole('dialog', { name: '建立讀書會' })).toBeTruthy();
  expect((screen.getByLabelText('讀書會名稱') as HTMLInputElement).value).toBe('另一份表單');
  expect(document.activeElement).toBe(focused);
  fireEvent.click(screen.getByRole('button', { name: '取消' }));
  fireEvent.click(screen.getByRole('tab', { name: '課程評價' }));
  fireEvent.click(screen.getByRole('button', { name: '＋ 寫評價' }));
  expect((screen.getByLabelText('課程名稱') as HTMLInputElement).value).toBe('');
});

it('removes an inactive section portal while keeping its original pending review', async () => {
  mocks.submitReview.mockImplementation(() => new Promise(() => {}));
  render(<StudyBuddyTab schoolId="pu" />);
  await screen.findByText('尚無評價');
  fireEvent.click(screen.getByRole('button', { name: '＋ 寫評價' }));
  completeReview();
  fireEvent.click(screen.getByRole('button', { name: '送出評價' }));
  // jsdom permits a programmatic parent tab change behind the modal. The
  // section's active prop must remove the portal, not just hide its ancestor.
  await act(async () => {
    fireEvent.click(screen.getByRole('tab', { name: '讀書會' }));
  });
  expect(document.querySelector('dialog')).toBeNull();
  expect(document.body.style.overflow).toBe('');
  fireEvent.click(screen.getByRole('tab', { name: '課程評價' }));
  const resumed = screen.getByRole('dialog', { name: '寫課程評價' });
  expect(screen.getByLabelText('課程名稱').matches(':disabled')).toBe(true);
  fireEvent.submit(resumed.querySelector('form')!);
  expect(mocks.submitReview).toHaveBeenCalledOnce();
});

it('focuses the persistent review button when the first review is submitted', async () => {
  render(<StudyBuddyTab schoolId="pu" />);
  const first = await screen.findByRole('button', { name: '寫第一則評價' });
  first.focus();
  fireEvent.click(first);
  completeReview();
  mocks.listReviews.mockResolvedValueOnce([
    {
      id: 'r1', courseCode: 'CS101', courseName: '程式設計', rating: 4,
      sentiment: 'positive', comment: '第一則評價', tags: [], anonymous: true,
    },
  ]);
  fireEvent.click(screen.getByRole('button', { name: '送出評價' }));
  await screen.findByText('第一則評價');
  expect(screen.queryByRole('button', { name: '寫第一則評價' })).toBeNull();
  expect(document.activeElement).toBe(screen.getByRole('button', { name: '＋ 寫評價' }));
});

it.each([
  { kind: 'review', outcome: 'success', switchTabs: false },
  { kind: 'review', outcome: 'failure', switchTabs: false },
  { kind: 'review', outcome: 'success', switchTabs: true },
  { kind: 'review', outcome: 'failure', switchTabs: true },
  { kind: 'group', outcome: 'success', switchTabs: false },
  { kind: 'group', outcome: 'failure', switchTabs: false },
  { kind: 'group', outcome: 'success', switchTabs: true },
  { kind: 'group', outcome: 'failure', switchTabs: true },
])('opens a blank $kind during a $outcome refresh (switch tabs: $switchTabs)', async ({
  kind, outcome, switchTabs,
}) => {
  const isReview = kind === 'review';
  const read = isReview ? mocks.listReviews : mocks.getDocs;
  const write = isReview ? mocks.submitReview : mocks.addDoc;
  const openerName = isReview ? '＋ 寫評價' : '＋ 建立讀書會';
  const field = isReview ? '課程名稱' : '讀書會名稱';
  const tab = isReview ? '課程評價' : '讀書會';
  const otherTab = isReview ? '讀書會' : '課程評價';
  render(<StudyBuddyTab schoolId="pu" />);
  await screen.findByText('尚無評價');
  if (!isReview) {
    fireEvent.click(screen.getByRole('tab', { name: tab }));
    await screen.findByText('暫無讀書會');
  }

  const opener = screen.getByRole('button', { name: openerName });
  const initialOpener = isReview ? screen.getByRole('button', { name: '寫第一則評價' }) : opener;
  initialOpener.focus();
  fireEvent.click(initialOpener);
  if (isReview) {
    completeReview();
    fill('評論（選填）', '已送出的評價');
  } else {
    fill(field, '已建立的讀書會');
    fill('課程名稱', '資料庫');
  }

  let finishRefresh!: () => void;
  read.mockImplementationOnce(() => new Promise((resolve, reject) => {
    finishRefresh = () => {
      if (outcome === 'failure') {
        // A current group refresh retries without ordering before showing an error.
        if (!isReview && !switchTabs) read.mockRejectedValueOnce(new Error('offline'));
        reject(new Error('offline'));
      } else {
        resolve(isReview ? [] : { docs: [] });
      }
    };
  }));

  const form = screen.getByRole('dialog').querySelector('form')!;
  await act(async () => {
    fireEvent.submit(form);
    fireEvent.submit(form);
  });
  expect(write).toHaveBeenCalledOnce();
  expect(screen.getByText('載入中…')).toBeTruthy();
  expect(screen.queryByRole('dialog')).toBeNull();
  expect(document.body.style.overflow).toBe('');
  expect(document.activeElement).toBe(opener);

  if (switchTabs) {
    fireEvent.click(screen.getByRole('tab', { name: otherTab }));
    expect(screen.queryByRole('dialog')).toBeNull();
    fireEvent.click(screen.getByRole('tab', { name: tab }));
  }
  fireEvent.click(opener);
  expect(screen.getByLabelText<HTMLInputElement>(field).value).toBe('');
  if (isReview) {
    expect(screen.getByLabelText<HTMLTextAreaElement>('評論（選填）').value).toBe('');
    expect(screen.queryByRole('radio', { checked: true })).toBeNull();
  } else {
    expect(screen.getByLabelText<HTMLInputElement>('課程名稱').value).toBe('');
  }
  const freshForm = screen.getByRole('dialog').querySelector('form')!;
  fireEvent.submit(freshForm);
  expect(write).toHaveBeenCalledOnce();
  fill(field, '新草稿');

  await act(async () => finishRefresh());
  expect(screen.getByRole('dialog').querySelector('form')).toBe(freshForm);
  expect(screen.getByLabelText<HTMLInputElement>(field).value).toBe('新草稿');
  expect(Boolean(screen.queryByText(/暫時無法讀取(課程評價|讀書會)/))).toBe(
    outcome === 'failure' && !switchTabs,
  );
  fireEvent.click(screen.getByRole('button', { name: '取消' }));
  expect(document.body.style.overflow).toBe('');
  expect(write).toHaveBeenCalledOnce();
});

it('distinguishes a filtered empty result and restores both the list and search focus', async () => {
  mocks.listReviews.mockResolvedValue([
    {
      id: 'r1',
      courseCode: 'CS101',
      courseName: '程式設計',
      rating: 4,
      difficulty: 3,
      workload: 2,
      usefulness: 4,
      comment: '很實用',
      sentiment: 'positive',
      sentimentScore: 1,
      tags: [],
      anonymous: true,
      helpful: 0,
      helpfulBy: [],
    },
  ]);
  render(<StudyBuddyTab schoolId="pu" />);
  await screen.findByText('程式設計');
  const input = screen.getByRole('searchbox', { name: '篩選課程名稱或代碼' });
  fireEvent.change(input, { target: { value: '不存在' } });
  expect(screen.getByText('找不到符合的課程評價')).toBeTruthy();
  expect(screen.queryByText('尚無評價')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: '清除搜尋' }));
  expect(screen.getByText('程式設計')).toBeTruthy();
  expect((input as HTMLInputElement).value).toBe('');
  expect(document.activeElement).toBe(input);
});

it.each([
  { previous: ['bob', 'carol'], next: ['bob'], before: '已滿員', after: '申請加入' },
  { previous: ['bob'], next: ['bob', 'carol'], before: '申請加入', after: '已滿員' },
])('refreshes group capacity on return from $before to $after', async ({
  previous,
  next,
  before,
  after,
}) => {
  function snapshot(members: string[]) {
    return {
      docs: [
        {
          id: 'group-1',
          data: () => ({
            name: '演算法讀書會',
            courseName: '演算法',
            courseCode: 'CS101',
            location: '圖書館',
            style: 'collaborative',
            dayOfWeek: 1,
            startHour: 10,
            endHour: 11,
            maxMembers: 2,
            members,
            organizerUid: 'bob',
          }),
        },
      ],
    };
  }

  mocks.getDocs.mockResolvedValue(snapshot(previous));
  render(<StudyBuddyTab schoolId="pu" />);
  await screen.findByText('尚無評價');
  expect(mocks.getDocs).not.toHaveBeenCalled();

  fireEvent.click(screen.getByRole('tab', { name: '讀書會' }));
  expect((await screen.findByRole<HTMLButtonElement>('button', { name: before })).disabled).toBe(
    before === '已滿員',
  );
  fireEvent.click(screen.getByRole('tab', { name: '課程評價' }));
  await waitFor(() => expect(mocks.listReviews).toHaveBeenCalledTimes(2));

  mocks.getDocs.mockResolvedValue(snapshot(next));
  fireEvent.click(screen.getByRole('tab', { name: '讀書會' }));

  expect((await screen.findByRole<HTMLButtonElement>('button', { name: after })).disabled).toBe(
    after === '已滿員',
  );
  expect(screen.queryByRole('button', { name: before })).toBeNull();
  expect(mocks.getDocs).toHaveBeenCalledTimes(2);
});

it('validates group time, locks pending writes, and keeps the Firestore schema unchanged', async () => {
  let resolve!: (value: { id: string }) => void;
  mocks.addDoc.mockImplementation(
    () =>
      new Promise<{ id: string }>((done) => {
        resolve = done;
      }),
  );
  const saved = vi.fn();
  const close = vi.fn();
  render(
    <CreateGroupModal
      schoolId="pu"
      myUid="alice"
      myName="Alice"
      onClose={close}
      onCreated={saved}
    />,
  );
  fill('讀書會名稱', ' 演算法讀書會 ');
  fill('課程名稱', ' 演算法 ');
  fill('結束時間', '14');
  fireEvent.click(screen.getByRole('button', { name: '建立讀書會' }));
  expect(mocks.addDoc).not.toHaveBeenCalled();
  expect(document.activeElement).toBe(screen.getByLabelText('結束時間'));
  expect(screen.getByText('結束時間要晚於開始時間。')).toBeTruthy();
  fill('結束時間', '17');
  fill('每週見面日', '5');
  fill('讀書方式', 'discussion');
  fill('地點', ' ');
  const dialog = screen.getByRole('dialog', { name: '建立讀書會' });
  const form = dialog.querySelector('form')!;
  act(() => {
    fireEvent.submit(form);
    fireEvent.submit(form);
  });
  expect(mocks.addDoc).toHaveBeenCalledOnce();
  expect(mocks.addDoc).toHaveBeenCalledWith(['db', 'schools', 'pu', 'studyGroups'], {
    name: '演算法讀書會',
    courseName: '演算法',
    courseCode: '演算法',
    location: '待定',
    style: 'discussion',
    dayOfWeek: 5,
    startHour: 14,
    endHour: 17,
    maxMembers: 6,
    members: ['alice'],
    organizerUid: 'alice',
    organizerName: 'Alice',
    createdAt: 'server-time',
  });
  expect(screen.getByLabelText('結束時間').matches(':disabled')).toBe(true);
  expect(screen.getByLabelText('讀書會名稱').matches(':disabled')).toBe(true);
  fireEvent.click(screen.getByRole('button', { name: '取消' }));
  fireEvent(dialog, new Event('cancel', { bubbles: true, cancelable: true }));
  expect(close.mock.calls).toEqual([['retain'], ['retain']]);
  await act(async () => {
    resolve({ id: 'group-1' });
  });
  expect(saved).toHaveBeenCalledOnce();
});

it('preserves the group draft after a failed write and ignores a completion after unmount', async () => {
  mocks.addDoc.mockRejectedValueOnce(new Error('offline'));
  const saved = vi.fn();
  const view = render(
    <CreateGroupModal
      schoolId="pu"
      myUid="alice"
      myName="Alice"
      onClose={vi.fn()}
      onCreated={saved}
    />,
  );
  fill('讀書會名稱', '考前練習');
  fill('課程名稱', '資料庫');
  fireEvent.click(screen.getByRole('button', { name: '建立讀書會' }));
  await screen.findByText(
    '暫時無法確認建立結果，內容已保留。請先查看列表是否已出現，再決定是否重試。',
  );
  expect((screen.getByLabelText('讀書會名稱') as HTMLInputElement).value).toBe('考前練習');
  expect((screen.getByLabelText('課程名稱') as HTMLInputElement).value).toBe('資料庫');
  let resolve!: (value: { id: string }) => void;
  mocks.addDoc.mockImplementationOnce(
    () =>
      new Promise<{ id: string }>((done) => {
        resolve = done;
      }),
  );
  fireEvent.click(screen.getByRole('button', { name: '建立讀書會' }));
  view.unmount();
  await act(async () => {
    resolve({ id: 'group-2' });
  });
  expect(saved).not.toHaveBeenCalled();
});

it('keeps a slow group submission and a hidden failure in its real parent until a deliberate retry', async () => {
  let reject!: (error: Error) => void;
  mocks.addDoc.mockImplementationOnce(
    () =>
      new Promise<{ id: string }>((_, fail) => {
        reject = fail;
      }),
  );
  render(<StudyBuddyTab schoolId="pu" />);
  await screen.findByText('尚無評價');
  fireEvent.click(screen.getByRole('tab', { name: '讀書會' }));
  await screen.findByText('暫無讀書會');
  vi.useFakeTimers();
  fireEvent.click(screen.getByRole('button', { name: '＋ 建立讀書會' }));
  fill('讀書會名稱', '等待確認的讀書會');
  fill('課程名稱', '資料庫');
  fireEvent.click(screen.getByRole('button', { name: '建立讀書會' }));
  await act(async () => {
    await vi.advanceTimersByTimeAsync(15_000);
  });
  fireEvent.click(screen.getByRole('button', { name: '取消' }));
  expect(screen.queryByRole('dialog')).toBeNull();
  fireEvent.click(screen.getByRole('tab', { name: '課程評價' }));
  fireEvent.click(screen.getByRole('tab', { name: '讀書會' }));
  fireEvent.click(screen.getByRole('button', { name: '＋ 建立讀書會' }));
  expect((screen.getByLabelText('讀書會名稱') as HTMLInputElement).value).toBe('等待確認的讀書會');
  expect(screen.getByLabelText('讀書會名稱').matches(':disabled')).toBe(true);
  fireEvent.submit(screen.getByRole('dialog').querySelector('form')!);
  expect(mocks.addDoc).toHaveBeenCalledOnce();
  fireEvent.click(screen.getByRole('button', { name: '取消' }));
  await act(async () => {
    reject(new Error('permission-denied'));
  });
  expect(screen.queryByRole('dialog')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: '＋ 建立讀書會' }));
  expect((screen.getByLabelText('讀書會名稱') as HTMLInputElement).value).toBe('等待確認的讀書會');
  expect(screen.getByLabelText('讀書會名稱').matches(':disabled')).toBe(false);
  expect(screen.getByText(/暫時無法確認建立結果，內容已保留/)).toBeTruthy();

  let resolve!: (value: { id: string }) => void;
  mocks.addDoc.mockImplementationOnce(
    () =>
      new Promise<{ id: string }>((done) => {
        resolve = done;
      }),
  );
  fireEvent.click(screen.getByRole('button', { name: '建立讀書會' }));
  expect(mocks.addDoc).toHaveBeenCalledTimes(2);
  expect((screen.getByRole('button', { name: '取消' }) as HTMLButtonElement).disabled).toBe(false);
  await act(async () => {
    resolve({ id: 'group-1' });
  });
  expect(screen.queryByRole('dialog')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: '＋ 建立讀書會' }));
  expect((screen.getByLabelText('讀書會名稱') as HTMLInputElement).value).toBe('');
});
