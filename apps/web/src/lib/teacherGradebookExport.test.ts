import { describe, expect, it } from 'vitest';
import type { TeacherGradebook } from './teacherCourse';
import {
  gradebookCsvCell,
  gradebookUnknownFields,
  teacherGradebookCsv,
  teacherGradebookFilename,
} from './teacherGradebookExport';

const gradebook: TeacherGradebook = {
  course: { id: 'synthetic-course', name: '合成課程', description: '', role: 'instructor' },
  rows: [
    { id: 'a', uid: 'synthetic-a', name: '測試,"姓名"\n第二行', finalScore: null,
      result: null, published: null, publishedAt: null },
    { id: 'b', uid: '=SYNTHETIC()', name: '@測試', finalScore: 0,
      result: 'custom-status', published: false, publishedAt: '2026-01-01T00:00:00Z' },
  ],
};

describe('teacher gradebook CSV with synthetic records', () => {
  it.each(['=SUM(1,2)', '+1', '-1', '@test', '\ttest', '\rtest', '\ntest', '  =1', '\t+1'])
    ('neutralizes a spreadsheet prefix: %j', (value) => {
      expect(gradebookCsvCell(value)).toBe(`"'${value}"`);
    });

  it('quotes commas, quotes and embedded newlines without losing content', () => {
    expect(gradebookCsvCell('a,"b"\nc')).toBe('"a,""b""\nc"');
    expect(gradebookCsvCell(0)).toBe('"0"');
  });

  it('preserves unknown values, zero, custom statuses and source', () => {
    const csv = teacherGradebookCsv(gradebook);
    expect(csv.startsWith('\uFEFF"課程識別"')).toBe(true);
    expect(csv).toContain('"未登錄","未提供","未提供","—"');
    expect(csv).toContain('"0","custom-status","未發布"');
    expect(csv).toContain('目前畫面已授權的課程成績紀錄');
    expect(csv).toContain('"\'=SYNTHETIC()"');
    expect(csv.endsWith('\r\n')).toBe(true);
    expect(gradebookUnknownFields(gradebook)).toBe(4);
  });

  it('exports an empty gradebook as headers only and sanitizes filenames', () => {
    expect(teacherGradebookCsv({ ...gradebook, rows: [] }).split('\r\n')).toHaveLength(2);
    expect(teacherGradebookFilename('../a/b\n')).toBe('gradebook-___a_b_.csv');
    expect(teacherGradebookFilename('x'.repeat(100))).toHaveLength(93);
    expect(teacherGradebookFilename('synthetic-course')).toBe('gradebook-synthetic-course.csv');
  });
});
