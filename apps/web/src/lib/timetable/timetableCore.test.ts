import { describe, expect, it } from 'vitest';
import {
  PERIOD_TIMES,
  SchedulePlanner,
  APPEAL_STATUS_COPY,
  appealTopCard,
  studySlots,
  friendResendCopy,
  canResendFriendRequest,
  applyImport,
  cleanCourse,
  commonFree,
  decodeTimetableShare,
  encodeTimetableShare,
  findCourseConflicts,
  freeBlocks,
  nextClass,
  parseTimetableText,
} from '@campus/shared';

const monday = (name: string, start: number, end = start) =>
  cleanCourse({ id: name, name, day: 1, start, end, teacher: '王老師', room: '主顧101' });

describe('靜宜節次', () => {
  it('第 1 節 08:10，第 13 節 21:40', () => {
    expect(PERIOD_TIMES[0]).toEqual(['08:10', '09:00']);
    expect(PERIOD_TIMES[12]).toEqual(['20:50', '21:40']);
    expect(PERIOD_TIMES).toHaveLength(13);
  });
});

describe('課表衝堂與匯入', () => {
  it('同一天重疊的課會被抓出來', () => {
    const conflicts = findCourseConflicts([monday('資料庫', 3, 4), monday('程式設計', 4, 5)]);
    expect(conflicts).toHaveLength(1);
  });

  it('合併匯入不會覆寫同名同時段，確認前呼叫端自己拿草稿', () => {
    const current = [monday('資料庫', 3, 4)];
    const drafts = [monday('資料庫', 3, 4), monday('專題', 6, 7)];
    expect(applyImport(current, drafts, 'merge').map((course) => course.name)).toEqual(['資料庫', '專題']);
    expect(applyImport(current, drafts, 'replace').map((course) => course.name)).toEqual(['資料庫', '專題']);
  });
});

describe('空堂與安排', () => {
  it('算出連續空堂，並回答下一堂', () => {
    const courses = [monday('資料庫', 1, 2), monday('專題', 5, 6)];
    expect(freeBlocks(courses, 1, 2)).toEqual(
      expect.arrayContaining([
        { day: 1, start: 3, end: 4 },
        { day: 1, start: 7, end: 13 },
      ]),
    );
    const now = new Date();
    now.setHours(8, 0, 0, 0);
    // Sunday 0 ... if test runs Sunday, nextClass still finds Monday.
    const planner = new SchedulePlanner(courses);
    expect(planner.ask('空堂')).toContain('空檔');
    expect(nextClass(courses, new Date('2026-10-12T08:00:00+08:00'))?.course.name).toBe('資料庫');
  });

  it('共同空堂要兩人都不上課', () => {
    const mine = [monday('資料庫', 1, 4)];
    const theirs = [monday('統計', 6, 8)];
    const blocks = commonFree(mine, theirs, 1);
    expect(blocks.some((block) => block.start === 9 && block.end === 13)).toBe(true);
    expect(blocks.some((block) => block.start <= 3 && block.end >= 3)).toBe(false);
    expect(blocks.some((block) => block.start === 5 && block.end === 5)).toBe(false);
  });
});

describe('婉拒後七天才能再送', () => {
  it('日期用台北時間算', () => {
    // 2026-10-11 20:00 UTC = 台北 10/12 04:00，加七天是 10/19
    const declined = Date.UTC(2026, 9, 11, 20, 0);
    expect(friendResendCopy(declined)).toBe('對方婉拒了，10 月 19 日之後才能再送。');
    expect(canResendFriendRequest(declined, declined + 6 * 86400000)).toBe(false);
    expect(canResendFriendRequest(declined, declined + 7 * 86400000 + 1)).toBe(true);
  });
});

describe('排讀書時間', () => {
  it('從空堂開始排指定時數', () => {
    const slots = studySlots([monday('資料庫', 1, 4)], 1, 2);
    expect(slots[0]).toBe('星期一 13:10–15:10');
    expect(studySlots([monday('整天', 1, 13)], 1, 1)).toEqual([]);
  });
});

describe('文字匯入與分享碼', () => {
  it('讀得懂貼上的課表列', () => {
    const courses = parseTimetableText('星期一 第3-4節 資料庫 / 王老師 / 主顧303\n星期三 第1節 英文');
    expect(courses[0]).toMatchObject({ name: '資料庫', day: 1, start: 3, end: 4, teacher: '王老師' });
    expect(courses[1]).toMatchObject({ name: '英文', day: 3, start: 1, end: 1 });
  });

  it('教室號碼不會被當成節次吃掉', () => {
    const courses = parseTimetableText(
      '星期一 第3-4節 資料庫 / 王老師 / 主顧303\n星期二 第5節 統計 / 李老師 / 任垣201\n星期四 6-7節 網路概論 / 陳老師 / 伯鐸 12',
    );
    expect(courses[0]).toMatchObject({ name: '資料庫', start: 3, end: 4, room: '主顧303' });
    expect(courses[1]).toMatchObject({ name: '統計', day: 2, start: 5, end: 5, room: '任垣201' });
    expect(courses[2]).toMatchObject({ name: '網路概論', day: 4, start: 6, end: 7, room: '伯鐸 12' });
  });

  it('分享碼可以來回', () => {
    const payload = {
      v: 1 as const,
      id: 'me',
      name: '阿瑋',
      t: 1,
      courses: [monday('資料庫', 3, 4)],
      meta: { school: '靜宜大學', year: '114', semester: '1', className: '資管三', credits: 18, title: '' },
    };
    const again = decodeTimetableShare(encodeTimetableShare(payload));
    expect(again.name).toBe('阿瑋');
    expect(again.courses[0].name).toBe('資料庫');
  });
});

describe('申訴頂卡', () => {
  const base = {
    schoolId: 'pu',
    studentUid: 's',
    courseId: 'c',
    courseName: '資料庫',
    title: '出缺席',
    body: '當天有請假單',
    teacherNote: '',
  };

  it('沒有案件時不顯示進度', () => {
    const card = appealTopCard([]);
    expect(card.status).toBeNull();
    expect(card.title).toBe('目前沒有申訴');
  });

  it('送出後是「已送出，等老師看。」，核准後換成「老師已核准。」', () => {
    const pending = { ...base, id: '1', status: 'pending' as const, createdAt: '2026-10-01', updatedAt: '2026-10-01' };
    expect(appealTopCard([pending]).body).toBe('已送出，等老師看。');
    const approved = { ...pending, status: 'approved' as const, updatedAt: '2026-10-03' };
    const older = { ...base, id: '2', status: 'pending' as const, createdAt: '2026-10-02', updatedAt: '2026-10-02' };
    const card = appealTopCard([older, approved]);
    expect(card.body).toBe('老師已核准。');
    expect(card.title).toBe('資料庫');
  });

  it('文案不出現內部用語', () => {
    const all = JSON.stringify(APPEAL_STATUS_COPY);
    expect(all).not.toMatch(/資料庫|本站|頂卡|教師/);
  });
});
