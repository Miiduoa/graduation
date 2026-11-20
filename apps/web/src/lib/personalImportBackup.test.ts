import { describe, expect, it } from 'vitest';
import {
  PERSONAL_IMPORT_BACKUP_MAX_BYTES,
  PERSONAL_IMPORT_BACKUP_MAX_RECORDS,
  parsePersonalImportBackup,
  parsePersonalImport,
  planPersonalImport,
  preparePersonalImportBackupRestore,
  serializePersonalImportBackup,
  undoPersonalImportBatch,
  type PersonalImportRecord,
} from '@campus/shared';

const exportedAt = '2026-10-13T04:30:00.000Z';
const linkedWorkspaceId = 'cw_00000000-0000-0000-0000-000000000001';
const record = (patch: Partial<PersonalImportRecord> = {}): PersonalImportRecord => ({
  id: 'original-1',
  batchId: 'original-batch',
  importedAt: '2026-10-12T03:00:00.000Z',
  kind: 'grades',
  title: '資料庫管理',
  schoolId: 'pu',
  academicYear: '115',
  semester: '1',
  courseCode: 'CS301',
  teacher: '王老師',
  className: '資工三甲',
  location: '主顧 303',
  credits: 3,
  grade: 'A+',
  linkedCourseId: linkedWorkspaceId,
  source: { type: 'screenshot', name: '成績截圖.png', line: 5, rawText: '資料庫管理\t3\tA+' },
  ...patch,
});
const options = { schoolId: 'pu', exportedAt };
const document = (records = [record()]) => ({
  format: 'campus-one.personal-import-backup',
  version: 1,
  schoolId: 'pu',
  exportedAt,
  records,
});
const serialize = (records: PersonalImportRecord[]) =>
  serializePersonalImportBackup(records, options);
const restorePlan = (existing: PersonalImportRecord[], incoming = record()) => {
  const preview = parsePersonalImportBackup(serialize([incoming]));
  const rows = preparePersonalImportBackupRestore(preview.rows, existing);
  return planPersonalImport(existing, rows, {
    batchId: 'restored-batch',
    importedAt: exportedAt,
    periodProfile: 'pu',
  });
};

describe('portable personal backup round trip', () => {
  it('preserves optional event term labels accepted by normal imports', () => {
    const parsed = parsePersonalImport(
      '活動名稱,日期,全天,學年度,學期\n校慶,2026-11-01,是,2026秋季,秋季活動',
      {
        kind: 'events',
        schoolId: 'pu',
        academicYear: '',
        semester: '',
      },
    );
    const plan = planPersonalImport([], parsed.rows, {
      batchId: 'event-import',
      importedAt: exportedAt,
    });
    expect(plan.added).toHaveLength(1);
    const restored = parsePersonalImportBackup(serialize(plan.records));
    expect(restored.rows[0]).toMatchObject({
      academicYear: '2026秋季',
      semester: '秋季活動',
      title: '校慶',
    });
  });
  it.each([
    {
      kind: 'grades' as const,
      text: '課程名稱,學分,成績,日期\n英文,3,A,115/10/15',
    },
    {
      kind: 'grades' as const,
      text: '課程名稱,學分,成績,日期,結束日期,開始時間,結束時間,開始節次,結束節次\n英文,3,A,115/10/15,原始註記,24:90,上午,0.5,1000',
    },
    {
      kind: 'timetable' as const,
      text: `課程名稱,星期,開始節次,結束節次,學分,成績,日期,結束日期\n英文,一,1,2,1000,${'原始附註'.repeat(15)},115/10/15,尚未公布`,
    },
    {
      kind: 'events' as const,
      text: '活動名稱,日期,開始時間,結束時間,開始節次,結束節次,學分\n讀書會,2026-10-15,09:00,10:00,0.5,1000,1000',
    },
  ])(
    'round trips all scalar fields accepted by the normal $kind importer and append plan',
    ({ kind, text }) => {
      const parsed = parsePersonalImport(text, {
        kind,
        schoolId: 'pu',
        academicYear: '115',
        semester: '1',
        periodProfile: 'pu',
      });
      expect(parsed.issues.filter((issue) => issue.severity === 'error')).toEqual([]);
      const plan = planPersonalImport([], parsed.rows, {
        batchId: 'normal-import',
        importedAt: exportedAt,
        periodProfile: 'pu',
      });
      expect(plan.issues.filter((issue) => issue.severity === 'error')).toEqual([]);
      expect(plan.added).toHaveLength(1);
      const preview = parsePersonalImportBackup(serialize(plan.records));
      const { id, batchId, importedAt, ...fields } = plan.records[0];
      expect(preview.rows[0]).toEqual({ ...fields, id: preview.rows[0].id });
      expect(preview.rows[0].id).not.toBe(id);
      expect(batchId).toBe('normal-import');
      expect(importedAt).toBe(exportedAt);
    },
  );

  it('preserves every personal field and source across kinds and terms, without installing archive metadata', () => {
    const records: PersonalImportRecord[] = [
      record({
        id: 'schedule',
        kind: 'timetable',
        credits: undefined,
        grade: undefined,
        academicYear: '114',
        semester: '暑期',
        dayOfWeek: 5,
        startPeriod: 10,
        endPeriod: 11,
        startTime: '18:05',
        endTime: '19:50',
        source: { type: 'paste', line: 2, rawText: '週五 晚間課程\n"原始文字"' },
      }),
      record(),
      record({
        id: 'event',
        kind: 'events',
        title: '跨日讀書會',
        academicYear: '',
        semester: '',
        credits: undefined,
        grade: undefined,
        linkedCourseId: undefined,
        date: '2026-10-20',
        endDate: '2026-10-21',
        allDay: false,
        startTime: '22:30',
        endTime: '00:30',
        source: { type: 'file', name: '行事曆.ics', line: 7, rawText: 'SUMMARY:跨日讀書會' },
      }),
      record({
        id: 'all-day',
        kind: 'events',
        title: '連假',
        academicYear: '',
        semester: '',
        credits: undefined,
        grade: undefined,
        date: '2026-10-23',
        endDate: '2026-10-26',
        allDay: true,
      }),
    ];
    const text = serialize(records);
    const archived = JSON.parse(text).records as PersonalImportRecord[];
    expect(archived[0].batchId).toBe('original-batch');
    const preview = parsePersonalImportBackup(text);
    expect(preview).toMatchObject({
      schoolId: 'pu',
      exportedAt,
      counts: { timetable: 1, grades: 1, events: 2 },
    });
    for (const [index, row] of preview.rows.entries()) {
      const { id, batchId, importedAt, linkedCourseId, ...fields } = archived[index];
      expect(row).toEqual({ ...fields, id: row.id });
      expect(row.id).not.toBe(id);
      expect(row).not.toHaveProperty('batchId');
      expect(row).not.toHaveProperty('importedAt');
      expect(row).not.toHaveProperty('linkedCourseId');
      expect(preview.proposedLinks[row.id]).toBe(linkedCourseId);
      expect(batchId).toBe('original-batch');
      expect(importedAt).toBe('2026-10-12T03:00:00.000Z');
    }
    expect(new Set(preview.rows.map((row) => row.id)).size).toBe(4);
    const secondPreview = parsePersonalImportBackup(text);
    expect(secondPreview.rows[0].id).not.toBe(preview.rows[0].id);
  });

  it('keeps non-PU weekend clocks and original school period labels without conversion', () => {
    const original = record({
      schoolId: 'other-school',
      kind: 'timetable',
      dayOfWeek: 7,
      startTime: '08:45',
      endTime: '10:15',
      periodLabel: '第一大節 A–B',
      credits: undefined,
      grade: undefined,
    });
    const preview = parsePersonalImportBackup(
      serializePersonalImportBackup([original], { ...options, schoolId: 'other-school' }),
    );
    expect(preview.rows[0]).toMatchObject({
      dayOfWeek: 7,
      startTime: '08:45',
      endTime: '10:15',
      periodLabel: '第一大節 A–B',
    });
    expect(preview.rows[0].startPeriod).toBeUndefined();
  });

  it('round trips an empty backup with all three counts present', () => {
    expect(parsePersonalImportBackup(serialize([]))).toMatchObject({
      schoolId: 'pu',
      exportedAt,
      rows: [],
      counts: { timetable: 0, grades: 0, events: 0 },
      proposedLinks: {},
    });
  });

  it('retains zero-credit pass/fail grades exactly', () => {
    expect(
      parsePersonalImportBackup(serialize([record({ credits: 0, grade: '通過' })])).rows[0],
    ).toMatchObject({ credits: 0, grade: '通過' });
  });
});

describe('backup validation and privacy boundaries', () => {
  it.each([0, 2, '1', null])('rejects unsupported version %s', (version) => {
    expect(() => parsePersonalImportBackup(JSON.stringify({ ...document(), version }))).toThrow(
      /版本/,
    );
  });

  it.each(['', '{', 'null', '[]', '{"format":"another-app","version":1}'])(
    'rejects invalid documents before returning any rows: %s',
    (text) => expect(() => parsePersonalImportBackup(text)).toThrow(),
  );

  it.each([
    { schoolId: 'other-school' },
    { title: 27 },
    { academicYear: '115年' },
    { credits: '3' },
    { credits: -1 },
    { grade: '' },
    { kind: 'official-grade' },
    { importedAt: '2026-02-30T00:00:00.000Z' },
    { batchId: '' },
    { dayOfWeek: '1' },
    { date: 20261015 },
    { startTime: { hour: 24 } },
    { allDay: 'true' },
    { source: null },
    { source: { type: 'image-url', line: 1, rawText: 'x' } },
    { source: { type: 'file', line: 0, rawText: 'x' } },
    { source: { type: 'file', line: 1.5, rawText: 'x' } },
    { source: { type: 'file', line: 1, rawText: [] } },
    { source: { type: 'file', line: 1, rawText: 'x', name: 3 } },
  ])('rejects any malformed record atomically (%j)', (patch) => {
    const bad = { ...record({ id: 'invalid' }), ...patch } as PersonalImportRecord;
    expect(() => parsePersonalImportBackup(JSON.stringify(document([record(), bad])))).toThrow();
  });

  it.each([
    { kind: 'events' as const, date: '2026-02-30', allDay: true },
    { kind: 'events' as const, date: '2026-10-15', startTime: '24:00', endTime: '25:00' },
    { kind: 'timetable' as const, dayOfWeek: 1, startPeriod: 1, endPeriod: 99 },
    { kind: 'timetable' as const, dayOfWeek: 1, startPeriod: 1, endPeriod: 2, startTime: '24:00' },
    { kind: 'grades' as const, credits: 41 },
  ])('continues to reject semantic errors for the record kind that uses them (%j)', (patch) => {
    const bad = record(patch);
    expect(() => serialize([bad])).toThrow();
    expect(() => parsePersonalImportBackup(JSON.stringify(document([bad])))).toThrow();
  });

  it.each(['date', 'endDate', 'startTime', 'endTime', 'grade'] as const)(
    'keeps unrelated %s fields bounded even when their meaning is not validated',
    (field) => {
      const bad = record({
        kind: 'events',
        date: '2026-10-15',
        allDay: true,
        [field]: 'x'.repeat(200_001),
      });
      expect(() => serialize([bad])).toThrow();
      expect(() => parsePersonalImportBackup(JSON.stringify(document([bad])))).toThrow();
    },
  );

  it.each(['\u0000', '\u001f', '\u007f'])(
    'rejects control characters within school identifiers (%j)',
    (character) => {
      expect(() =>
        serializePersonalImportBackup([], { schoolId: `school${character}id`, exportedAt }),
      ).toThrow();
      expect(() =>
        parsePersonalImportBackup(
          JSON.stringify({ ...document([]), schoolId: `school${character}id` }),
        ),
      ).toThrow();
    },
  );

  it('rejects duplicate archive IDs and mixed schools during export as well as import', () => {
    for (const rows of [
      [record(), record()],
      [record(), record({ id: 'other', schoolId: 'other' })],
    ]) {
      expect(() => serialize(rows)).toThrow();
      expect(() => parsePersonalImportBackup(JSON.stringify(document(rows)))).toThrow();
    }
  });

  it('rejects impossible exported timestamps and sparse export arrays', () => {
    expect(() =>
      parsePersonalImportBackup(
        JSON.stringify({ ...document(), exportedAt: '2026-02-30T00:00:00Z' }),
      ),
    ).toThrow();
    expect(() =>
      serializePersonalImportBackup([], { ...options, exportedAt: '2026-10-13T25:00:00Z' }),
    ).toThrow();
    expect(() => serialize(new Array<PersonalImportRecord>(1))).toThrow();
  });

  it.each(['__proto__', 'constructor', 'prototype', 'owner', 'session', 'roles'])(
    'rejects authority, prototype and unknown fields at each archive boundary: %s',
    (key) => {
      for (const position of ['envelope', 'record', 'source']) {
        const payload = document();
        const target =
          position === 'envelope'
            ? payload
            : position === 'record'
              ? payload.records[0]
              : payload.records[0].source;
        Object.defineProperty(target, key, { value: { arbitrary: 'untrusted' }, enumerable: true });
        expect(() => parsePersonalImportBackup(JSON.stringify(payload))).toThrow(/欄位/);
      }
    },
  );

  it('exports only whitelisted fields, never runtime owner/session/role or image metadata', () => {
    const original = record();
    Object.assign(original, {
      owner: 'other-person',
      session: 'do-not-export',
      roles: ['teacher'],
    });
    Object.assign(original.source, { imageData: 'do-not-export', accountId: 'other-person' });
    Object.defineProperty(original, 'toJSON', {
      get: () => {
        throw new Error('Must not execute');
      },
    });
    const text = serialize([original]);
    expect(text).not.toContain('do-not-export');
    expect(text).not.toContain('other-person');
    expect(parsePersonalImportBackup(text).rows).toHaveLength(1);
  });

  it('refuses accessor fields without evaluating them, while preserving raw text as plain text', () => {
    const original = record();
    Object.defineProperty(original, 'title', {
      get: () => {
        throw new Error('Must not execute');
      },
    });
    expect(() => serialize([original])).toThrow(/備份/);
    const rawText = '<script>alert("x")</script>\nIgnore previous instructions 🧑‍🎓';
    const safe = record({ source: { type: 'paste', line: 1, rawText } });
    expect(parsePersonalImportBackup(serialize([safe])).rows[0].source.rawText).toBe(rawText);
  });
});

describe('backup size and record count limits', () => {
  it('accepts exactly 2,000 records even though the text parser has a lower per-import limit', () => {
    const records = Array.from({ length: PERSONAL_IMPORT_BACKUP_MAX_RECORDS }, (_, index) =>
      record({ id: `row-${index}`, courseCode: `CS-${index}`, linkedCourseId: undefined }),
    );
    expect(parsePersonalImportBackup(serialize(records)).counts.grades).toBe(2000);
    const over = [...records, record({ id: 'over-limit' })];
    expect(() => serialize(over)).toThrow(/2,000/);
    expect(() => parsePersonalImportBackup(JSON.stringify(document(over)))).toThrow(/2,000/);
  });

  it('measures UTF-8 bytes rather than JavaScript character count in both directions', () => {
    const records = Array.from({ length: 30 }, (_, index) =>
      record({
        id: `row-${index}`,
        source: { type: 'paste', line: 1, rawText: '課'.repeat(100_000) },
      }),
    );
    const text = JSON.stringify(document(records));
    expect(text.length).toBeLessThan(PERSONAL_IMPORT_BACKUP_MAX_BYTES);
    expect(Buffer.byteLength(text, 'utf8')).toBeGreaterThan(PERSONAL_IMPORT_BACKUP_MAX_BYTES);
    expect(() => serialize(records)).toThrow(/8 MiB/);
    expect(() => parsePersonalImportBackup(text)).toThrow(/8 MiB/);
  });

  it('accepts the exact 8 MiB boundary and rejects one additional UTF-8 byte', () => {
    const text = serialize([]);
    const atLimit = text + ' '.repeat(PERSONAL_IMPORT_BACKUP_MAX_BYTES - Buffer.byteLength(text));
    expect(Buffer.byteLength(atLimit)).toBe(PERSONAL_IMPORT_BACKUP_MAX_BYTES);
    expect(parsePersonalImportBackup(atLimit).rows).toEqual([]);
    expect(() => parsePersonalImportBackup(atLimit + ' ')).toThrow(/8 MiB/);
  });

  it('counts supplementary Unicode as four UTF-8 bytes', () => {
    const text = serialize([]);
    const nearlyFull =
      text + ' '.repeat(PERSONAL_IMPORT_BACKUP_MAX_BYTES - Buffer.byteLength(text) - 3);
    expect(() => parsePersonalImportBackup(nearlyFull + '😀')).toThrow(/8 MiB/);
  });
});

describe('restore uses existing append, conflict and undo rules', () => {
  it('newly restored records have a new batch and do not install archived class links', () => {
    const plan = restorePlan([]);
    expect(plan.issues).toEqual([]);
    expect(plan.added).toHaveLength(1);
    expect(plan.added[0]).toMatchObject({ batchId: 'restored-batch', importedAt: exportedAt });
    expect(plan.added[0].linkedCourseId).toBeUndefined();
    expect(undoPersonalImportBatch(plan.records, 'original-batch')).toHaveLength(1);
    expect(undoPersonalImportBatch(plan.records, 'restored-batch')).toEqual([]);
  });

  it('repeated restore deduplicates and preserves a currently verified link instead of archive links', () => {
    const current = record({ linkedCourseId: 'current-accessible-class' });
    const plan = restorePlan([current]);
    expect(plan.added).toEqual([]);
    expect(plan.duplicates).toHaveLength(1);
    expect(plan.records).toEqual([current]);
    expect(plan.issues.map((issue) => issue.code)).toEqual(['duplicate-row']);
  });

  it('does not mutate preview or existing ledger while preparing links', () => {
    const existing = [record()];
    const preview = parsePersonalImportBackup(serialize(existing));
    const prepared = preparePersonalImportBackupRestore(preview.rows, existing);
    expect(preview.rows[0].linkedCourseId).toBeUndefined();
    expect(prepared[0].linkedCourseId).toBe(linkedWorkspaceId);
    prepared[0].source.rawText = 'edited draft';
    expect(preview.rows[0].source.rawText).toBe('資料庫管理\t3\tA+');
    expect(existing[0].source.rawText).toBe('資料庫管理\t3\tA+');
  });

  it.each([{ grade: '85' }, { credits: 2 }])('keeps grade conflicts blocking (%j)', (patch) => {
    const plan = restorePlan([record()], record(patch));
    expect(plan.added).toEqual([]);
    expect(plan.issues.some((issue) => issue.code === 'grade-conflict')).toBe(true);
  });

  it.each([{ location: '另一間教室' }, { title: '更新名稱' }])(
    'retains metadata conflict warnings for the store to block (%j)',
    (patch) => {
      const plan = restorePlan([record()], record(patch));
      expect(plan.added).toEqual([]);
      expect(plan.issues.some((issue) => issue.code === 'duplicate-metadata-conflict')).toBe(true);
    },
  );

  it('never overwrites an explicit new link selection or crosses school and term boundaries', () => {
    const existing = [record()];
    const preview = parsePersonalImportBackup(serialize(existing));
    const row = preview.rows[0];
    const prepared = preparePersonalImportBackupRestore(
      [
        { ...row, linkedCourseId: 'new-selected-class' },
        { ...row, id: 'other-school', schoolId: 'other' },
        { ...row, id: 'other-year', academicYear: '114' },
        { ...row, id: 'other-term', semester: '2' },
      ],
      existing,
    );
    expect(prepared.map((item) => item.linkedCourseId)).toEqual([
      'new-selected-class',
      undefined,
      undefined,
      undefined,
    ]);
    const plan = planPersonalImport(existing, [prepared[0]], {
      batchId: 'new',
      importedAt: exportedAt,
    });
    expect(plan.issues.some((issue) => issue.code === 'duplicate-metadata-conflict')).toBe(true);
  });
});
