import { expect, it, vi } from 'vitest';
import { redirect } from 'next/navigation';
import ClassroomGradesPage from './page';

vi.mock('next/navigation', () => ({
  redirect: vi.fn(),
}));

it('sends /classroom/grades to the merged grades feedback tab and keeps other query parameters', async () => {
  await ClassroomGradesPage({
    searchParams: Promise.resolve({ schoolId: 'tw-pu', tab: 'semester' }),
  });
  expect(redirect).toHaveBeenCalledWith('/grades?schoolId=tw-pu&tab=feedback');
});
