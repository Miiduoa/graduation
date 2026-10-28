// @vitest-environment node
import { EventEmitter } from 'node:events';
import https from 'node:https';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { academicSchoolSource } from './academicSchoolSource';
import { normalizeGradeRecords } from '../academicRecords';

afterEach(() => vi.restoreAllMocks());

function replyWith(html: string) {
  vi.spyOn(https, 'request').mockImplementation((_options: unknown, onResponse: unknown) => {
    const req = new EventEmitter() as EventEmitter & { write: () => void; end: () => void };
    req.write = () => {};
    req.end = () => {
      const res = new EventEmitter() as EventEmitter & {
        headers: Record<string, string>;
        statusCode: number;
      };
      res.headers = {};
      res.statusCode = 200;
      (onResponse as (res: unknown) => void)(res);
      res.emit('data', Buffer.from(html));
      res.emit('end');
    };
    return req as unknown as ReturnType<typeof https.request>;
  });
}

describe('academicSchoolSource', () => {
  it('loads real backend parsers without cloud-functions configuration', async () => {
    replyWith(`<p>學期別(Semester)：114[2]</p><table>
      <tr><th>科目</th><th>班級</th><th>修別</th><th>學分</th><th>成績</th></tr>
      <tr><td>資料庫</td><td>資管</td><td>必修</td><td>3</td><td>88</td></tr></table>`);
    const result = await academicSchoolSource.grades({ session: 'fixture' }, '') as Record<string, unknown>;
    expect(result.success).toBe(true);
    expect(result.grades).toMatchObject([{ semester: '1142', courseName: '資料庫', credits: 3, score: 88 }]);
    expect(result.creditSummary).toMatchObject({
      source: 'derived-from-grade-rows', officialAudit: false, totalRequired: null, totalEarned: 3,
    });
    expect(result.cookies).toBeUndefined();
  });

  it('keeps partial coverage and conservative credit provenance', async () => {
    replyWith(`<p>學期別(Semester)：114[2]</p><table>
      <tr><th>科目</th><th>班級</th><th>修別</th><th>學分</th><th>成績</th></tr>
      <tr><td>服務學習</td><td>資管</td><td>其他</td><td>0.5</td><td>Pass</td></tr>
      <tr><td>未能辨識學分</td><td>資管</td><td>必修</td><td>unknown</td><td>88</td></tr></table>`);
    const result = await academicSchoolSource.grades({ session: 'fixture' }, '') as Record<string, unknown>;
    expect(result.coverage).toEqual({ status: 'partial', skippedRows: 1 });
    expect(result.creditSummary).toMatchObject({ totalEarned: 0.5, officialAudit: false, totalRequired: null });
  });

  it('does not turn an unrecognized school document into empty success', async () => {
    replyWith('<html><body>系統維護中</body></html>');
    expect(await academicSchoolSource.grades({ session: 'fixture' }, '')).toMatchObject({ success: false });
  });
});

describe('academicSchoolSource full grade pipeline', () => {
  it('retains an unverified SAT label without awarding its fractional credits', async () => {
    replyWith(`<p>學期別(Semester)：114[2]</p><table>
      <tr><th>科目</th><th>班級</th><th>修別</th><th>學分</th><th>成績</th></tr>
      <tr><td>資料庫</td><td>資管</td><td>必修</td><td>3</td><td>88</td></tr>
      <tr><td>服務學習</td><td>資管</td><td>其他</td><td>0.5</td><td>SAT</td></tr></table>`);
    const result = await academicSchoolSource.grades({ session: 'fixture' }, '') as Record<string, unknown>;
    expect(result.success).toBe(true);
    expect(result.creditSummary).toMatchObject({
      source: 'derived-from-grade-rows', officialAudit: false, totalRequired: null, totalEarned: 3,
    });
    const parsed = normalizeGradeRecords(result);
    expect(parsed.creditSummaryUnavailable).not.toBe(true);
    expect(parsed.creditSummary).toMatchObject({ totalEarned: 3, totalCourses: 2 });
    expect(parsed.grades.find((grade) => grade.courseName === '服務學習')).toMatchObject({ score: 'SAT', credits: 0.5 });
  });

  it('the browser keeps grade rows if optional credit summary is malformed', async () => {
    const parsed = normalizeGradeRecords({
      success: true, allSemesters: ['1142'],
      grades: [{ semester: '1142', courseName: '資料庫', courseType: '必修', credits: 3, score: 88 }],
      creditSummary: { source: 'derived-from-grade-rows', officialAudit: false, totalRequired: null, totalEarned: 'unknown' },
    });
    expect(parsed.grades).toHaveLength(1);
    expect(parsed.creditSummaryUnavailable).toBe(true);
  });

  it('unreadable pages never acquire a successful summary while crossing the adapter', async () => {
    replyWith('<html><body>校務系統維護中</body></html>');
    const result = await academicSchoolSource.grades({ session: 'fixture' }, '') as Record<string, unknown>;
    expect(result.success).toBe(false);
    expect(result.creditSummary).toBeUndefined();
  });

  it.each([
    ['Pass', 3.5], ['通過', 3.5], ['通過(Pass)', 3.5],
    ['SAT', 3], ['UNSAT', 3], ['A+', 3], ['抵免', 3], ['免修', 3],
    ['未完成', 3], ['', 3], ['0', 3], ['59.5', 3], ['Fail', 3], ['不通過', 3],
  ] as const)('keeps raw results and a conservative derived summary for %s', async (score, earned) => {
    replyWith(`<p>學期別(Semester)：114[2]</p><table>
      <tr><th>科目</th><th>班級</th><th>修別</th><th>學分</th><th>成績</th></tr>
      <tr><td>資料庫</td><td>資管</td><td>必修</td><td>3</td><td>88</td></tr>
      <tr><td>原始結果</td><td>資管</td><td>其他</td><td>0.5</td><td>${score}</td></tr></table>`);
    const result = await academicSchoolSource.grades({ session: 'fixture' }, '');
    const parsed = normalizeGradeRecords(result);
    expect(parsed.grades).toHaveLength(2);
    expect(parsed.grades[1].credits).toBe(0.5);
    expect(parsed.creditSummaryUnavailable).not.toBe(true);
    expect(parsed.creditSummary).toMatchObject({ totalEarned: earned, totalCourses: 2, officialAudit: false, totalRequired: null });
    if (['SAT', 'UNSAT', 'A+', '抵免', '免修', '未完成', '', 'Fail', '不通過'].includes(score)) {
      expect(parsed.grades[1].score).toBe(score);
    }
  });
});
