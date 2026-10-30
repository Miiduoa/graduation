import { expect, it } from 'vitest';
import HomeworkDetailPage from './page';

it('redirects /school-lms/homework/[courseId]/[homeworkId] to native classroom before loading school data', () => {
  expect(() => HomeworkDetailPage()).toThrow(
    expect.objectContaining({ digest: 'NEXT_REDIRECT;replace;/classroom;307;' }),
  );
});
