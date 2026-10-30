import { expect, it } from 'vitest';
import SchoolCoursesPage from './page';

it('redirects /school-courses to native classroom before loading school data', () => {
  expect(() => SchoolCoursesPage()).toThrow(
    expect.objectContaining({ digest: 'NEXT_REDIRECT;replace;/classroom;307;' }),
  );
});
