import { expect, it } from 'vitest';
import { publicDiningCafeterias } from '@campus/shared';

it('keeps NCKU and NTPU dining catalogs isolated and sourced', () => {
  const ncku = publicDiningCafeterias('ncku');
  const ntpu = publicDiningCafeterias('ntpu');
  expect(ncku.length).toBeGreaterThan(0);
  expect(ntpu.length).toBeGreaterThan(0);
  expect(ncku.every((row) => row.schoolId === 'ncku')).toBe(true);
  expect(ntpu.every((row) => row.schoolId === 'ntpu')).toBe(true);
  expect(ncku.every((row) => row.merchantMode === 'info_only')).toBe(true);
  expect(ntpu.every((row) => row.merchantMode === 'info_only')).toBe(true);
  expect(ncku.some((row) => row.id.startsWith('ntpu-'))).toBe(false);
  expect(ntpu.some((row) => row.id.startsWith('ncku-'))).toBe(false);
  expect(ncku.every((row) => Boolean(row.websiteUrl && row.sourceLabel))).toBe(true);
  expect(ntpu.every((row) => Boolean(row.websiteUrl && row.sourceLabel))).toBe(true);
  expect(ncku.find((row) => row.name === '光復餐廳')?.websiteUrl).toContain('ncku-cafeteria');
  expect(ncku.find((row) => row.name === '光復餐廳')?.openingHours).toBe('待補');
  expect(ncku.find((row) => row.name === '光復餐廳')?.sourceLabel).toContain('107–108');
  expect(ntpu.find((row) => row.name === '優米自助餐')?.websiteUrl).toContain('life.ntpu.edu.tw');
  expect(publicDiningCafeterias('pu')).toEqual([]);
  expect(publicDiningCafeterias('nthu')).toEqual([]);
});
