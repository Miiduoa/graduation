import { render, screen, within } from '@testing-library/react';
import { expect, it } from 'vitest';
import { StudySourceTables } from './StudySourceTables';
import { extractStudySourceTables } from './studySourceTables';

const source = [
  '課堂資料（數值請依原始教材核對）：',
  '| 科目 | 學分 | 教室 |',
  '| :--- | ---: | --- |',
  '| 資料庫 | 3 | 301 |',
  '| 計算機概論 | 2 | 205 |',
].join('\n');

it('keeps exact original values and column order in accessible table cells', () => {
  expect(extractStudySourceTables(source)).toEqual([{
    startLine: 2,
    headers: ['科目', '學分', '教室'],
    rows: [['資料庫', '3', '301'], ['計算機概論', '2', '205']],
  }]);
  render(<StudySourceTables text={source} />);
  const table = screen.getByRole('table', { name: '原文第 2 行起的表格' });
  expect(within(table).getAllByRole('columnheader').map((cell) => cell.textContent))
    .toEqual(['科目', '學分', '教室']);
  expect(within(table).getAllByRole('row')).toHaveLength(3);
  expect(within(table).getByText('301')).toBeTruthy();
  expect(screen.getByRole('region', { name: /可左右捲動/ }).getAttribute('tabindex')).toBe('0');
});

it('does not render a guessed table for missing cells, escaped pipes or ordinary prose', () => {
  const invalid = [
    '| 科目 | 學分 |',
    '| --- | --- |',
    '| 資料庫 | 3 | 教室301 |',
    '這不是表格，只有 | 隨意分隔的句子。',
    '| 章節 | 概念 |',
    '| --- | --- |',
    '| SQL \\| NoSQL | 資料庫 |',
  ].join('\n');
  expect(extractStudySourceTables(invalid)).toEqual([]);
  const view = render(<StudySourceTables text={invalid} />);
  expect(view.queryByRole('table')).toBeNull();
});

it('ignores Markdown code fences and malformed captions rather than inventing data', () => {
  const tick = String.fromCharCode(96);
  const text = [
    tick.repeat(3) + 'markdown',
    '| 欄一 | 欄二 |',
    '| --- | --- |',
    '| 虛構 | 99 |',
    tick.repeat(3),
    '| 正確 | 單位 |',
    '| --- | --- |',
    '| 學分 | 3 |',
  ].join('\n');
  const parsed = extractStudySourceTables(text);
  expect(parsed).toHaveLength(1);
  expect(parsed[0].rows).toEqual([['學分', '3']]);
});

it('hides a table with more than 20 rows instead of showing an incomplete extract', () => {
  const longTable = [
    '| 第幾題 | 分數 |', '| --- | --- |',
    ...Array.from({ length: 21 }, (_, i) => '| ' + (i + 1) + ' | 1 |'),
  ].join('\n');
  expect(extractStudySourceTables(longTable)).toEqual([]);
});

it('keeps a source change isolated without retaining an earlier passage table', () => {
  const view = render(<StudySourceTables text={source} />);
  expect(screen.getByRole('table')).toBeTruthy();
  view.rerender(<StudySourceTables text="新教材只有段落，沒有表格。" />);
  expect(screen.queryByRole('table')).toBeNull();
});

it('does not mistake a shorter code fence for the end of a longer one', () => {
  const tick = String.fromCharCode(96);
  const content = [
    tick.repeat(4) + 'markdown',
    tick.repeat(3),
    '| 隱藏 | 結果 |',
    '| --- | --- |',
    '| 不是真正表格 | 999 |',
    tick.repeat(4),
    '| 已授權教材 | 學分 |',
    '| --- | --- |',
    '| 資料庫 | 3 |',
  ].join('\n');
  const tables = extractStudySourceTables(content);
  expect(tables).toHaveLength(1);
  expect(tables[0].headers).toEqual(['已授權教材', '學分']);
  expect(tables[0].rows).toEqual([['資料庫', '3']]);
});
