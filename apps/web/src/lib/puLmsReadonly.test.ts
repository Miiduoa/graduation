import { describe, expect, it } from 'vitest';
import {
  classifySchoolReadError,
  formatHomeworkDeadlineTaipei,
  homeworkDeadlineBucket,
  homeworkDescriptionText,
  homeworkPageAdvance,
  isHomeworkSubmitted,
  isHomeworkTodo,
  isMaterialActivityType,
  isMobileUploadDownloadable,
  isUploadDownloadable,
  schoolHttpStatus,
  selectDeadlineAxis,
} from '@campus/shared/src/puLmsReadonly';
import {
  LMS_FIXTURE_HOMEWORK_DONE,
  LMS_FIXTURE_HOMEWORK_OPEN,
  LMS_FIXTURE_HOMEWORK_OVERDUE,
  LMS_FIXTURE_HOMEWORK_WEEK,
  LMS_FIXTURE_NOW,
} from './server/fixtures/tronclass-lms-readonly';

describe('submitted boolean', () => {
  it('treats only strict true as submitted', () => {
    expect(isHomeworkSubmitted(LMS_FIXTURE_HOMEWORK_OPEN)).toBe(false);
    expect(isHomeworkSubmitted(LMS_FIXTURE_HOMEWORK_DONE)).toBe(true);
    expect(isHomeworkSubmitted({ submitted: 'true' })).toBe(false);
    expect(isHomeworkSubmitted({ submitted: 1 })).toBe(false);
    expect(isHomeworkSubmitted({ submitted: 'submitted' })).toBe(false);
    expect(isHomeworkTodo(LMS_FIXTURE_HOMEWORK_DONE)).toBe(false);
    expect(isHomeworkTodo(LMS_FIXTURE_HOMEWORK_OPEN)).toBe(true);
  });
});

describe('timezone display', () => {
  it('shows UTC deadlines in Taipei wall time', () => {
    expect(formatHomeworkDeadlineTaipei('2026-05-29T15:59:00Z')).toBe('2026/5/29 下午11:59');
    expect(homeworkDeadlineBucket('2026-05-28T15:59:00Z', LMS_FIXTURE_NOW)).toBe('overdue');
    expect(homeworkDeadlineBucket('2026-05-29T03:00:00Z', LMS_FIXTURE_NOW)).toBe('overdue');
    expect(homeworkDeadlineBucket('2026-05-29T15:59:00Z', LMS_FIXTURE_NOW)).toBe('today');
    expect(homeworkDeadlineBucket('2026-06-03T15:59:00Z', LMS_FIXTURE_NOW)).toBe('next7Days');
    expect(homeworkDeadlineBucket('2026-06-10T15:59:00Z', LMS_FIXTURE_NOW)).toBe('later');
  });
});

describe('deadline axis', () => {
  it('keeps submitted homework off the todo axis and overdue out of today', () => {
    const axis = selectDeadlineAxis([
      { ...LMS_FIXTURE_HOMEWORK_OPEN, deadline: LMS_FIXTURE_HOMEWORK_OPEN.deadline },
      { ...LMS_FIXTURE_HOMEWORK_DONE, deadline: LMS_FIXTURE_HOMEWORK_DONE.deadline },
      { ...LMS_FIXTURE_HOMEWORK_WEEK, deadline: LMS_FIXTURE_HOMEWORK_WEEK.deadline },
      { ...LMS_FIXTURE_HOMEWORK_OVERDUE, deadline: LMS_FIXTURE_HOMEWORK_OVERDUE.deadline },
    ], LMS_FIXTURE_NOW);
    expect(axis.overdue.map((item) => item.id)).toEqual([20004]);
    expect(axis.today.map((item) => item.id)).toEqual([20001]);
    expect(axis.next7Days.map((item) => item.id)).toEqual([20003]);
  });
});

describe('pagination', () => {
  it('continues until total is reached and flags truncated pages', () => {
    expect(homeworkPageAdvance({ page: 1, pageSize: 50, pageLength: 50, accumulated: 50, total: 80 })).toBe('continue');
    expect(homeworkPageAdvance({ page: 2, pageSize: 50, pageLength: 30, accumulated: 80, total: 80 })).toBe('complete');
    expect(homeworkPageAdvance({ page: 1, pageSize: 50, pageLength: 0, accumulated: 0, total: 0 })).toBe('complete');
    expect(homeworkPageAdvance({ page: 1, pageSize: 50, pageLength: 10, accumulated: 10, total: null })).toBe('complete');
    expect(homeworkPageAdvance({ page: 20, pageSize: 50, pageLength: 50, accumulated: 1000, total: 1200 })).toBe('incomplete');
    expect(homeworkPageAdvance({ page: 1, pageSize: 50, pageLength: 51, accumulated: 51, total: 51 })).toBe('incomplete');
  });
});

describe('errors and downloads', () => {
  it('separates session expiry from school 404/500', () => {
    expect(classifySchoolReadError(new Error('TronClass session 已失效，請重新登入'))).toBe('session');
    expect(classifySchoolReadError(new Error('HTTP 500'))).toBe('unavailable');
    expect(schoolHttpStatus(Object.assign(new Error('HTTP 404'), { status: 404 }))).toBe(404);
    expect(schoolHttpStatus(new Error('HTTP 500'))).toBe(500);
    expect(isUploadDownloadable({ allow_download: true })).toBe(true);
    expect(isUploadDownloadable({ allow_download: false })).toBe(false);
    expect(isUploadDownloadable({})).toBe(false);
    expect(isMobileUploadDownloadable({ allow_download: true })).toBe(true);
    expect(isMobileUploadDownloadable({ allow_download: false })).toBe(false);
    expect(isMobileUploadDownloadable({})).toBe(true);
    expect(isMaterialActivityType('material')).toBe(true);
    expect(isMaterialActivityType('courseware_activity')).toBe(true);
    expect(isMaterialActivityType('announcement')).toBe(false);
    expect(isMaterialActivityType('homework')).toBe(false);
  });
});

describe('homework description plain text', () => {
  it('drops script and style blocks including spaced and mixed-case closers', () => {
    expect(homeworkDescriptionText('<p>請上傳提案 PDF</p>')).toBe('請上傳提案 PDF');
    expect(homeworkDescriptionText('<script>alert(1)</script>可見')).toBe('可見');
    expect(homeworkDescriptionText('<script>alert(1)</script >可見')).toBe('可見');
    expect(homeworkDescriptionText('<SCRIPT TYPE="text/javascript">x</Script\t>可見')).toBe('可見');
    expect(homeworkDescriptionText('<style>body{color:red}</style>講義')).toBe('講義');
    expect(homeworkDescriptionText('<!-- 註解 --><b>正文</b>')).toBe('正文');
  });

  it('decodes each HTML entity only once so &amp;lt; stays &lt;', () => {
    expect(homeworkDescriptionText('&amp;lt;')).toBe('&lt;');
    expect(homeworkDescriptionText('A &amp; B')).toBe('A & B');
    expect(homeworkDescriptionText('A &lt; B &gt; C')).toBe('A < B > C');
    expect(homeworkDescriptionText('空白&nbsp;分隔')).toBe('空白 分隔');
  });

  it('caps input length and does not hang on repeated unclosed script openers', () => {
    const repeated = '<script'.repeat(4000);
    const started = Date.now();
    const text = homeworkDescriptionText(`${repeated}還有說明`);
    expect(Date.now() - started).toBeLessThan(100);
    expect(text).toBe('');
    expect(homeworkDescriptionText('x'.repeat(30_000), 12)).toBe('xxxxxxxxxxxx');
  });
});
