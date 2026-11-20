import { afterEach, expect, it, vi } from 'vitest';
import {
  CLASSROOM_ASSIGNMENT_LOADING,
  CLASSROOM_ASSIGNMENT_MISSING,
  CLASSROOM_TEACHER_SUBMISSION_LINK_LABEL,
  classroomAssignmentHash,
  classroomAssignmentsPanelReady,
  ensureTeacherSubmissionLinks,
  openClassroomSubmissionButton,
  parseClassroomDeepLink,
} from './classroomDeepLink';

afterEach(() => {
  document.body.innerHTML = '';
  vi.restoreAllMocks();
});

it('parses classroom assignment and submissions query params', () => {
  expect(parseClassroomDeepLink('?assignmentId=hw-1&submissions=1')).toEqual({
    assignmentId: 'hw-1',
    openSubmissions: true,
  });
  expect(parseClassroomDeepLink('?assignmentId=hw-1&view=submissions')).toEqual({
    assignmentId: 'hw-1',
    openSubmissions: true,
  });
  expect(parseClassroomDeepLink('?assignmentId=../x')).toEqual({
    assignmentId: null,
    openSubmissions: false,
  });
  expect(classroomAssignmentHash('hw-1')).toBe('#assignment-hw-1');
  expect(CLASSROOM_ASSIGNMENT_MISSING).toContain('找不到這份作業');
  expect(CLASSROOM_ASSIGNMENT_LOADING).toContain('載入');
  expect(classroomAssignmentsPanelReady(document.body)).toBe(false);
});

it('adds a teacher submission list link beside 查看或更新繳交內容 buttons', () => {
  document.body.innerHTML = `
    <article id="assignment-hw-1">
      <div class="toolbar">
        <button type="button">查看繳交內容</button>
      </div>
    </article>
    <article id="assignment-hw-2">
      <div class="toolbar"><span>學生畫面</span></div>
    </article>
    <article id="assignment-hw-3">
      <div class="toolbar">
        <button type="button">更新繳交內容</button>
      </div>
    </article>
  `;
  const added = ensureTeacherSubmissionLinks(
    document.body,
    'cw_11111111-1111-4111-8111-111111111111',
    '?campus=pu',
  );
  expect(added).toBe(2);
  const link = document.querySelector('#assignment-hw-1 [data-teacher-submission-link="true"]');
  expect(link?.textContent).toBe(CLASSROOM_TEACHER_SUBMISSION_LINK_LABEL);
  expect(link?.getAttribute('href')).toContain('assignmentId=hw-1');
  expect(link?.getAttribute('href')).toContain('submissions=1');
  expect(document.querySelector('#assignment-hw-2 [data-teacher-submission-link]')).toBeNull();
  expect(
    document.querySelector('#assignment-hw-3 [data-teacher-submission-link="true"]'),
  ).toBeTruthy();
  expect(
    ensureTeacherSubmissionLinks(
      document.body,
      'cw_11111111-1111-4111-8111-111111111111',
      '?campus=pu',
    ),
  ).toBe(0);
  expect(classroomAssignmentsPanelReady(document.body)).toBe(true);
});

it('clicks the existing teacher submissions button for deep link open', () => {
  const click = vi.fn();
  document.body.innerHTML = `<article id="assignment-hw-1"><button type="button">查看繳交內容</button></article>`;
  const button = document.querySelector('button');
  if (button) button.onclick = click;
  expect(openClassroomSubmissionButton(document.body, 'hw-1')).toBe(true);
  expect(click).toHaveBeenCalled();
  expect(openClassroomSubmissionButton(document.body, 'missing')).toBe(false);
});
