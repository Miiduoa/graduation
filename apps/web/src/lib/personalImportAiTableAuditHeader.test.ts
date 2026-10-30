import { expect, it } from 'vitest';
import { auditPersonalImportAiTable } from '@campus/shared/src/imports/aiTableAudit';
import type { PersonalImportRow } from '@campus/shared/src/imports/types';

it('accepts a continuous source header plus its first data row, but never two data rows', () => {
  const header = '課程名稱,學分,成績';
  const first = '資料庫,3,85';
  const second = '統計學,2,90';
  const text = `${header}\n${first}\n${second}`;
  const row = (title: string, rawText: string, credits: number, grade: string): PersonalImportRow => ({
    id: title, kind: 'grades', title, credits, grade, schoolId: 'pu', academicYear: '115', semester: '1',
    source: { type: 'paste', line: 1, rawText },
  });
  expect(auditPersonalImportAiTable(text, [
    row('資料庫', `${header}\n${first}`, 3, '85'), row('統計學', second, 2, '90'),
  ], 'grades')).toMatchObject({ status: 'matched' });
  expect(auditPersonalImportAiTable(text, [row('資料庫', text, 3, '85')], 'grades'))
    .toMatchObject({ status: 'mismatch', matchedRecords: 0 });
});
