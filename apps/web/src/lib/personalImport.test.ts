import { describe, expect, it } from 'vitest';
import {
  parsePersonalImport,
  personalImportErrorMessage,
  personalImportKey,
  personalImportPreviewNotice,
  personalImportSavedNotice,
  personalImportUndoBody,
  personalImportUndoneNotice,
  planPersonalImport,
  resolvePersonalImportCourse,
  undoPersonalImportBatch,
  validatePersonalImportRow,
  PERSONAL_IMPORT_IMAGE_UNREADABLE,
  PERSONAL_IMPORT_SYNCED,
  PERSONAL_IMPORT_SYNCING,
  PERSONAL_IMPORT_SYNC_CONFLICT,
  PERSONAL_IMPORT_SYNC_NETWORK_FAILURE,
  PERSONAL_IMPORT_SYNC_SESSION_EXPIRED,
  PERSONAL_IMPORT_UNDO_LABEL,
  type PersonalImportCatalogCourse,
  type PersonalImportOptions,
  type PersonalImportRow,
} from '@campus/shared';
import { personalImportSyncErrorMessage } from '@campus/shared/src/imports/sync';

const timetable: PersonalImportOptions = {
  kind: 'timetable',
  schoolId: 'pu',
  academicYear: '115',
  semester: '1',
  periodProfile: 'pu',
};
const grades: PersonalImportOptions = { ...timetable, kind: 'grades' };
const events: PersonalImportOptions = {
  ...timetable,
  kind: 'events',
  academicYear: '',
  semester: '',
};
const batch = {
  batchId: 'batch-1',
  importedAt: '2026-10-13T10:00:00.000Z',
  periodProfile: 'pu' as const,
};
const errors = (issues: ReturnType<typeof validatePersonalImportRow>) =>
  issues.filter((issue) => issue.severity === 'error');
const gradeRow = (): PersonalImportRow =>
  parsePersonalImport('課程名稱,學分,成績,課號\n微積分,3,85,MATH101', grades).rows[0];

describe('personal import parsing preserves evidence', () => {
  it('reads quoted CSV with provenance and explicit academic context', () => {
    const parsed = parsePersonalImport(
      '課程名稱,星期,節次,老師,教室,課號\r\n"英文,進階",星期一,1-2,王老師,主顧303,ENG101',
      { ...timetable, source: { type: 'file', name: '課表.csv' } },
    );
    expect(errors(parsed.issues)).toEqual([]);
    expect(parsed.rows[0]).toMatchObject({
      title: '英文,進階',
      teacher: '王老師',
      dayOfWeek: 1,
      startPeriod: 1,
      endPeriod: 2,
      location: '主顧303',
      courseCode: 'ENG101',
      schoolId: 'pu',
      academicYear: '115',
      semester: '1',
      source: { type: 'file', name: '課表.csv', line: 2 },
    });
    expect(parsed.rows[0].source.rawText).toContain('"英文,進階"');
  });

  it('reads tabular copied text with full-width numbers', () => {
    const parsed = parsePersonalImport('科目名稱\t學分\t成績\n線性代數\t３\tＡ', grades);
    expect(errors(parsed.issues)).toEqual([]);
    expect(parsed.rows[0]).toMatchObject({ credits: 3, grade: 'A' });
  });

  it('reads screenshot text tables only with recognizable headers and preserves ordinary spaces in names', () => {
    const screenshot = { ...grades, source: { type: 'screenshot' as const, name: '成績.png' } };
    const parsed = parsePersonalImport(
      '課程名稱    學分    成績\n資料庫    3    85\nEnglish Conversation    2    A',
      screenshot,
    );
    expect(errors(parsed.issues)).toEqual([]);
    expect(parsed.rows).toHaveLength(2);
    expect(parsed.rows[0]).toMatchObject({
      title: '資料庫',
      credits: 3,
      grade: '85',
      source: { type: 'screenshot', line: 2 },
    });
    expect(parsed.rows[1]).toMatchObject({ title: 'English Conversation', credits: 2, grade: 'A' });
    const spacedChineseHeaders = parsePersonalImport(
      '課 程 名 稱    學 分    成 績\n資料庫    3    85',
      screenshot,
    );
    expect(errors(spacedChineseHeaders.issues)).toEqual([]);
    expect(spacedChineseHeaders.rows[0]).toMatchObject({
      title: '資料庫',
      credits: 3,
      grade: '85',
    });
  });

  it('blocks missing OCR columns or wider spaces inside a title instead of guessing column alignment', () => {
    const screenshot = { ...grades, source: { type: 'screenshot' as const } };
    for (const data of ['資料庫         85', 'English  Conversation    2    A', '資料庫    3']) {
      const parsed = parsePersonalImport(`課程名稱    學分    成績\n${data}`, screenshot);
      expect(errors(parsed.issues)).toContainEqual(
        expect.objectContaining({ code: 'column-count' }),
      );
    }
  });

  it('finds screenshot table headers after title/noise while preserving original data line numbers', () => {
    const text =
      '成績查詢\n\nmg日\n課程名稱                 學分         成績          課號\n計算機概論               3            91            CS101\n英文閱讀                 2            86            EN102';
    const parsed = parsePersonalImport(text, {
      ...grades,
      source: { type: 'screenshot', name: '學校成績.png' },
    });
    expect(errors(parsed.issues)).toEqual([]);
    expect(parsed.rows).toHaveLength(2);
    expect(parsed.rows[0]).toMatchObject({
      title: '計算機概論',
      credits: 3,
      grade: '91',
      courseCode: 'CS101',
      source: { line: 5 },
    });
    expect(parsed.rows[1]).toMatchObject({
      title: '英文閱讀',
      credits: 2,
      grade: '86',
      courseCode: 'EN102',
      source: { line: 6 },
    });
    expect(parsed.issues).toContainEqual(
      expect.objectContaining({
        code: 'screenshot-prologue-skipped',
        severity: 'warning',
        message: expect.stringContaining('第 1 至 3 行'),
      }),
    );
    expect(
      parsed.issues.find((issue) => issue.code === 'screenshot-prologue-skipped')?.message,
    ).toContain('成績查詢／mg日');
    const pasted = parsePersonalImport(text, grades);
    expect(pasted.issues.some((issue) => issue.code === 'screenshot-prologue-skipped')).toBe(false);
    expect(pasted.rows.every((row) => row.credits === undefined)).toBe(true);
  });

  it('retains malformed rows and trailing text after a detected screenshot header as blocking drafts', () => {
    const text =
      '學校成績\n課程名稱    學分    成績\n資料庫    3    85\n沒有欄位的說明\nEnglish  Conversation    2    A';
    const parsed = parsePersonalImport(text, { ...grades, source: { type: 'screenshot' } });
    expect(parsed.rows).toHaveLength(3);
    expect(parsed.rows[1]).toMatchObject({
      title: '沒有欄位的說明',
      source: { line: 4, rawText: '沒有欄位的說明' },
    });
    const shapeErrors = parsed.issues.filter((issue) => issue.code === 'column-count');
    expect(shapeErrors).toHaveLength(2);
    expect(shapeErrors.map((issue) => issue.rowId)).toEqual([parsed.rows[1].id, parsed.rows[2].id]);
  });

  it('does not enable whitespace-table inference for pasted text or weekly grid screenshots', () => {
    const pasted = parsePersonalImport('課程名稱    學分    成績\n資料庫    3    85', grades);
    expect(pasted.rows.every((row) => row.credits === undefined)).toBe(true);
    const grid = parsePersonalImport('節次    星期一    星期二\n1    英文    微積分', {
      ...timetable,
      source: { type: 'screenshot' },
    });
    expect(errors(grid.issues).length).toBeGreaterThan(0);
    expect(grid.rows.every((row) => row.startPeriod === undefined)).toBe(true);
  });

  it('preserves quoted newlines and doubled quotes', () => {
    const parsed = parsePersonalImport('課程名稱,學分,成績\n"設計\n""實習""",2,通過', grades);
    expect(errors(parsed.issues)).toEqual([]);
    expect(parsed.rows).toHaveLength(1);
    expect(parsed.rows[0]).toMatchObject({ title: '設計\n"實習"', credits: 2, grade: '通過' });
  });

  it('never reads a weekday from numbers in course names or rooms', () => {
    const parsed = parsePersonalImport('程式設計1 / 第2-3節 老師：李老師 教室：主顧303', timetable);
    expect(parsed.rows[0]).toMatchObject({
      title: '程式設計1',
      startPeriod: 2,
      endPeriod: 3,
      location: '主顧303',
    });
    expect(parsed.rows[0].dayOfWeek).toBeUndefined();
    expect(parsed.issues).toContainEqual(
      expect.objectContaining({ code: 'invalid-weekday', severity: 'error' }),
    );
  });

  it('keeps missing periods missing instead of defaulting to first period', () => {
    const parsed = parsePersonalImport('微積分 星期三 老師：王老師', timetable);
    expect(parsed.rows[0]).toMatchObject({ title: '微積分', dayOfWeek: 3 });
    expect(parsed.rows[0].startPeriod).toBeUndefined();
    expect(errors(parsed.issues)).toContainEqual(
      expect.objectContaining({ code: 'invalid-period' }),
    );
  });

  it('parses explicit text labels without guessing credits or numeric grades', () => {
    const parsed = parsePersonalImport(
      '微積分 課號：MATH101 學分：3 成績：抵免 老師：王老師 班級：資工一甲',
      grades,
    );
    expect(errors(parsed.issues)).toEqual([]);
    expect(parsed.rows[0]).toMatchObject({
      title: '微積分',
      courseCode: 'MATH101',
      credits: 3,
      grade: '抵免',
      teacher: '王老師',
      className: '資工一甲',
    });
  });

  it('does not convert GPA, missing credit or absent grade into earned credit', () => {
    const missing = parsePersonalImport('課程名稱,學分,成績\n微積分,,\n程式設計,三,85', grades);
    expect(missing.rows[0].credits).toBeUndefined();
    expect(missing.rows[0].grade).toBeUndefined();
    expect(errors(missing.issues).map((issue) => issue.code)).toEqual(
      expect.arrayContaining(['invalid-credits', 'missing-grade', 'unrecognized-field']),
    );
  });

  it('only maps exact clock boundaries when the caller selected the PU profile', () => {
    const text = '課程名稱,星期,開始時間,結束時間\n微積分,星期二,08:10,10:00';
    expect(parsePersonalImport(text, timetable).rows[0]).toMatchObject({
      startPeriod: 1,
      endPeriod: 2,
    });
    const other = parsePersonalImport(text, {
      ...timetable,
      schoolId: 'other',
      periodProfile: undefined,
    });
    expect(other.rows[0].startPeriod).toBeUndefined();
    expect(errors(other.issues)).toEqual([]);
    expect(other.issues).toContainEqual(
      expect.objectContaining({ code: 'personal-timetable-only' }),
    );
    const approximate = parsePersonalImport(text.replace('08:10', '08:00'), timetable);
    expect(approximate.rows[0].startPeriod).toBeUndefined();
    expect(approximate.rows[0].endPeriod).toBeUndefined();
    expect(approximate.rows[0]).toMatchObject({ startTime: '08:00', endTime: '10:00' });
    expect(errors(approximate.issues)).toEqual([]);
  });

  it('rejects conflicts between explicit periods and clock times', () => {
    const parsed = parsePersonalImport(
      '課程名稱,星期,節次,開始時間,結束時間\n微積分,星期二,1-2,10:10,12:00',
      timetable,
    );
    expect(errors(parsed.issues)).toContainEqual(
      expect.objectContaining({ code: 'period-time-conflict' }),
    );
  });

  it('accepts weekend clock schedules for other schools but does not force them into PU grid', () => {
    const parsed = parsePersonalImport('課程名稱,星期,開始時間,結束時間\n實習,星期六,09:00,12:00', {
      ...timetable,
      schoolId: 'other',
      periodProfile: undefined,
    });
    expect(errors(parsed.issues)).toEqual([]);
    expect(parsed.rows[0]).toMatchObject({ dayOfWeek: 6, startTime: '09:00', endTime: '12:00' });
    expect(parsed.rows[0].startPeriod).toBeUndefined();
  });

  it('preserves other school period labels and extended numeric periods without guessing times', () => {
    const other = { ...timetable, schoolId: 'other', periodProfile: undefined };
    const parsed = parsePersonalImport(
      '課程名稱,星期,節次\n實習,星期六,A-B\n實驗,星期日,14-15',
      other,
    );
    expect(errors(parsed.issues)).toEqual([]);
    expect(parsed.rows[0]).toMatchObject({ periodLabel: 'A-B', dayOfWeek: 6 });
    expect(parsed.rows[1]).toMatchObject({ startPeriod: 14, endPeriod: 15 });
    expect(parsed.rows[0].startTime).toBeUndefined();
    expect(
      errors(validatePersonalImportRow({ ...parsed.rows[0], dayOfWeek: 1 }, timetable)),
    ).toContainEqual(expect.objectContaining({ code: 'invalid-period' }));
  });

  it('maps NCKU official labels 0, N and A into grid slots without using PU times', () => {
    const ncku = { ...timetable, schoolId: 'ncku', periodProfile: 'ncku' as const };
    const labeled = parsePersonalImport(
      '課程名稱,星期,節次\n微積分,星期二,1-2\n通識,星期三,0\n實驗,星期四,N-5\n專題,星期五,A-B',
      ncku,
    );
    expect(errors(labeled.issues)).toEqual([]);
    expect(labeled.rows[0]).toMatchObject({ schoolId: 'ncku', startPeriod: 2, endPeriod: 3 });
    expect(labeled.rows[1]).toMatchObject({ startPeriod: 1, endPeriod: 1 });
    expect(labeled.rows[2]).toMatchObject({ startPeriod: 6, endPeriod: 7 });
    expect(labeled.rows[3]).toMatchObject({ startPeriod: 12, endPeriod: 13 });
    const clock = parsePersonalImport(
      '課程名稱,星期,開始時間,結束時間\n微積分,星期二,08:00,09:50',
      ncku,
    );
    expect(clock.rows[0]).toMatchObject({ startPeriod: 2, endPeriod: 3 });
    const puClock = parsePersonalImport(
      '課程名稱,星期,開始時間,結束時間\n微積分,星期二,08:10,10:00',
      ncku,
    );
    expect(puClock.rows[0].startPeriod).toBeUndefined();
    expect(puClock.rows[0].endPeriod).toBeUndefined();
    expect(puClock.rows[0]).toMatchObject({ startTime: '08:10', endTime: '10:00' });
    expect(errors(puClock.issues)).toEqual([]);
  });

  it('maps NTPU evening periods 10–13 to 18:30 and keeps them out of other schools', () => {
    const ntpu = { ...timetable, schoolId: 'ntpu', periodProfile: 'ntpu' as const };
    const parsed = parsePersonalImport('課程名稱,星期,節次\n進階會計,星期一,10-13', ntpu);
    expect(errors(parsed.issues)).toEqual([]);
    expect(parsed.rows[0]).toMatchObject({
      schoolId: 'ntpu',
      startPeriod: 10,
      endPeriod: 13,
    });
    const clock = parsePersonalImport(
      '課程名稱,星期,開始時間,結束時間\n進階會計,星期一,18:30,22:10',
      ntpu,
    );
    expect(clock.rows[0]).toMatchObject({ startPeriod: 10, endPeriod: 13 });
    expect(
      parsePersonalImport('課程名稱,星期,節次\n進階會計,星期一,10-13', timetable).rows[0],
    ).toMatchObject({
      schoolId: 'pu',
      startPeriod: 10,
      endPeriod: 13,
    });
  });

  it('requires complete valid event dates and times instead of inventing a year or end time', () => {
    const parsed = parsePersonalImport(
      '活動名稱,日期,開始時間,結束時間\n迎新,10/20,18:00,\n說明會,2026-02-30,18:00,20:00',
      events,
    );
    expect(parsed.rows[0]).toMatchObject({ date: '10/20', startTime: '18:00' });
    expect(parsed.rows[0].endTime).toBeUndefined();
    expect(errors(parsed.issues).map((issue) => issue.code)).toEqual(
      expect.arrayContaining(['invalid-date', 'invalid-time']),
    );
  });

  it('handles labeled events and explicit ROC dates without requiring an academic term', () => {
    const parsed = parsePersonalImport(
      '迎新 日期：民國115年10月20日 開始：18:00 結束：20:00 地點：學生活動中心',
      events,
    );
    expect(errors(parsed.issues)).toEqual([]);
    expect(parsed.rows[0]).toMatchObject({
      title: '迎新',
      date: '2026-10-20',
      startTime: '18:00',
      endTime: '20:00',
      location: '學生活動中心',
    });
  });

  it('requires an explicit next-day date for overnight events', () => {
    const row = parsePersonalImport(
      '活動名稱,日期,開始時間,結束時間\n夜間觀星,2026-10-20,23:00,02:00',
      events,
    ).rows[0];
    expect(errors(validatePersonalImportRow(row))).toContainEqual(
      expect.objectContaining({ code: 'reversed-event' }),
    );
    expect(errors(validatePersonalImportRow({ ...row, endDate: '2026-10-21' }))).toEqual([]);
  });

  it('supports explicit all-day events with an exclusive end date and no manufactured clock time', () => {
    const parsed = parsePersonalImport(
      '活動名稱,日期,結束日期,全天\n校慶,2026-10-20,2026-10-22,是',
      events,
    );
    expect(errors(parsed.issues)).toEqual([]);
    expect(parsed.rows[0]).toMatchObject({ allDay: true, endDate: '2026-10-22' });
    expect(parsed.rows[0].startTime).toBeUndefined();
    expect(
      errors(validatePersonalImportRow({ ...parsed.rows[0], endDate: '2026-10-20' })),
    ).toContainEqual(expect.objectContaining({ code: 'reversed-event' }));
  });

  it('reports bad table shape, duplicate columns and unrecognized columns explicitly', () => {
    const malformed = parsePersonalImport('課程名稱,學分,成績\n"微積分,3,85', grades);
    expect(malformed.issues).toContainEqual(
      expect.objectContaining({ code: 'malformed-table', severity: 'error' }),
    );
    const duplicate = parsePersonalImport('課程名稱,學分,學分,成績\n微積分,3,4,85', grades);
    expect(duplicate.issues).toContainEqual(
      expect.objectContaining({ code: 'duplicate-header', severity: 'error' }),
    );
    const extra = parsePersonalImport('課程名稱,學分,成績,備註\n微積分,3,85,本人修課', grades);
    expect(extra.issues).toContainEqual(
      expect.objectContaining({ code: 'unknown-header', severity: 'warning' }),
    );
    expect(extra.rows[0].source.rawText).toContain('本人修課');
    const quoteTrailing = parsePersonalImport('課程名稱,學分,成績\n"微積分"其他,3,85', grades);
    expect(quoteTrailing.issues).toContainEqual(
      expect.objectContaining({ code: 'malformed-table', severity: 'error' }),
    );
  });

  it('does not silently truncate oversize input or rows', () => {
    expect(parsePersonalImport('x'.repeat(200_001), grades)).toMatchObject({
      rows: [],
      issues: [expect.objectContaining({ code: 'text-limit' })],
    });
    const parsed = parsePersonalImport(
      ['課程名稱,學分,成績', ...Array.from({ length: 501 }, (_, i) => `課程${i},3,85`)].join('\n'),
      grades,
    );
    expect(parsed.rows).toEqual([]);
    expect(parsed.issues).toContainEqual(
      expect.objectContaining({ code: 'row-limit', severity: 'error' }),
    );
  });

  it('rejects a school override from an uploaded table', () => {
    const parsed = parsePersonalImport('課程名稱,學分,成績,學校代碼\n微積分,3,85,other', grades);
    expect(parsed.issues).toContainEqual(
      expect.objectContaining({ code: 'school-mismatch', severity: 'error' }),
    );
    const natural = parsePersonalImport('微積分 學分：3 成績：85 學校代碼：other', grades);
    expect(natural.issues).toContainEqual(
      expect.objectContaining({ code: 'school-mismatch', severity: 'error' }),
    );
  });

  it('returns issues, rather than throwing, for corrupt persisted field types', () => {
    expect(() =>
      validatePersonalImportRow({ ...gradeRow(), title: 12 } as unknown as PersonalImportRow),
    ).not.toThrow();
    expect(
      errors(
        validatePersonalImportRow({
          ...gradeRow(),
          grade: { value: 85 },
        } as unknown as PersonalImportRow),
      ),
    ).toContainEqual(expect.objectContaining({ code: 'invalid-field-type' }));
  });
});

describe('personal import commit and undo', () => {
  it('deduplicates across sources and within batches without overwriting existing records', () => {
    const row = gradeRow();
    const initial = planPersonalImport(
      [],
      [row, { ...row, id: 'another-id', source: { ...row.source, type: 'screenshot' } }],
      batch,
    );
    expect(initial.added).toHaveLength(1);
    expect(initial.duplicates).toHaveLength(1);
    const repeated = planPersonalImport(initial.records, [gradeRow()], {
      ...batch,
      batchId: 'batch-2',
    });
    expect(repeated.added).toEqual([]);
    expect(repeated.records).toEqual(initial.records);
  });

  it('keeps same-name courses in different schools and terms separate', () => {
    const row = gradeRow();
    expect(personalImportKey(row)).not.toEqual(personalImportKey({ ...row, schoolId: 'other' }));
    expect(personalImportKey(row)).not.toEqual(personalImportKey({ ...row, semester: '2' }));
  });

  it('keeps two distinct clock slots separate for schools without PU period mapping', () => {
    const row = parsePersonalImport('課程名稱,星期,開始時間,結束時間\n微積分,星期一,09:00,10:00', {
      ...timetable,
      periodProfile: undefined,
    }).rows[0];
    expect(personalImportKey(row)).not.toEqual(
      personalImportKey({ ...row, startTime: '14:00', endTime: '15:00' }),
    );
  });

  it('treats an omitted one-day end date and the equivalent exclusive end date as duplicate', () => {
    const row = parsePersonalImport('活動名稱,日期,全天\n校慶,2026-10-20,是', events).rows[0];
    expect(personalImportKey(row)).toEqual(personalImportKey({ ...row, endDate: '2026-10-21' }));
    expect(personalImportKey(row)).not.toEqual(
      personalImportKey({ ...row, endDate: '2026-10-22' }),
    );
  });

  it('blocks the whole batch on a validation error and leaves existing records untouched', () => {
    const original = planPersonalImport([], [gradeRow()], batch);
    const result = planPersonalImport(
      original.records,
      [
        { ...gradeRow(), id: 'valid', title: '另一堂課', courseCode: 'OTHER' },
        { ...gradeRow(), id: 'invalid', credits: undefined },
      ],
      { ...batch, batchId: 'batch-2' },
    );
    expect(result.records).toEqual(original.records);
    expect(result.added).toEqual([]);
    expect(errors(result.issues).length).toBeGreaterThan(0);
  });

  it('blocks conflicting transcript grades rather than averaging or overwriting them', () => {
    const row = gradeRow();
    const initial = planPersonalImport([], [row], batch);
    const conflict = planPersonalImport(
      initial.records,
      [{ ...row, id: 'changed-grade', grade: '95' }],
      { ...batch, batchId: 'batch-2' },
    );
    expect(conflict.records).toEqual(initial.records);
    expect(errors(conflict.issues)).toContainEqual(
      expect.objectContaining({ code: 'grade-conflict' }),
    );
  });

  it('warns about changed rooms in duplicates and preserves the existing record', () => {
    const row = parsePersonalImport('課程名稱,星期,節次,教室\n微積分,星期一,1-2,主顧303', timetable)
      .rows[0];
    const original = planPersonalImport([], [row], batch);
    const result = planPersonalImport(
      original.records,
      [{ ...row, id: 'changed-room', location: '主顧304' }],
      { ...batch, batchId: 'batch-2' },
    );
    expect(result.records).toEqual(original.records);
    expect(result.issues).toContainEqual(
      expect.objectContaining({ code: 'duplicate-metadata-conflict', severity: 'warning' }),
    );
  });

  it('never reuses a batch or overwrites a colliding row id', () => {
    const row = gradeRow();
    const initial = planPersonalImport([], [row], batch);
    expect(
      errors(
        planPersonalImport(initial.records, [{ ...row, title: '其他', courseCode: 'NEW' }], {
          ...batch,
          batchId: 'batch-2',
        }).issues,
      ),
    ).toContainEqual(expect.objectContaining({ code: 'duplicate-id' }));
    expect(errors(planPersonalImport(initial.records, [], batch).issues)).toContainEqual(
      expect.objectContaining({ code: 'reused-batch' }),
    );
  });

  it('undoes only the selected batch and preserves all earlier data', () => {
    const initial = planPersonalImport([], [gradeRow()], batch);
    const next = planPersonalImport(initial.records, [{ ...gradeRow(), semester: '2' }], {
      ...batch,
      batchId: 'batch-2',
    });
    expect(next.records).toHaveLength(2);
    expect(undoPersonalImportBatch(next.records, 'batch-2')).toEqual(initial.records);
    expect(undoPersonalImportBatch(next.records, 'unknown')).toEqual(next.records);
  });
});

describe('course links respect school, term and evidence', () => {
  const verifiedCourse: PersonalImportCatalogCourse = {
    id: 'catalog-1',
    title: '微積分',
    schoolId: 'pu',
    academicYear: '115',
    semester: '1',
    courseCode: 'MATH101',
    teacher: '王老師',
    verified: true,
  };

  it('links only one exact verified course code in the same school and term', () => {
    expect(resolvePersonalImportCourse(gradeRow(), [verifiedCourse])).toEqual({
      status: 'linked',
      linkedCourseId: 'catalog-1',
      suggestions: [],
    });
    for (const change of [
      { schoolId: 'other' },
      { academicYear: '114' },
      { semester: '2' },
      { verified: false },
    ]) {
      expect(
        resolvePersonalImportCourse(gradeRow(), [{ ...verifiedCourse, ...change }]).status,
      ).toBe('unmatched');
    }
  });

  it('treats name and teacher matches as suggestions and ambiguous codes as suggestions', () => {
    const nameOnly = { ...gradeRow(), courseCode: undefined, teacher: '王老師' };
    expect(resolvePersonalImportCourse(nameOnly, [verifiedCourse])).toMatchObject({
      status: 'suggestions',
      suggestions: [verifiedCourse],
    });
    expect(resolvePersonalImportCourse(nameOnly, [verifiedCourse]).linkedCourseId).toBeUndefined();
    expect(
      resolvePersonalImportCourse(gradeRow(), [
        verifiedCourse,
        { ...verifiedCourse, id: 'catalog-2', className: '二班' },
      ]),
    ).toMatchObject({ status: 'suggestions' });
  });

  it('does not link or suggest based on a common name alone', () => {
    expect(
      resolvePersonalImportCourse({ ...gradeRow(), courseCode: undefined }, [verifiedCourse]),
    ).toEqual({ status: 'unmatched', suggestions: [] });
  });

  it('never auto-links a teacher/class contradiction or a blank academic scope', () => {
    for (const conflict of [{ teacher: '另一位老師' }, { className: '不同班級' }]) {
      expect(
        resolvePersonalImportCourse({ ...gradeRow(), ...conflict }, [verifiedCourse]),
      ).toMatchObject({ status: 'suggestions' });
      expect(
        resolvePersonalImportCourse({ ...gradeRow(), ...conflict }, [verifiedCourse])
          .linkedCourseId,
      ).toBeUndefined();
    }
    expect(
      resolvePersonalImportCourse({ ...gradeRow(), semester: '' }, [
        { ...verifiedCourse, semester: '' },
      ]),
    ).toEqual({ status: 'unmatched', suggestions: [] });
  });
});

describe('iCalendar import keeps dates and recurrence semantics explicit', () => {
  const calendar = (content: string) =>
    `BEGIN:VCALENDAR\r\nVERSION:2.0\r\nBEGIN:VEVENT\r\n${content}\r\nEND:VEVENT\r\nEND:VCALENDAR`;

  it('converts UTC into Taipei including a date boundary independently of machine timezone', () => {
    const parsed = parsePersonalImport(
      calendar('SUMMARY:跨校研討\r\nDTSTART:20261013T233000Z\r\nDTEND:20261014T013000Z'),
      events,
    );
    expect(errors(parsed.issues)).toEqual([]);
    expect(parsed.rows[0]).toMatchObject({
      title: '跨校研討',
      date: '2026-10-14',
      startTime: '07:30',
      endDate: '2026-10-14',
      endTime: '09:30',
    });
    expect(parsed.issues).toContainEqual(
      expect.objectContaining({ code: 'calendar-timezone-converted', severity: 'warning' }),
    );
    expect(parsed.rows[0].source.rawText).toContain('20261013T233000Z');
  });

  it('preserves explicit Taipei time and unfolds escaped text while ignoring alarm titles', () => {
    const parsed = parsePersonalImport(
      calendar(
        'SUMMARY:校友\\,學術\r\n 交流\\;座談\r\nLOCATION:主顧樓\\n三樓\r\nDTSTART;TZID=Asia/Taipei:20261020T180000\r\nDTEND;TZID="Asia/Taipei":20261020T200000\r\nBEGIN:VALARM\r\nSUMMARY:錯誤的活動名稱\r\nEND:VALARM',
      ),
      events,
    );
    expect(errors(parsed.issues)).toEqual([]);
    expect(parsed.rows[0]).toMatchObject({
      title: '校友,學術交流;座談',
      location: '主顧樓\n三樓',
      date: '2026-10-20',
      startTime: '18:00',
      endTime: '20:00',
    });
  });

  it('preserves all-day exclusive end dates without creating midnight clock times', () => {
    const parsed = parsePersonalImport(
      calendar('SUMMARY:連假\r\nDTSTART;VALUE=DATE:20261020\r\nDTEND;VALUE=DATE:20261023'),
      events,
    );
    expect(errors(parsed.issues)).toEqual([]);
    expect(parsed.rows[0]).toMatchObject({
      allDay: true,
      date: '2026-10-20',
      endDate: '2026-10-23',
    });
    expect(parsed.rows[0].startTime).toBeUndefined();
    expect(parsed.rows[0].endTime).toBeUndefined();
    const single = parsePersonalImport(
      calendar('SUMMARY:校慶\r\nDTSTART;VALUE=DATE:20261020'),
      events,
    );
    expect(errors(single.issues)).toEqual([]);
    expect(single.rows[0].endDate).toBeUndefined();
  });

  it('rejects every recurrence/exception form rather than importing only one occurrence', () => {
    for (const recurrence of [
      'RRULE:FREQ=WEEKLY;COUNT=12',
      'RDATE:20261027T180000',
      'EXDATE:20261027T180000',
      'RECURRENCE-ID:20261027T180000',
    ]) {
      const parsed = parsePersonalImport(
        calendar(
          `SUMMARY:每週社課\r\nDTSTART:20261020T180000\r\nDTEND:20261020T200000\r\n${recurrence}`,
        ),
        events,
      );
      expect(errors(parsed.issues)).toContainEqual(
        expect.objectContaining({ code: 'unsupported-calendar-recurrence' }),
      );
    }
  });

  it('rejects unsupported zones, malformed calendars and cancelled events with visible errors', () => {
    const unsupported = parsePersonalImport(
      calendar(
        'SUMMARY:國際論壇\r\nDTSTART;TZID=America/New_York:20261020T180000\r\nDTEND;TZID=America/New_York:20261020T200000',
      ),
      events,
    );
    expect(errors(unsupported.issues)).toContainEqual(
      expect.objectContaining({ code: 'unsupported-calendar-timezone' }),
    );
    const cancelled = parsePersonalImport(
      calendar('SUMMARY:取消活動\r\nDTSTART;VALUE=DATE:20261020\r\nSTATUS:CANCELLED'),
      events,
    );
    expect(errors(cancelled.issues)).toContainEqual(
      expect.objectContaining({ code: 'cancelled-calendar-event' }),
    );
    const malformed = parsePersonalImport('BEGIN:VCALENDAR\nBEGIN:VEVENT\nSUMMARY:未完成', events);
    expect(errors(malformed.issues)).toContainEqual(
      expect.objectContaining({ code: 'malformed-calendar' }),
    );
  });

  it('retains floating local times with a warning and never invents a missing end time', () => {
    const parsed = parsePersonalImport(
      calendar('SUMMARY:說明會\r\nDTSTART:20261020T180000'),
      events,
    );
    expect(parsed.rows[0]).toMatchObject({ date: '2026-10-20', startTime: '18:00' });
    expect(parsed.rows[0].endTime).toBeUndefined();
    expect(parsed.issues).toContainEqual(
      expect.objectContaining({ code: 'floating-calendar-time', severity: 'warning' }),
    );
    expect(errors(parsed.issues)).toContainEqual(expect.objectContaining({ code: 'invalid-time' }));
  });

  it('does not treat a calendar file as grades or timetable text', () => {
    const parsed = parsePersonalImport(
      calendar('SUMMARY:校慶\r\nDTSTART;VALUE=DATE:20261020'),
      grades,
    );
    expect(parsed.rows).toEqual([]);
    expect(parsed.issues).toContainEqual(
      expect.objectContaining({ code: 'calendar-kind-mismatch' }),
    );
  });

  it('validates real dates before timezone conversion and rejects mixed all-day/timed endpoints', () => {
    const invalid = parsePersonalImport(
      calendar('SUMMARY:錯誤日期\r\nDTSTART:20260230T180000Z\r\nDTEND:20260230T200000Z'),
      events,
    );
    expect(invalid.rows[0].date).toBe('2026-02-30');
    expect(errors(invalid.issues)).toContainEqual(
      expect.objectContaining({ code: 'invalid-date' }),
    );
    const mixed = parsePersonalImport(
      calendar('SUMMARY:混合格式\r\nDTSTART;VALUE=DATE:20261020\r\nDTEND:20261020T200000'),
      events,
    );
    expect(errors(mixed.issues)).toContainEqual(
      expect.objectContaining({ code: 'mixed-calendar-date' }),
    );
  });
});

describe('personal import notices', () => {
  it('uses the same save, undo, and broken-image sentences on every surface', () => {
    expect(personalImportPreviewNotice(3)).toBe('整理出 3 筆，請逐筆核對再匯入。');
    expect(personalImportSavedNotice(3)).toBe(
      '已在這台裝置新增 3 筆，原有資料保留。資料只存在這台裝置，換手機或清除資料就會不見。',
    );
    expect(personalImportSavedNotice(3, false)).toBe(personalImportSavedNotice(3));
    expect(personalImportSavedNotice(3, true)).toBe('已在這台裝置新增 3 筆，原有資料保留。');
    expect(PERSONAL_IMPORT_SYNCING).toBe('正在同步到你的帳號…');
    expect(PERSONAL_IMPORT_SYNCED).toBe(
      '已同步到你的帳號，換裝置登入同一個帳號並開啟同步就能看到。',
    );
    expect(PERSONAL_IMPORT_SYNC_NETWORK_FAILURE).toBe('還沒同步到你的帳號，請確認網路後再試。');
    expect(PERSONAL_IMPORT_SYNC_CONFLICT).toBe('另一台裝置剛更新資料，請重新同步。');
    expect(PERSONAL_IMPORT_SYNC_SESSION_EXPIRED).toBe(
      '登入狀態已變更，請重新登入後同步；這台裝置的資料仍保留。',
    );
    expect(PERSONAL_IMPORT_UNDO_LABEL).toBe('撤銷上次匯入');
    expect(personalImportUndoBody(2)).toBe(
      '上次匯入的 2 筆會從這台裝置刪掉，你原本的資料不會動。刪掉後沒辦法復原。',
    );
    expect(personalImportUndoneNotice(4)).toBe('已撤銷上次匯入的 4 筆，原本的資料都還在。');
    expect(
      personalImportErrorMessage(new Error('The source image could not be decoded.'), '備用'),
    ).toBe(PERSONAL_IMPORT_IMAGE_UNREADABLE);
    expect(
      personalImportErrorMessage(new Error('圖片超過 10 MB，請裁切後再選一次。'), '備用'),
    ).toBe('圖片超過 10 MB，請裁切後再選一次。');
    expect(personalImportErrorMessage(new Error('NetworkError'), '備用')).toBe('備用');
    expect(
      personalImportSyncErrorMessage(
        Object.assign(new Error('conflict'), { code: 'PERSONAL_IMPORT_REVISION_CONFLICT' }),
      ),
    ).toBe(PERSONAL_IMPORT_SYNC_CONFLICT);
    expect(
      personalImportSyncErrorMessage(
        Object.assign(new Error('expired'), { code: 'PERSONAL_IMPORT_SESSION_EXPIRED' }),
      ),
    ).toBe(PERSONAL_IMPORT_SYNC_SESSION_EXPIRED);
    expect(personalImportSyncErrorMessage(new Error('network unavailable'))).toBe(
      PERSONAL_IMPORT_SYNC_NETWORK_FAILURE,
    );
    expect(personalImportSyncErrorMessage(new Error('Failed to fetch'))).toBe(
      PERSONAL_IMPORT_SYNC_NETWORK_FAILURE,
    );
    expect(
      personalImportSyncErrorMessage(
        new Error('裝置空間不足，這次同步未能保存；原資料仍保留，請先下載備份。'),
      ),
    ).toBe('裝置空間不足，這次同步未能保存；原資料仍保留，請先下載備份。');
  });
});
