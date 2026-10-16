import { expect, it } from 'vitest';
import { CAMPUS_TRANSIT, preferredTransitCity } from './transit';

it('uses Tainan for NCKU and New Taipei for NTPU Sanxia without mixing cities', () => {
  expect(preferredTransitCity('ncku')).toBe('Tainan');
  expect(preferredTransitCity('ntpu')).toBe('NewTaipei');
  expect(preferredTransitCity('pu')).toBe('Taichung');
  expect(CAMPUS_TRANSIT.ncku).toEqual({ city: 'Tainan', stopName: '成功大學' });
  expect(CAMPUS_TRANSIT.ntpu).toEqual({ city: 'NewTaipei', stopName: '國立臺北大學' });
  expect(CAMPUS_TRANSIT.ncku.city).not.toBe(CAMPUS_TRANSIT.ntpu.city);
});
