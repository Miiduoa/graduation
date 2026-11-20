import { expect, it } from 'vitest';
import { verifiedSocialPoisForSchool } from './pois';

it('exposes real PU places only in the PU school scope', () => {
  expect(verifiedSocialPoisForSchool('pu').some((p) => p.id === 'pu-renyuan')).toBe(true);
  expect(verifiedSocialPoisForSchool('tw-pu').some((p) => p.id === 'pu-library')).toBe(true);
  expect(verifiedSocialPoisForSchool('nthu')).toEqual([]);
  expect(verifiedSocialPoisForSchool('ntu')).toEqual([]);
  expect(verifiedSocialPoisForSchool('unknown-school')).toEqual([]);
  expect(verifiedSocialPoisForSchool('')).toEqual([]);
});
