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
