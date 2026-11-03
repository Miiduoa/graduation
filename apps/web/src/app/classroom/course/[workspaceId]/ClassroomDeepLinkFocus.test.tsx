import { act, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
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
