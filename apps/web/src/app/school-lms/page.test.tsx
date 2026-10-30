import { expect, it } from 'vitest';
import SchoolLmsPage from './page';

it('redirects /school-lms to native classroom before loading school data', () => {
  expect(() => SchoolLmsPage()).toThrow(
    expect.objectContaining({ digest: 'NEXT_REDIRECT;replace;/classroom;307;' }),
  );
});
