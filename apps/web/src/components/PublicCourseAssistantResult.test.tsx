import { render, screen } from '@testing-library/react';
import { expect, it } from 'vitest';
import type { PublicCourseAssistantRead } from '@campus/shared/src/publicCourseAssistantClient';
import { PublicCourseAssistantResult } from './PublicCourseAssistantResult';

const source = {
  schoolId: 'nthu' as const,
  schoolName: '國立清華大學',
  query: '資料庫',
  href: '/school-courses?schoolId=nthu&campus=nthu&q=' + encodeURIComponent('資料庫'),
  sourceUrl: 'https://www.ccxp.nthu.edu.tw/ccxp/INQUIRE/JH/OPENDATA/open_course_data.json',
};
const ready: PublicCourseAssistantRead = {
  ...source,
  status: 'ready',
  fetchedAt: '2026-11-07T08:00:00.000Z',
  matchCount: 50,
  truncated: true,
  courses: [{
    code: 'CS430000', section: '01', title: '資料庫系統', department: 'CS',
    teacher: '測試老師', semester: '1151', credits: '3', time: '一34', room: '資電館101',
  }],
};

it('shows official provenance and an explicit query handoff without an action confirmation', () => {
  render(<PublicCourseAssistantResult read={ready} />);
  expect(screen.getByText('資料庫系統')).toBeTruthy();
  expect(screen.getByText(/115 學年度第 1 學期/)).toBeTruthy();
  expect(screen.getByText('測試老師')).toBeTruthy();
  expect(screen.getByText('3')).toBeTruthy();
  expect(screen.getByText(/本次取得 50 筆開課資料，這裡先顯示 1 筆/)).toBeTruthy();
  expect(screen.getByText(/超過查詢上限/)).toBeTruthy();
  expect(screen.getByText(/校方資料擷取：.*非校方更新時間/)).toBeTruthy();
  expect(screen.getByRole('link', { name: '查看課程與課表核對' }).getAttribute('href')).toBe(source.href);
  const official = screen.getByRole('link', { name: '校方資料來源' });
  expect(official.getAttribute('href')).toBe(source.sourceUrl);
  expect(official.getAttribute('rel')).toBe('noopener noreferrer');
  expect(screen.queryByRole('button')).toBeNull();
});

it('keeps unavailable results distinct from an empty validated catalog', () => {
  const view = render(<PublicCourseAssistantResult read={{ ...source, status: 'unavailable' }} />);
  expect(screen.getByText(/暫時無法取得可核對/)).toBeTruthy();
  expect(screen.queryByText(/沒有符合/)).toBeNull();
  expect(screen.queryByText(/校方資料擷取/)).toBeNull();
  expect(screen.queryByRole('list')).toBeNull();
  view.rerender(<PublicCourseAssistantResult read={{ ...source, status: 'ready', courses: [], matchCount: 0, truncated: false }} />);
  expect(screen.getByText(/沒有符合的開課資料/)).toBeTruthy();
  expect(screen.queryByText(/暫時無法取得/)).toBeNull();
  expect(screen.queryByText(/校方資料擷取/)).toBeNull();
});

it('shows the applied filters, all meeting weekdays and unresolved exclusions with the complete handoff', () => {
  const filtered: PublicCourseAssistantRead = {
    ...ready, filters: { weekday: 1, credits: 3 }, unresolvedCount: 2,
    href: source.href + '&weekday=1&credits=3',
    courses: [{
      ...ready.courses[0], time: 'M3M4\nF3F4',
      meetings: [{ time: 'M3M4', room: '資電館101' }, { time: 'F3F4', room: '資電館102' }],
    }],
  };
  render(<PublicCourseAssistantResult read={filtered} />);
  expect(screen.getByText('已套用條件：星期一有課 · 3 學分')).toBeTruthy();
  expect(screen.getByText('星期一、星期五')).toBeTruthy();
  expect(screen.getByText('當天有課，也可能在其他天上課。')).toBeTruthy();
  expect(screen.getByText(/另有 2 筆資料無法確認是否符合上述篩選條件/)).toBeTruthy();
  expect(screen.getByRole('link', { name: '查看課程與課表核對' }).getAttribute('href')).toBe(filtered.href);
  expect(screen.queryByRole('button')).toBeNull();
});

it('keeps requested filters on an unavailable reply without claiming they were applied', () => {
  const filteredSource = { ...source, query: '', filters: { credits: 0 }, href: source.href + '&credits=0' };
  const view = render(<PublicCourseAssistantResult read={{ ...filteredSource, status: 'unavailable' }} />);
  expect(screen.getByText('關鍵字不限')).toBeTruthy();
  expect(screen.getByText('查詢條件：0 學分')).toBeTruthy();
  expect(screen.queryByText(/已套用條件|未列入結果|沒有符合的開課資料/)).toBeNull();
  expect(screen.getByRole('link', { name: '查看課程與課表核對' }).getAttribute('href')).toBe(filteredSource.href);
  view.rerender(<PublicCourseAssistantResult read={{ ...filteredSource, status: 'ready', courses: [], matchCount: 0, truncated: false, unresolvedCount: 4 }} />);
  expect(screen.getByText('已套用條件：0 學分')).toBeTruthy();
  expect(screen.getByText(/沒有符合的開課資料，可調整關鍵字、星期或學分/)).toBeTruthy();
  expect(screen.getByText(/另有 4 筆資料無法確認/)).toBeTruthy();
  expect(screen.queryByText(/暫時無法取得/)).toBeNull();
});
