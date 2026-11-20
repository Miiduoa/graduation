import { canUseProvidencePathNetwork } from '../../features/campusArScope';

test('uses bundled legacy campus paths only within Providence University', () => {
  expect(canUseProvidencePathNetwork('pu')).toBe(true);
});

test.each(['nthu', 'ncu', 'tw-nchu', 'ncku', 'ntu', 'nycu', 'tw-demo-uni', '', 'PU'])(
  'never reuses Providence AR path nodes for another school: %s',
  (schoolId) => {
    expect(canUseProvidencePathNetwork(schoolId)).toBe(false);
  },
);

test('does not presume a campus when identity is absent', () => {
  expect(canUseProvidencePathNetwork(null)).toBe(false);
  expect(canUseProvidencePathNetwork(undefined)).toBe(false);
});
