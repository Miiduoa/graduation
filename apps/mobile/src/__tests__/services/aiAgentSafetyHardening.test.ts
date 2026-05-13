/* eslint-disable @typescript-eslint/no-explicit-any */

jest.mock('../../firebase', () => ({
  getFirebaseApp: jest.fn(() => ({})),
  hasUsableFirebaseConfig: jest.fn(() => false),
}));

import { mockSource } from '../../data/mockSource';
import { setDataSource } from '../../data/source';
import {
  autonomousQuery,
  resetAdaptiveLearnedPatternsForTests,
  type AgentQueryResult,
} from '../../services/aiLocalAgent';

const STUDENT_CTX = {
  userId: 'safety-hardening-user',
  schoolId: 'pu',
  role: 'student' as const,
  isOnline: true,
};

const TEACHER_CTX = {
  ...STUDENT_CTX,
  userId: 'safety-hardening-teacher',
  role: 'teacher' as const,
};

beforeEach(() => {
  resetAdaptiveLearnedPatternsForTests();
  jest.clearAllMocks();
  setDataSource(mockSource as any);
});

function observedTools(result: AgentQueryResult): Set<string> {
  return new Set([
    ...result.intents.map((i) => i.tool),
    ...result.results.map((r) => r.tool),
    ...result.executedActions.map((a) => a.tool),
    ...result.failedActions.map((a) => a.tool),
  ]);
}

function expectMissing(result: AgentQueryResult, tool: string, field: string): void {
  expect(
    result.failedActions.some(
      (a) => a.tool === tool && a.missingInfo.includes(field),
    ),
  ).toBe(true);
  expect(result.executedActions.some((a) => a.tool === tool)).toBe(false);
}

async function expectBlockedWrite(
  message: string,
  tool: string,
  missingField: string,
  writeSpies: jest.Mock[],
  overrides: Record<string, any>,
  ctx = STUDENT_CTX,
): Promise<AgentQueryResult> {
  setDataSource({ ...mockSource, ...overrides } as any);
  const result = await autonomousQuery(message, ctx);

  expect(observedTools(result).has(tool)).toBe(true);
  expectMissing(result, tool, missingField);
  for (const spy of writeSpies) {
    expect(spy).not.toHaveBeenCalled();
  }
  return result;
}

describe('AI 代理安全加固：缺少真實目標時不可執行寫入', () => {
  it('私訊查不到對象時不可把人名當 peerId 發送', async () => {
    const sendMessage = jest.fn();
    await expectBlockedWrite(
      '通知不存在同學明天不用來',
      'send_message',
      'peerId',
      [sendMessage],
      {
        listConversations: jest.fn(async () => []),
        sendMessage,
      },
    );
  });

  it('退選與選課找不到課程或選課紀錄時不可寫入', async () => {
    const dropCourse = jest.fn();
    await expectBlockedWrite(
      '我要退選火星量子課',
      'drop_course',
      'enrollmentId',
      [dropCourse],
      {
        listEnrollments: jest.fn(async () => []),
        dropCourse,
      },
    );

    const enrollCourse = jest.fn();
    await expectBlockedWrite(
      '我要選火星量子課',
      'enroll_course',
      'courseId',
      [enrollCourse],
      {
        listCourses: jest.fn(async () => []),
        enrollCourse,
      },
    );
  });

  it('沒有借閱紀錄時不可續借或還書', async () => {
    const renewBook = jest.fn();
    await expectBlockedWrite(
      '幫我續借火星書',
      'renew_book',
      'loanId',
      [renewBook],
      {
        listLoans: jest.fn(async () => []),
        renewBook,
      },
    );

    const returnBook = jest.fn();
    await expectBlockedWrite(
      '幫我還火星書',
      'return_book',
      'loanId',
      [returnBook],
      {
        listLoans: jest.fn(async () => []),
        returnBook,
      },
    );
  });

  it('找不到行事曆事件時不可修改或刪除', async () => {
    const updateCalendarEvent = jest.fn();
    await expectBlockedWrite(
      '修改行程火星會議到明天晚上',
      'update_calendar_event',
      'eventId',
      [updateCalendarEvent],
      {
        listCalendarEvents: jest.fn(async () => []),
        updateCalendarEvent,
      },
    );

    const deleteCalendarEvent = jest.fn();
    await expectBlockedWrite(
      '刪除行程火星會議',
      'delete_calendar_event',
      'eventId',
      [deleteCalendarEvent],
      {
        listCalendarEvents: jest.fn(async () => []),
        deleteCalendarEvent,
      },
    );
  });

  it('群組缺代碼時不可加入或發文', async () => {
    const joinGroup = jest.fn();
    await expectBlockedWrite(
      '加入讀書會',
      'join_group',
      'groupId',
      [joinGroup],
      { joinGroup },
    );

    const createGroupPost = jest.fn();
    await expectBlockedWrite(
      '在讀書會發文說有人要一起刷題嗎',
      'create_group_post',
      'groupId',
      [createGroupPost],
      { createGroupPost },
    );
  });

  it('沒有座位預約或待領包裹時不可確認取消/領取', async () => {
    const cancelSeatReservation = jest.fn();
    await expectBlockedWrite(
      '取消圖書館座位預約',
      'cancel_seat_reservation',
      'reservationId',
      [cancelSeatReservation],
      {
        listSeats: jest.fn(async () => []),
        cancelSeatReservation,
      },
    );

    const confirmPackagePickup = jest.fn();
    await expectBlockedWrite(
      '我已經領包裹了幫我確認',
      'confirm_package_pickup',
      'packageId',
      [confirmPackagePickup],
      {
        getDormitoryInfo: jest.fn(async () => null),
        listDormPackages: jest.fn(async () => []),
        listWashingMachines: jest.fn(async () => []),
        confirmPackagePickup,
      },
    );
  });

  it('教師代理缺課程/繳交紀錄時不可啟動或批改', async () => {
    const startAttendanceSession = jest.fn();
    await expectBlockedWrite(
      '開始這堂不存在的課點名',
      'start_attendance',
      'courseSpaceId',
      [startAttendanceSession],
      {
        listCourses: jest.fn(async () => []),
        startAttendanceSession,
      },
      TEACHER_CTX,
    );

    const gradeSubmission = jest.fn();
    await expectBlockedWrite(
      '批改學生作業給 90 分',
      'grade_submission',
      'submissionId',
      [gradeSubmission],
      { gradeSubmission },
      TEACHER_CTX,
    );
  });

  it('評分找不到指定餐點時不可改評菜單第一項', async () => {
    const rateMenuItem = jest.fn();
    await expectBlockedWrite(
      '火星套餐給五分',
      'rate_menu_item',
      'menuItemId',
      [rateMenuItem],
      {
        listMenus: jest.fn(async () => []),
        rateMenuItem,
      },
    );
  });
});
