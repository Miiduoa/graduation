import {
  exportManualCreditCsv,
  manualCreditAmount,
  manualCreditProgress,
  mayOfferPuCsie115Reference,
  parseCreditCsvRows,
  parseManualCreditCsv,
  validCourseName,
} from '../screens/creditAudit/manualCreditCourses';
import type { SavedCourse } from '../features/academics';

const course = (patch: Partial<SavedCourse> = {}): SavedCourse => ({
  id: 'c1',
  name: '資料庫系統',
  credits: 3,
  category: 'required',
  passed: false,
  semester: '115-1',
  createdAt: '2026-10-01T00:00:00.000Z',
  syncedToCloud: false,
  ...patch,
});

describe('manual academic credits', () => {
  test('does not offer a wrong graduation template to other schools or departments', () => {
    expect(mayOfferPuCsie115Reference('pu', '資訊工程學系')).toBe(true);
    expect(mayOfferPuCsie115Reference('tw-pu', '資訊工程學系')).toBe(true);
    expect(mayOfferPuCsie115Reference('pu', '資訊管理學系')).toBe(false);
    expect(mayOfferPuCsie115Reference('nchu', '資訊工程學系')).toBe(false);
    expect(mayOfferPuCsie115Reference('pu', undefined)).toBe(false);
  });

  test('refuses empty, negative, over-precise and over-cap credits', () => {
    for (const input of ['', '0', '-1', '1e3', '3.555', '30.01', 'Infinity', 'NaN', 'abc']) {
      expect(manualCreditAmount(input)).toBeNull();
    }
    expect(manualCreditAmount('3.50')).toBe(3.5);
    expect(manualCreditAmount('0.01')).toBe(0.01);
    expect(manualCreditAmount('30')).toBe(30);
    expect(validCourseName(' ')).toBe(false);
    expect(validCourseName('資料庫')).toBe(true);
    expect(validCourseName('x'.repeat(81))).toBe(false);
  });

  test('does not invent passing grades for imports without an explicit pass column', () => {
    const csv = '課程名稱,學分,分類,成績,學期\n資料庫系統,3,必修,A,113-1\n英文,2,英文,,113-2\n';
    const result = parseManualCreditCsv(csv);
    expect(result.courses).toEqual([
      { name: '資料庫系統', credits: 3, category: 'required', grade: 'A', semester: '113-1', passed: false },
      { name: '英文', credits: 2, category: 'english', grade: undefined, semester: '113-2', passed: false },
    ]);
    expect(result.missingPassEvidence).toBe(2);
  });

  test('quoted CSV round-trips Unicode, commas, quotes, decimal credits and formula-safe names', () => {
    const original = [
      course({ id: 'a', name: 'AI,資料庫「實作」', credits: 2.5, passed: true, grade: 'B+' }),
      course({ id: 'b', name: '=HYPERLINK("bad")', credits: 3, passed: false, grade: undefined }),
    ];
    const csv = exportManualCreditCsv(original);
    expect(csv.startsWith('\ufeff')).toBe(true);
    expect(csv).toContain("'=HYPERLINK");
    const rows = parseCreditCsvRows(csv);
    expect(rows[1][0]).toBe(original[0].name);
    expect(rows[1][1]).toBe('2.5');
    // 匯入時不會拿掉試算表安全前綴，會原樣當成純文字。
    expect(rows[2][0]).toBe("'=HYPERLINK(\"bad\")");
    const imported = parseManualCreditCsv(csv);
    expect(imported.courses[0].passed).toBe(true);
    expect(imported.courses[0].credits).toBe(2.5);
    expect(imported.courses[1].passed).toBe(false);
    expect(imported.courses[1].name.startsWith("'=")).toBe(true);
  });

  test('Web planner CSV imports only projected courses, never summary rows or unearned progress', () => {
    const csv = [
      '"學期","課程","學分","類別","狀態"',
      '"未來第 1 學期","資料庫系統","3","必修","候選課程"',
      '"未來第 2 學期","通識","2.5","通識","已選課（尚未取得）"',
      '"","已確認可採計學分（自行輸入）","90","",""',
      '"分類門檻","必修目標","70","",""',
      '"非學分條件","英文能力","","","自行勾選完成"',
    ].join('\r\n');
    const result = parseManualCreditCsv(csv);
    expect(result.courses).toHaveLength(2);
    expect(result.courses.every((item) => item.passed === false)).toBe(true);
    expect(result.missingPassEvidence).toBe(2);
    expect(result.skipped).toBe(3);
    expect(result.courses[1].credits).toBe(2.5);
  });

  test('rejects structurally wrong CSV and skips invalid course rows', () => {
    expect(() => parseManualCreditCsv('"course,name,credits\nnope,3')).toThrow(/引號/);
    expect(() => parseManualCreditCsv('課程,學分\n無效,-2\n')).toThrow(/沒有可匯入/);
    expect(() => parseManualCreditCsv('標題,其他\nA,3')).toThrow(/課程名稱/);
    const result = parseManualCreditCsv('課程,學分,通過\n可用,1.5,是\n無效,Infinity,是\n');
    expect(result.courses).toHaveLength(1);
    expect(result.skipped).toBe(1);
    expect(result.courses[0].passed).toBe(true);
  });

  test('self-reported credit sum is not a verified graduation credit audit', () => {
    expect(manualCreditProgress([
      course({ id: 'a', passed: true, credits: 2.5 }),
      course({ id: 'b', passed: true, credits: 3 }),
      course({ id: 'c', passed: false, credits: 4 }),
    ])).toEqual({
      selfReportedCredits: 5.5,
      reportedPassedCourses: 2,
      totalCourses: 3,
      pendingCourses: 1,
    });
  });
});
