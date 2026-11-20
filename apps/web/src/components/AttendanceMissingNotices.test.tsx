import { act, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it } from 'vitest';
import { AttendanceMissingNotices } from './AttendanceMissingNotices';
import type { AttendanceSession } from '@/lib/courseAttendance';

const NOW = '2026-05-15T10:00:00+08:00';
const CLASS_START = '2026-05-15T09:00:00+08:00';
const CLASS_END = '2026-05-15T12:00:00+08:00';

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

it('學生：場次已結束且無簽到時顯示「沒有簽到紀錄」，不含缺席字樣', async () => {
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
  const root = await screen.findByTestId('attendance-missing-notices');
  expect(root.textContent).toContain('沒有簽到紀錄');
  expect(root.textContent).toContain('若有出席請向老師確認或申請更正');
  expect(root.textContent).not.toMatch(/缺席|曠課|扣分/);
});

it('老師：已對到本堂且已到上課時間、尚無場次時顯示「本堂尚未點名」', async () => {
  render(
    <AttendanceMissingNotices
      courseId="course"
      courseName="資料結構"
      viewerRole="teacher"
      sessions={[]}
      meeting={{ status: 'ready', startAt: CLASS_START, endAt: CLASS_END }}
      nowIso={NOW}
    />,
  );
  expect((await screen.findByTestId('attendance-missing-notices')).textContent).toContain(
    '本堂尚未點名',
  );
});

it('老師：課表未連結時不顯示本堂尚未點名，改顯示中性連結提示', async () => {
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
  const root = await screen.findByTestId('attendance-missing-notices');
  expect(root.textContent).toContain('連結課表後才能提醒是否尚未點名');
  expect(root.textContent).not.toContain('本堂尚未點名');
  expect(screen.getByTestId('attendance-schedule-link-hint')).toBeTruthy();
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

it('mount 後才套用 cooldown：首畫可顯示，寫入後同條件重掛載會降頻', async () => {
  const props = {
    courseId: 'course',
    courseName: '資料結構',
    viewerRole: 'teacher' as const,
    sessions: [] as AttendanceSession[],
    meeting: { status: 'ready' as const, startAt: CLASS_START, endAt: CLASS_END },
    nowIso: NOW,
  };
  const first = render(<AttendanceMissingNotices {...props} />);
  expect((await screen.findByTestId('attendance-missing-notices')).textContent).toContain(
    '本堂尚未點名',
  );
  await waitFor(() => {
    expect(sessionStorage.getItem('nuni.attendanceMissingNotice.recent')).toBeTruthy();
  });
  first.unmount();

  await act(async () => {
    render(<AttendanceMissingNotices {...props} />);
  });
  await waitFor(() => {
    expect(document.querySelector('[data-testid="attendance-missing-notices"]')).toBeNull();
  });
});
