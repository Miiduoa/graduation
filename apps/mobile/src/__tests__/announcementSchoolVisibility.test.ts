import Constants from 'expo-constants';
import { isSchoolVisibleInDirectory } from '../services/release';

test('production hides cms-none demo schools even if they were released', () => {
  Object.assign(Constants.expoConfig!, {
    extra: {
      appEnv: 'production',
      release: { releasedSchoolIds: ['pu', 'tw-demo-uni', 'tw-taichung-uni-a'] },
    },
  });
  expect(isSchoolVisibleInDirectory('tw-demo-uni')).toBe(false);
  expect(isSchoolVisibleInDirectory('tw-taichung-uni-a')).toBe(false);
  expect(isSchoolVisibleInDirectory('pu')).toBe(true);
});

test('development still shows cms-none demo schools', () => {
  Object.assign(Constants.expoConfig!, {
    extra: { appEnv: 'development', release: { releasedSchoolIds: [] } },
  });
  expect(isSchoolVisibleInDirectory('tw-demo-uni')).toBe(true);
  expect(isSchoolVisibleInDirectory('tw-taichung-uni-b')).toBe(true);
});
