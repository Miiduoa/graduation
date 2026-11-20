import { expect, it } from 'vitest';
import { serializePersonalImportsCsv, type PersonalImportRow } from '@campus/shared';

const base: PersonalImportRow = {
  id: 'one',
  kind: 'grades',
  title: '中文課程',
  schoolId: 'pu',
  academicYear: '115',
  semester: '1',
  credits: 3,
  grade: 'A',
  source: { type: 'paste', line: 1, rawText: '敏感的原始截圖文字' },
};

it('exports the same columns for Web and App without provenance or private source text', () => {
  const csv = serializePersonalImportsCsv([base]);
  expect(csv.startsWith('\uFEFFkind,title,schoolId,')).toBe(true);
  expect(csv).toContain('"中文課程"');
  expect(csv).toContain('"3"');
  expect(csv).not.toContain('敏感的原始截圖文字');
  expect(csv).not.toContain('one');
  expect(csv.endsWith('\r\n')).toBe(false);
});

it('escapes quote, line break and cells that spreadsheet apps might evaluate', () => {
  const csv = serializePersonalImportsCsv([
    { ...base, title: '課程 "A"\n第二行', teacher: '   =HYPERLINK("https://example.invalid")', grade: '@SUM(1)' },
    { ...base, id: 'two', title: '+CMD', teacher: '\t-2+3', grade: '-1' },
  ]);
  expect(csv).toContain('"課程 ""A""\n第二行"');
  expect(csv).toContain('"\'   =HYPERLINK(""https://example.invalid"")"');
  expect(csv).toContain('"\'@SUM(1)"');
  expect(csv).toContain('"\'+CMD"');
  expect(csv).toContain('"\'\t-2+3"');
  expect(csv).toContain('"\'-1"');
  expect(serializePersonalImportsCsv([])).toMatch(/^\uFEFFkind,title,/);
});
