import { describe, it } from 'vitest';
import assert from 'node:assert/strict';
import {
  reconcileSchoolCourses, schoolSemesterKey, schoolCourseHref,
  type AcademicComparisonCourse, type AcademicComparisonSnapshot, type LmsComparisonSnapshot,
} from './schoolCourseReconciliation';

const scope = { uid: 'student-one', schoolId: 'pu' };
function course(overrides: Partial<AcademicComparisonCourse> = {}): AcademicComparisonCourse {
  return { code: '0123', name: '資料庫管理', semester: '1151', classOffered: '資管三B',
    courseType: '必修', credits: 2.5, teacherName: '測試教師', timePlaceRaw: '三 2–4', location: '1655',
    scheduleWarning: null, ...overrides };
}
function academic(courses = [course()]): AcademicComparisonSnapshot {
  return { ownerUid: scope.uid, schoolId: 'pu', fetchedAt: '2026-10-28T00:00:00Z',
    records: { semester: '1151', sourceTotalCredits: 2.5, courses } };
}
function lms(): LmsComparisonSnapshot {
  return { ownerUid: scope.uid, schoolId: 'pu', source: 'pu-tronclass', fetchedAt: '2026-10-28T00:01:00Z',
    status: 'ongoing', courses: [{ id: 45, code: '0123', name: '資料庫課堂', semester: '1151' }] };
}

describe('校方課表與 WOW Class 來源核對', () => {
  it('保留校方學分、班別與原始時間，課堂由完整課號與學期配對', () => {
    const result = reconcileSchoolCourses(academic(), lms(), scope);
    assert.equal(result.matchedCount, 1);
    assert.equal(result.rows[0].credits, 2.5);
    assert.equal(result.rows[0].classOffered, '資管三B');
    assert.deepEqual(result.rows[0].schedule, ['三 2–4 · 1655']);
    assert.equal(result.rows[0].lms?.href, 'https://tronclass.pu.edu.tw/course/45/content');
    assert.equal(result.academicFetchedAt, '2026-10-28T00:00:00Z');
    assert.equal(result.lmsFetchedAt, '2026-10-28T00:01:00Z');
  });
  for (const term of ['1151', '115/1', '115／1', '１１５－１', '115學年度第一學期', '115 學年度 上學期']) {
    it(`辨識明確學期格式 ${term}`, () => {
      assert.equal(schoolSemesterKey(term), '115:1');
      const source = lms(); source.courses = [{ ...source.courses[0], semester: term }];
      assert.equal(reconcileSchoolCourses(academic(), source, scope).matchedCount, 1);
    });
  }
  it('不同學期的同課號不配對', () => {
    const source = lms(); source.courses = [{ ...source.courses[0], semester: '1142' }];
    const result = reconcileSchoolCourses(academic(), source, scope);
    assert.equal(result.rows[0].match, 'not-in-list'); assert.equal(result.unmatchedLms.length, 1);
  });
  it('不猜西元年份與 Fall 學期', () => {
    assert.notEqual(schoolSemesterKey('2026 Fall'), schoolSemesterKey('1151'));
    assert.equal(schoolSemesterKey(null), null); assert.equal(schoolSemesterKey('  '), null);
    assert.equal(schoolSemesterKey('115學年度下學期'), '115:2');
  });
  it('保留課號前導零，不截取四碼或靠同名配對', () => {
    for (const code of ['123', '1151-0123', 'prefix0123', '0 123', '9123']) {
      const source = lms(); source.courses = [{ ...source.courses[0], code, name: '資料庫管理' }];
      assert.equal(reconcileSchoolCourses(academic(), source, scope).matchedCount, 0);
    }
  });
  it('可處理全形課號與英文字母大小寫', () => {
    const source = lms(); source.courses = [{ ...source.courses[0], code: ' ａｂ１２ ' }];
    assert.equal(reconcileSchoolCourses(academic([course({ code: 'AB12' })]), source, scope).matchedCount, 1);
  });
  it('缺少學期或課號仍列出校方課程，不補造連結', () => {
    for (const patch of [{ semester: null }, { code: '' }]) {
      const result = reconcileSchoolCourses(academic([course(patch)]), lms(), scope);
      assert.equal(result.rows[0].match, 'missing-key'); assert.equal(result.rows[0].lms, null);
    }
  });
  it('一門課多個時段只展示一門學分，保留所有原始時段', () => {
    const result = reconcileSchoolCourses(academic([course(), course({ timePlaceRaw: '五 2', location: '1657' })]), lms(), scope);
    assert.equal(result.rows.length, 1); assert.equal(result.rows[0].credits, 2.5);
    assert.equal(result.rows[0].schedule.length, 2); assert.equal(result.sourceTotalCredits, 2.5);
  });
  it('完全重複的時段與教師不重複顯示', () => {
    const result = reconcileSchoolCourses(academic([course(), course()]), lms(), scope);
    assert.equal(result.rows[0].schedule.length, 1); assert.equal(result.rows[0].teachers.length, 1);
  });
  it('同課號多個班別不選第一筆來配對', () => {
    const result = reconcileSchoolCourses(academic([course(), course({ classOffered: '資管三A' })]), lms(), scope);
    assert.deepEqual(result.rows.map((row) => row.match), ['ambiguous', 'ambiguous']);
    assert.equal(result.unmatchedLms.length, 1); assert.equal(result.matchedCount, 0);
  });
  it('同課號不同名稱或修別視為需核對', () => {
    for (const patch of [{ name: '資料庫實作' }, { courseType: '選修' }]) {
      const result = reconcileSchoolCourses(academic([course(), course(patch)]), lms(), scope);
      assert.equal(result.needsReviewCount, 2); assert.equal(result.matchedCount, 0);
    }
  });
  it('LMS 同課號多課堂不猜班別', () => {
    const source = lms(); source.courses = [...source.courses, { ...source.courses[0], id: 46 }];
    const result = reconcileSchoolCourses(academic(), source, scope);
    assert.equal(result.rows[0].match, 'ambiguous'); assert.equal(result.unmatchedLms.length, 2);
  });
  it('同門不同時段的學分矛盾時保留待核對，不取第一筆學分', () => {
    const result = reconcileSchoolCourses(academic([course(), course({ credits: 3 })]), lms(), scope);
    assert.equal(result.rows[0].match, 'credit-conflict'); assert.equal(result.rows[0].credits, null);
    assert.equal(result.rows[0].lms, null);
  });
  it('零學分是有效資料；未知校方小計不由逐列加總補上', () => {
    const source = academic([course({ credits: 0 })]); source.records.sourceTotalCredits = null;
    const result = reconcileSchoolCourses(source, lms(), scope);
    assert.equal(result.rows[0].credits, 0); assert.equal(result.sourceTotalCredits, null);
    source.records.sourceTotalCredits = 0;
    assert.equal(reconcileSchoolCourses(source, lms(), scope).sourceTotalCredits, 0);
  });
  it('時間不完整時保留警告，不補造節次或鐘點', () => {
    const result = reconcileSchoolCourses(academic([course({ timePlaceRaw: '依教師公告', scheduleWarning: '待核對', location: '' })]), lms(), scope);
    assert.equal(result.rows[0].scheduleIncomplete, true);
    assert.deepEqual(result.rows[0].schedule, ['依教師公告']);
  });
  it('空清單不移除另一來源資料，也不推算學分小計', () => {
    const result = reconcileSchoolCourses(academic([]), lms(), scope);
    assert.equal(result.rows.length, 0); assert.equal(result.unmatchedLms.length, 1);
    const source = lms(); source.courses = [];
    assert.equal(reconcileSchoolCourses(academic(), source, scope).rows.length, 1);
  });
  for (const key of ['ownerUid', 'schoolId'] as const) {
    it(`拒絕 e 校園錯誤 ${key}`, () => assert.throws(() => reconcileSchoolCourses({ ...academic(), [key]: 'other' }, lms(), scope)));
    it(`拒絕 WOW Class 錯誤 ${key}`, () => assert.throws(() => reconcileSchoolCourses(academic(), { ...lms(), [key]: 'other' }, scope)));
  }
  it('非支援學校、訪客與錯誤來源不得核對', () => {
    assert.throws(() => reconcileSchoolCourses(academic(), lms(), { ...scope, schoolId: 'nthu' }));
    assert.throws(() => reconcileSchoolCourses(academic(), lms(), { ...scope, uid: '' }));
    assert.throws(() => reconcileSchoolCourses(academic(), { ...lms(), source: 'manual' }, scope));
    assert.throws(() => reconcileSchoolCourses(academic(), { ...lms(), status: 'all' }, scope));
  });
  it('只從有效課堂 ID 建立固定學校連結', () => {
    for (const id of [0, -1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) assert.throws(() => schoolCourseHref(id));
    const source = lms(); source.courses = [{ ...source.courses[0], href: 'https://evil.invalid/' } as LmsComparisonSnapshot['courses'][number]];
    assert.equal(reconcileSchoolCourses(academic(), source, scope).rows[0].lms?.href, schoolCourseHref(45));
  });
  it('拒絕重複課堂 ID', () => {
    const source = lms(); source.courses = [...source.courses, ...source.courses];
    assert.throws(() => reconcileSchoolCourses(academic(), source, scope));
  });
  it('拒絕不合法學分、時間與超量資料', () => {
    for (const credits of [-1, NaN, Infinity]) {
      assert.throws(() => reconcileSchoolCourses(academic([course({ credits })]), lms(), scope));
      const source = academic(); source.records.sourceTotalCredits = credits;
      assert.throws(() => reconcileSchoolCourses(source, lms(), scope));
    }
    assert.throws(() => reconcileSchoolCourses({ ...academic(), fetchedAt: 'bad' }, lms(), scope));
    assert.throws(() => reconcileSchoolCourses(academic(), { ...lms(), fetchedAt: 'bad' }, scope));
    assert.throws(() => reconcileSchoolCourses(academic(Array.from({ length: 1001 }, () => course())), lms(), scope));
  });
  it('不修改來源，反轉排列不影響配對結果', () => {
    const a = academic([course(), course({ code: '2222', name: '統計學' })]);
    const b = lms(); b.courses = [...b.courses, { id: 46, code: '2222', name: '統計', semester: '1151' }];
    const original = structuredClone({ a, b });
    const one = reconcileSchoolCourses(a, b, scope);
    const two = reconcileSchoolCourses({ ...a, records: { ...a.records, courses: [...a.records.courses].reverse() } }, { ...b, courses: [...b.courses].reverse() }, scope);
    assert.deepEqual({ a, b }, original);
    assert.deepEqual(one.rows.map((r) => r.lms?.id).sort(), two.rows.map((r) => r.lms?.id).sort());
  });
});


it('LMS 不可用時保留校方課程與學分，但不假造空 LMS 回應', () => {
  const result = reconcileSchoolCourses(academic(), null, scope);
  assert.equal(result.rows[0].credits, 2.5);
  assert.equal(result.rows[0].match, 'lms-unavailable');
  assert.equal(result.lmsAvailable, false);
  assert.equal(result.lmsFetchedAt, null);
  assert.equal(result.rows[0].lms, null);
});
