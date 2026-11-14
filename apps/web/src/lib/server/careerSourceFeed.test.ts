import { expect, it } from 'vitest';
import { filterCareerSources } from './careerSourceFeed';
import { emptyCareerFeed } from '@campus/shared/src/career';
it('applies source choices without disabling work-study or other public resources', () => {
  const feed = {
    ...emptyCareerFeed(),
    announcements: [
      {
        title: '2099/12/1 實習申請截止',
        date: '',
        url: 'https://cdif.pu.edu.tw/a',
        source: '職產處',
      },
      {
        title: '2099/12/2 實習申請截止',
        date: '',
        url: 'https://csim.pu.edu.tw/b',
        source: '資管系',
      },
    ],
    jobs: [
      {
        title: '測試公開資料',
        company: '測試欄位',
        url: 'https://job.taiwanjobs.gov.tw/',
        source: '台灣就業通' as const,
      },
    ],
  };
  const result = filterCareerSources(feed, {
    office: false,
    departments: true,
    taiwanjobs: false,
    revision: 1,
  });
  expect(result.announcements.map((a) => a.source)).toEqual(['資管系']);
  expect(result.timeline.map((a) => a.source)).toEqual(['資管系']);
  expect(result.jobs).toEqual([]);
  expect(result.jobsUnavailable).toBe(false);
  expect(result.supported).toBe(true);
});
