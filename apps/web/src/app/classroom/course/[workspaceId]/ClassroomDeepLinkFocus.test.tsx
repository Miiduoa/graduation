import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { useCoursePanel, type CoursePanel } from '@/features/nuni/useCoursePanel';
import {
  CLASSROOM_ASSIGNMENT_LOADING,
  CLASSROOM_ASSIGNMENT_MISSING,
} from '../../classroomDeepLink';
import { ClassroomDeepLinkFocus } from './ClassroomDeepLinkFocus';

const navigation = vi.hoisted(() => ({
  workspaceId: 'cw_11111111-1111-4111-8111-111111111111',
}));

vi.mock('next/navigation', () => ({
  useParams: () => ({ workspaceId: navigation.workspaceId }),
  useSearchParams: () => new URLSearchParams(window.location.search),
}));

beforeEach(() => {
  document.body.innerHTML = '';
  window.history.replaceState({}, '', '/classroom/course/cw_11111111-1111-4111-8111-111111111111');
});

afterEach(() => {
  document.body.innerHTML = '';
  vi.restoreAllMocks();
});

function setSearch(search: string) {
  window.history.replaceState(
    {},
    '',
    `/classroom/course/cw_11111111-1111-4111-8111-111111111111${search}`,
  );
}

it('作業卡尚未掛載時顯示仍在載入，不誤報找不到', () => {
  setSearch('?assignmentId=hw-1&view=assignments');
  render(<ClassroomDeepLinkFocus />);
  expect(screen.getByRole('status').textContent).toBe(CLASSROOM_ASSIGNMENT_LOADING);
  expect(screen.queryByText(CLASSROOM_ASSIGNMENT_MISSING)).toBeNull();
});

it('作業列表掛載且沒有該卡時才提示找不到', () => {
  setSearch('?assignmentId=missing-hw');
  document.body.innerHTML = `<section aria-label="課程作業"><p>尚未發布作業</p></section>`;
  render(<ClassroomDeepLinkFocus />);
  expect(screen.getByRole('status').textContent).toBe(CLASSROOM_ASSIGNMENT_MISSING);
});

it('submissions=1 等作業卡掛載後才自動打開繳交列表', async () => {
  setSearch('?assignmentId=hw-1&submissions=1');
  const click = vi.fn();
  render(<ClassroomDeepLinkFocus />);
  expect(screen.getByRole('status').textContent).toBe(CLASSROOM_ASSIGNMENT_LOADING);

  await act(async () => {
    const section = document.createElement('section');
    section.setAttribute('aria-label', '課程作業');
    section.innerHTML = `<article id="assignment-hw-1"><button type="button">查看繳交內容</button></article>`;
    const button = section.querySelector('button');
    if (button) button.onclick = click;
    document.body.append(section);
    await new Promise((resolve) => setTimeout(resolve, 80));
  });

  await waitFor(() => expect(click).toHaveBeenCalled());
  expect(screen.queryByRole('status')).toBeNull();
});

it('找到作業卡時清除載入與找不到提示', () => {
  setSearch('?assignmentId=hw-1');
  document.body.innerHTML = `
    <section aria-label="課程作業">
      <article id="assignment-hw-1"><button type="button">更新繳交內容</button></article>
    </section>
  `;
  render(<ClassroomDeepLinkFocus />);
  expect(screen.queryByText(CLASSROOM_ASSIGNMENT_LOADING)).toBeNull();
  expect(screen.queryByText(CLASSROOM_ASSIGNMENT_MISSING)).toBeNull();
});

function CourseJourney({ onSubmissions }: { onSubmissions: (id: string) => void }) {
  const { panel, navigate } = useCoursePanel();
  const [revision, setRevision] = useState(0);
  const tabs: [CoursePanel, string][] = [
    ['assignments', '作業'],
    ['materials', '教材'],
    ['quizzes', '測驗'],
  ];
  return (
    <>
      <ClassroomDeepLinkFocus />
      <nav aria-label="課程內容">
        {tabs.map(([value, label]) => (
          <button key={value} type="button" onClick={() => navigate(value)}>
            {label}
          </button>
        ))}
      </nav>
      <output data-testid="active-panel">{panel}</output>
      <section id="panel-assignments" hidden={panel !== 'assignments'}>
        <p key={revision} data-testid="course-revision">課程更新 {revision}</p>
        <section aria-label="課程作業">
          <article id="assignment-hw-1">
            <button type="button" onClick={() => onSubmissions('hw-1')}>查看繳交內容</button>
          </article>
          <article id="assignment-hw-2">
            第二份作業
            <button type="button" onClick={() => onSubmissions('hw-2')}>查看繳交內容</button>
          </article>
        </section>
      </section>
      <button type="button" onClick={() => setRevision((value) => value + 1)}>
        模擬課程資料更新
      </button>
    </>
  );
}

async function settleCourseUpdates() {
  // The real deep-link observer deliberately batches asynchronous course changes.
  await act(async () => new Promise((resolve) => setTimeout(resolve, 100)));
}

it('從通知開作業後，明確切教材不會被下一次課程更新拉回', async () => {
  setSearch('?campus=ntu&q=資料分析&assignmentId=hw-1&submissions=1&view=submissions');
  const openSubmissions = vi.fn();
  render(<CourseJourney onSubmissions={openSubmissions} />);
  await waitFor(() => expect(openSubmissions).toHaveBeenCalledTimes(1));
  expect(screen.getByTestId('active-panel').textContent).toBe('assignments');

  fireEvent.click(screen.getByRole('button', { name: '教材' }));
  fireEvent.click(screen.getByRole('button', { name: '模擬課程資料更新' }));
  await settleCourseUpdates();

  expect(screen.getByTestId('active-panel').textContent).toBe('materials');
  expect(window.location.hash).toBe('');
  const params = new URLSearchParams(window.location.search);
  expect(params.get('campus')).toBe('ntu');
  expect(params.get('q')).toBe('資料分析');
  expect(params.get('view')).toBe('materials');
  expect(params.has('assignmentId')).toBe(false);
  expect(params.has('submissions')).toBe(false);
  expect(openSubmissions).toHaveBeenCalledTimes(1);
});

it('從通知作業切到另一個作業目標後，不恢復舊 assignmentId', async () => {
  setSearch('?campus=ntu&assignmentId=hw-1&submissions=1');
  const openSubmissions = vi.fn();
  render(<CourseJourney onSubmissions={openSubmissions} />);
  await waitFor(() => expect(openSubmissions).toHaveBeenCalledTimes(1));

  act(() => {
    window.history.pushState(window.history.state, '', `${window.location.pathname}${window.location.search}#assignment-hw-2`);
    window.dispatchEvent(new HashChangeEvent('hashchange'));
  });
  fireEvent.click(screen.getByRole('button', { name: '模擬課程資料更新' }));
  await settleCourseUpdates();

  expect(window.location.hash).toBe('#assignment-hw-2');
  expect(screen.getByTestId('active-panel').textContent).toBe('assignments');
  expect(openSubmissions).toHaveBeenCalledTimes(1);
});

it('明確的教材與測驗 hash 優先於殘留的通知作業參數', async () => {
  setSearch('?campus=ntu&assignmentId=hw-1&submissions=1#quiz-quiz-1');
  const openSubmissions = vi.fn();
  render(<CourseJourney onSubmissions={openSubmissions} />);
  fireEvent.click(screen.getByRole('button', { name: '模擬課程資料更新' }));
  await settleCourseUpdates();

  expect(window.location.hash).toBe('#quiz-quiz-1');
  expect(screen.getByTestId('active-panel').textContent).toBe('quizzes');
  expect(openSubmissions).not.toHaveBeenCalled();
});

it('切換分頁後，瀏覽器上一頁恢復通知目標，下一頁仍回教材', async () => {
  setSearch('?campus=ntu&assignmentId=hw-1&submissions=1');
  const openSubmissions = vi.fn();
  render(<CourseJourney onSubmissions={openSubmissions} />);
  await waitFor(() => expect(openSubmissions).toHaveBeenCalledTimes(1));
  fireEvent.click(screen.getByRole('button', { name: '教材' }));
  await settleCourseUpdates();

  act(() => window.history.back());
  await waitFor(() => expect(screen.getByTestId('active-panel').textContent).toBe('assignments'));
  await waitFor(() => expect(openSubmissions).toHaveBeenCalledTimes(2));
  expect(window.location.hash).toBe('#assignment-hw-1');
  expect(new URLSearchParams(window.location.search).get('campus')).toBe('ntu');

  act(() => window.history.forward());
  await waitFor(() => expect(screen.getByTestId('active-panel').textContent).toBe('materials'));
  fireEvent.click(screen.getByRole('button', { name: '模擬課程資料更新' }));
  await settleCourseUpdates();
  expect(screen.getByTestId('active-panel').textContent).toBe('materials');
  expect(openSubmissions).toHaveBeenCalledTimes(2);
});

it('同一課程收到 Next 查詢參數導覽時處理新通知，不需要重新載入', async () => {
  setSearch('?campus=ntu&assignmentId=hw-1&submissions=1');
  const openSubmissions = vi.fn();
  const view = render(<CourseJourney onSubmissions={openSubmissions} />);
  await waitFor(() => expect(openSubmissions).toHaveBeenLastCalledWith('hw-1'));
  await settleCourseUpdates();

  // Next may update its search subscription without a popstate or hashchange.
  setSearch('?campus=ntu&assignmentId=hw-2&submissions=1');
  view.rerender(<CourseJourney onSubmissions={openSubmissions} />);

  await waitFor(() => expect(window.location.hash).toBe('#assignment-hw-2'));
  expect(openSubmissions).toHaveBeenLastCalledWith('hw-2');
  expect(openSubmissions).toHaveBeenCalledTimes(2);
});
