import type { ReactNode } from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { renderToString } from 'react-dom/server';
import { hydrateRoot, type Root } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';
import { StudentGradesBoard, StudentGradesPage } from './StudentGrades';
import {
  GRADE_COPY,
  type CourseGradeSection,
  type GradeItem,
  type StudentGradebook,
  markPublishedGradeRead,
} from '@/lib/lmsStudentGrades';

const sessionState = vi.hoisted(() => ({
  session: null as null | { context: string; platformAccountId: string },
  loading: false,
  error: '',
  pendingLogout: false,
  refresh: vi.fn(),
}));
const authState = vi.hoisted(() => ({
  user: null as null | { uid: string },
  loading: false,
}));
const loaders = vi.hoisted(() => ({
  nuni: vi.fn(),
  school: vi.fn(),
}));

vi.mock('./Session', () => ({
  useNuniSession: () => sessionState,
  browserRequest: vi.fn(),
}));
vi.mock('@/lib/nuniStudentGrades', () => ({
  loadNuniStudentGrades: (...args: unknown[]) => loaders.nuni(...args),
  isNuniSessionError: () => false,
}));
vi.mock('@/lib/schoolStudentGrades', () => ({
  loadSchoolStudentGrades: (...args: unknown[]) => loaders.school(...args),
}));
vi.mock('@/components/AuthGuard', () => ({
  useAuth: () => authState,
}));
vi.mock('@/components/SiteShell', () => ({
  SiteShell: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));
vi.mock('@/components/NuniSignIn', () => ({
  NuniSignIn: () => <button type="button">使用 Google 帳號繼續</button>,
}));
vi.mock('next/link', () => ({
  default: ({
    href,
    children,
    ...props
  }: {
    href: string;
    children: ReactNode;
    onClick?: () => void;
  }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

const ownerId = 'nuni:pa_1';

afterEach(() => {
  window.localStorage.clear();
  sessionState.session = null;
  sessionState.loading = false;
  sessionState.error = '';
  sessionState.pendingLogout = false;
  authState.user = null;
  authState.loading = false;
  loaders.nuni.mockReset();
  loaders.school.mockReset();
});

function item(patch: Partial<GradeItem> = {}): GradeItem {
  return {
    source: 'nuni',
    kind: 'assignment',
    id: 'cwa_00000000-0000-0000-0000-000000000001',
    courseId: 'cw_00000000-0000-0000-0000-000000000001',
    courseName: '資料庫',
    title: '作業一',
    status: 'graded',
    score: null,
    points: null,
    feedback: '請補充資料來源',
    publishedAt: '2026-10-09T04:00:00Z',
    submittedAt: '2026-10-08T00:00:00Z',
    submissionPreview: '我的繳交內容',
    href: '/classroom/course/cw_00000000-0000-0000-0000-000000000001#assignment-cwa_00000000-0000-0000-0000-000000000001',
    closed: false,
    staleFeedback: false,
    hasNumericScore: false,
    ...patch,
  };
}

function book(courses: CourseGradeSection[]): StudentGradebook {
  return { teachingCount: 0, courses, listError: null };
}

function section(patch: Partial<CourseGradeSection> = {}): CourseGradeSection {
  return {
    source: 'nuni',
    courseId: 'cw_00000000-0000-0000-0000-000000000001',
    courseName: '資料庫',
    href: '/classroom/course/cw_00000000-0000-0000-0000-000000000001',
    archived: false,
    status: 'ready',
    error: null,
    assignmentError: null,
    quizError: null,
    items: [item()],
    ...patch,
  };
}

it('shows graded, waiting and missing work and does not invent a nuni score', () => {
  const onOpen = vi.fn();
  render(
    <StudentGradesBoard
      nuni={book([
        section({
          items: [
            item(),
            item({
              id: 'cwa_00000000-0000-0000-0000-000000000002',
              title: '作業二',
              status: 'waiting',
              feedback: null,
              publishedAt: null,
              href: '/classroom/course/cw_00000000-0000-0000-0000-000000000001#assignment-cwa_00000000-0000-0000-0000-000000000002',
            }),
            item({
              id: 'cwa_00000000-0000-0000-0000-000000000003',
              title: '作業三',
              status: 'missing',
              feedback: null,
              publishedAt: null,
              submittedAt: null,
              submissionPreview: null,
              href: '/classroom/course/cw_00000000-0000-0000-0000-000000000001#assignment-cwa_00000000-0000-0000-0000-000000000003',
            }),
          ],
        }),
      ])}
      school={null}
      ownerId={ownerId}
      filter="all"
      onFilter={vi.fn()}
      onOpen={onOpen}
    />,
  );
  expect(screen.getByText(GRADE_COPY.feedbackOnly)).toBeTruthy();
  expect(screen.getByText(GRADE_COPY.unpublished)).toBeTruthy();
  expect(screen.getByText(GRADE_COPY.missingOpen)).toBeTruthy();
  expect(screen.getAllByText('你交的內容：我的繳交內容').length).toBe(2);
  expect(screen.getByText('老師評語：請補充資料來源')).toBeTruthy();
  expect(screen.getAllByText(GRADE_COPY.unread).length).toBeGreaterThan(0);
  expect(screen.queryByText(/97/)).toBeNull();
  fireEvent.click(screen.getByRole('link', { name: /作業一/ }));
  expect(onOpen).toHaveBeenCalled();
  expect(screen.getByRole('link', { name: /作業一/ }).getAttribute('href')).toContain(
    '#assignment-',
  );
});

it('keeps a failed course from hiding another course that already loaded', () => {
  render(
    <StudentGradesBoard
      nuni={book([
        section(),
        section({
          courseId: 'cw_00000000-0000-0000-0000-000000000002',
          courseName: '線性代數',
          status: 'offline',
          error: GRADE_COPY.offline,
          items: [],
        }),
      ])}
      school={null}
      ownerId={ownerId}
      filter="all"
      onFilter={vi.fn()}
      onOpen={vi.fn()}
    />,
  );
  expect(screen.getByRole('heading', { name: '資料庫' })).toBeTruthy();
  expect(screen.getByRole('heading', { name: '線性代數' })).toBeTruthy();
  expect(screen.getByText(GRADE_COPY.offline)).toBeTruthy();
  expect(screen.getByRole('link', { name: /作業一/ })).toBeTruthy();
});

it('filters unread after a result has been opened', () => {
  const graded = item();
  markPublishedGradeRead(ownerId, graded);
  const onFilter = vi.fn();
  render(
    <StudentGradesBoard
      nuni={book([section({ items: [graded] })])}
      school={null}
      ownerId={ownerId}
      filter="unread"
      onFilter={onFilter}
      onOpen={vi.fn()}
    />,
  );
  expect(screen.queryByRole('link', { name: /作業一/ })).toBeNull();
  expect(screen.getByText(GRADE_COPY.emptyFilter)).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: /全部/ }));
  expect(onFilter).toHaveBeenCalledWith('all');
});

it('keeps school unread independent of a nuni owner', () => {
  const schoolItem = item({
    source: 'school',
    courseId: 'cs101',
    href: '/course/cs101#assignment-cwa_00000000-0000-0000-0000-000000000001',
  });
  markPublishedGradeRead('nuni:pa_1', schoolItem);
  render(
    <StudentGradesBoard
      nuni={null}
      school={book([
        section({
          source: 'school',
          courseId: 'cs101',
          href: '/course/cs101',
          items: [schoolItem],
        }),
      ])}
      nuniAccountId="pa_1"
      schoolUid="alice"
      filter="all"
      onFilter={vi.fn()}
      onOpen={vi.fn()}
    />,
  );
  expect(screen.getAllByText(GRADE_COPY.unread).length).toBeGreaterThan(0);
  expect(screen.getByRole('link', { name: /作業一/ }).textContent).toContain(GRADE_COPY.unread);
});

it('asks an unsigned visitor to sign in instead of showing a fake gradebook', () => {
  render(<StudentGradesPage />);
  expect(screen.getByRole('heading', { name: '課業成績與回饋' })).toBeTruthy();
  expect(screen.getByText(GRADE_COPY.unsigned)).toBeTruthy();
  expect(screen.getByRole('button', { name: '使用 Google 帳號繼續' })).toBeTruthy();
  expect(screen.queryByRole('link', { name: '學校帳號登入' })).toBeNull();
  expect(screen.getByText(/學校成績請切換至學期成績/)).toBeTruthy();
});

it('says it is loading while the session is still resolving', () => {
  sessionState.loading = true;
  render(<StudentGradesPage />);
  expect(screen.getByRole('status').textContent).toBe(GRADE_COPY.loading);
});

it('hydrates the signed-in grades page against the server loading markup', async () => {
  sessionState.session = { context: 'session-a', platformAccountId: 'student-a' };
  sessionState.loading = false;
  authState.user = { uid: 'alice' };
  loaders.nuni.mockResolvedValue(book([section()]));
  loaders.school.mockResolvedValue(book([]));
  const app = <StudentGradesPage />;
  const container = document.createElement('div');
  container.innerHTML = renderToString(app);
  document.body.append(container);
  expect(container.querySelector('[role="status"]')?.textContent).toBe(GRADE_COPY.loading);
  expect(container.textContent).not.toContain(GRADE_COPY.unread);
  expect(container.querySelector('time')).toBeNull();
  const onRecoverableError = vi.fn();
  let root: Root | undefined;
  try {
    await act(async () => {
      root = hydrateRoot(container, app, { onRecoverableError });
    });
    expect(onRecoverableError).not.toHaveBeenCalled();
    const homework = await screen.findByRole('link', { name: /作業一/ });
    expect(homework.textContent).toContain(GRADE_COPY.unread);
    expect(container.querySelector('time')).toBeTruthy();
  } finally {
    await act(async () => root?.unmount());
    container.remove();
  }
});

it('hydrates published grade rows without unread or time on the server markup', async () => {
  const app = (
    <StudentGradesBoard
      nuni={book([section()])}
      school={null}
      ownerId={ownerId}
      filter="all"
      onFilter={vi.fn()}
      onOpen={vi.fn()}
    />
  );
  const container = document.createElement('div');
  container.innerHTML = renderToString(app);
  document.body.append(container);
  expect(container.textContent).toContain('作業一');
  expect(container.querySelector('[aria-label="成績摘要"]')?.textContent).toContain('未讀0');
  expect(container.querySelector('a[href*="#assignment-"]')?.textContent).not.toContain(
    GRADE_COPY.unread,
  );
  expect(container.querySelector('time')).toBeNull();
  const onRecoverableError = vi.fn();
  let root: Root | undefined;
  try {
    await act(async () => {
      root = hydrateRoot(container, app, { onRecoverableError });
    });
    expect(onRecoverableError).not.toHaveBeenCalled();
    await waitFor(() =>
      expect(screen.getByRole('link', { name: /作業一/ }).textContent).toContain(GRADE_COPY.unread),
    );
    expect(container.querySelector('time')?.dateTime).toBe('2026-10-09T04:00:00Z');
  } finally {
    await act(async () => root?.unmount());
    container.remove();
  }
});

it('guides an empty nuni gradebook to courses without reading the school source', async () => {
  sessionState.session = { context: 'session-a', platformAccountId: 'student-a' };
  loaders.nuni.mockResolvedValue({ teachingCount: 0, courses: [], listError: null });
  render(<StudentGradesPage />);
  expect(await screen.findByText(GRADE_COPY.emptyCourses, { exact: false })).toBeTruthy();
  expect(screen.getByRole('link', { name: '加入 nuni 課程' }).getAttribute('href')).toBe(
    '/classroom',
  );
  expect(loaders.school).not.toHaveBeenCalled();
});

it('retries a failed nuni gradebook instead of presenting it as empty', async () => {
  sessionState.session = { context: 'session-a', platformAccountId: 'student-a' };
  loaders.nuni
    .mockResolvedValueOnce({ teachingCount: 0, courses: [], listError: '讀取失敗' })
    .mockResolvedValueOnce({ teachingCount: 0, courses: [], listError: null });
  render(<StudentGradesPage />);
  expect(await screen.findByText(/課程空間名單還沒讀到/)).toBeTruthy();
  expect(screen.queryByText(GRADE_COPY.emptyCourses)).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: '更新成績' }));
  expect(await screen.findByRole('link', { name: '加入 nuni 課程' })).toBeTruthy();
});

it('requires nuni sign-in when only a school account is signed in', () => {
  authState.user = { uid: 'school-only' };
  render(<StudentGradesPage />);
  expect(screen.getByText(GRADE_COPY.unsigned)).toBeTruthy();
  expect(screen.getByRole('button', { name: '使用 Google 帳號繼續' })).toBeTruthy();
  expect(screen.queryByLabelText('成績摘要')).toBeNull();
  expect(screen.queryByRole('button', { name: '更新成績' })).toBeNull();
  expect(loaders.nuni).not.toHaveBeenCalled();
  expect(loaders.school).not.toHaveBeenCalled();
});
