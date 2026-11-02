import { render, screen } from '@testing-library/react';
import { afterEach, expect, it } from 'vitest';
import { AttendanceMissingNotices } from './AttendanceMissingNotices';
import type { AttendanceSession } from '@/lib/courseAttendance';

const NOW = '2026-05-15T10:00:00+08:00';

afterEach(() => {
  sessionStorage.clear();
});

function endedSession(): AttendanceSession {
  return {
    id: 's-ended',
    teacherId: 't1',
    active: false,
    startedAt: '2026-05-15T09:00:00+08:00',
    endedAt: '2026-05-15T09:10:00+08:00',
    qrExpiresAt: '2026-05-15T09:10:00+08:00',
    attendeeCount: 0,
    ownRecord: null,
    ownStatus: null,
  };
}

it('學生：場次已結束且無簽到時顯示「沒有簽到紀錄」，不含缺席字樣', () => {
  render(
    <AttendanceMissingNotices
      courseId="course"
      courseName="資料結構"
      viewerRole="student"
      sessions={[endedSession()]}
      meeting={{ status: 'unlinked' }}
      nowIso={NOW}
    />,
  );
  const root = screen.getByTestId('attendance-missing-notices');
  expect(root.textContent).toContain('沒有簽到紀錄');
  expect(root.textContent).toContain('若有出席請向老師確認或申請更正');
  expect(root.textContent).not.toMatch(/缺席|曠課|扣分/);
});

it('老師：尚無場次時顯示「本堂尚未點名」', () => {
  render(
    <AttendanceMissingNotices
      courseId="course"
      courseName="資料結構"
      viewerRole="teacher"
      sessions={[]}
      meeting={{ status: 'unlinked' }}
      nowIso={NOW}
    />,
  );
  expect(screen.getByTestId('attendance-missing-notices').textContent).toContain('本堂尚未點名');
});

it('課表錯誤且無場次時不顯示提示', () => {
  const { container } = render(
    <AttendanceMissingNotices
      courseId="course"
      courseName="資料結構"
      viewerRole="student"
      sessions={[]}
      meeting={{ status: 'error' }}
      nowIso={NOW}
    />,
  );
  expect(container.querySelector('[data-testid="attendance-missing-notices"]')).toBeNull();
});
