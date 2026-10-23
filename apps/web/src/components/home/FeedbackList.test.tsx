import { render, screen, within } from '@testing-library/react';
import { expect, it } from 'vitest';
import { FeedbackList } from './FeedbackList';
import type { HomeFeedback } from '@/lib/homeOverview';

const feedback: HomeFeedback = {
  kind: 'assignment',
  id: 'hw-1',
  courseId: 'course-1',
  courseName: '資料結構',
  title: '期末報告',
  feedback: '針對舊稿的回饋',
  score: 80,
  reviewedAt: '2026-10-11T10:00:00',
  submittedAt: '2026-10-11T03:00:00Z',
  href: '/course/course-1#assignment-hw-1',
};

it('shows accepted Taipei wall times without a device-timezone shift and labels older feedback', () => {
  const { container } = render(<FeedbackList items={[feedback]} />);
  const time = container.querySelector('time');
  expect(time?.getAttribute('datetime')).toBe('2026-10-11T02:00:00.000Z');
  expect(time?.textContent).toContain('10/11');
  expect(time?.textContent).toContain('10:00');
  expect(screen.getByText('這則回饋早於你最近一次繳交，請到作業頁確認是否仍適用。')).toBeTruthy();
});

it('renders equivalent UTC and Taipei timestamps identically without a false stale warning', () => {
  render(
    <FeedbackList
      items={[
        { ...feedback, title: '台北時間', submittedAt: '2026-10-11T01:00:00Z' },
        {
          ...feedback,
          id: 'hw-2',
          title: 'UTC 時間',
          reviewedAt: '2026-10-11T02:00:00Z',
          submittedAt: '2026-10-11T09:00:00',
        },
      ]}
    />,
  );
  const links = screen.getAllByRole('link');
  expect(links[0].querySelector('time')?.textContent).toBe(links[1].querySelector('time')?.textContent);
  for (const link of links) expect(within(link).queryByText(/早於最近繳交/)).toBeNull();
});
