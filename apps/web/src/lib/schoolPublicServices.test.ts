import { expect, it } from 'vitest';
import { resolveSchoolPublicServices } from '@campus/shared/src/schoolPublicServices';

it('resolves canonical schools and tw- aliases without defaulting to Providence', () => {
  expect(resolveSchoolPublicServices('pu')?.schoolId).toBe('pu');
  expect(resolveSchoolPublicServices('tw-pu')?.schoolId).toBe('pu');
  expect(resolveSchoolPublicServices('ncku')?.schoolName).toBe('國立成功大學');
  expect(resolveSchoolPublicServices('tw-ncku')?.services.health.url).toBe(
    'https://counseling-osa.ncku.edu.tw/',
  );
  expect(resolveSchoolPublicServices('ntpu')?.services.career.url).toBe(
    'https://career.ntpu.edu.tw/cht/index.php',
  );
  expect(resolveSchoolPublicServices('tw-ntpu')?.schoolId).toBe('ntpu');
  expect(resolveSchoolPublicServices('ntu')?.services.courses.url).toBe('https://course.ntu.edu.tw/');
  expect(resolveSchoolPublicServices('tw-ntu')?.schoolId).toBe('ntu');
  expect(resolveSchoolPublicServices(null)).toBeNull();
  expect(resolveSchoolPublicServices(undefined)).toBeNull();
  expect(resolveSchoolPublicServices('')).toBeNull();
  expect(resolveSchoolPublicServices('all')).toBeNull();
  expect(resolveSchoolPublicServices('nthu')).toBeNull();
  expect(resolveSchoolPublicServices('unknown')).toBeNull();
});

it('keeps verified URLs and honest NTU student-portal fallback metadata', () => {
  const pu = resolveSchoolPublicServices('pu')!;
  expect(pu.services.courses).toMatchObject({
    url: 'https://alcat.pu.edu.tw/',
    entryKind: 'student-portal',
  });
  expect(pu.services.dormitory.url).toBe('https://osadorm.pu.edu.tw/');
  expect(pu.services.health.url).toBe('https://osachc.pu.edu.tw/');
  expect(pu.services.career.url).toBe('https://cdif.pu.edu.tw/');
  expect(pu.services.health.sourceLabel.length).toBeGreaterThan(0);

  const ncku = resolveSchoolPublicServices('ncku')!;
  expect(ncku.services.courses.url).toContain('course.ncku.edu.tw');
  expect(ncku.services.dormitory.entryKind).toBe('dedicated');

  const ntpu = resolveSchoolPublicServices('ntpu')!;
  expect(ntpu.services.courses.entryKind).toBe('official-guide');
  expect(ntpu.services.courses.url).toContain('sfai.ntpu.edu.tw');

  const ntu = resolveSchoolPublicServices('ntu')!;
  expect(ntu.services.dormitory.entryKind).toBe('student-portal-fallback');
  expect(ntu.services.health.entryKind).toBe('student-portal-fallback');
  expect(ntu.services.career.entryKind).toBe('student-portal-fallback');
  expect(ntu.services.health.url).toBe('https://www.ntu.edu.tw/student.html');
  expect(ntu.services.health.label).toMatch(/學生專區/);
  expect(ntu.services.courses.entryKind).toBe('dedicated');
});
