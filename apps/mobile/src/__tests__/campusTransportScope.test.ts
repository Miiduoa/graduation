import { supportsLegacyTransportHub } from '../features/campusTransportScope';

test.each(['pu', 'tw-pu'])('preserves Taichung transport for %s', (schoolId) => {
  expect(supportsLegacyTransportHub(schoolId)).toBe(true);
});

test.each(['nthu', 'ntu', 'tenant-school-12', '', null])(
  'never assumes Taichung stations for another institution: %s',
  (schoolId) => {
    expect(supportsLegacyTransportHub(schoolId)).toBe(false);
  },
);
