import { expect, it, vi } from 'vitest';
import { redirect } from 'next/navigation';
import OralExamDemoPage from './page';

vi.mock('next/navigation', () => ({ redirect: vi.fn() }));

it('returns old standalone workspace links to the original classroom page', () => {
  OralExamDemoPage();
  expect(redirect).toHaveBeenCalledWith('/classroom');
});
