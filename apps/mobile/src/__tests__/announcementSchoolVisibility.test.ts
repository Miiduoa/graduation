import Constants from 'expo-constants';
import { isSchoolVisibleInDirectory } from '../services/release';

test.each([undefined, '', 'staging', 'production'])(
  'hides cms-none demo schools when extra.appEnv is %s',
  (appEnv) => {
    Object.assign(Constants.expoConfig!, {
      extra: {
        ...(appEnv === undefined ? {} : { appEnv }),
        release: { releasedSchoolIds: ['pu', 'tw-demo-uni', 'tw-taichung-uni-a'] },
      },
    });
    expect(isSchoolVisibleInDirectory('tw-demo-uni')).toBe(false);
    expect(isSchoolVisibleInDirectory('tw-taichung-uni-a')).toBe(false);
    expect(isSchoolVisibleInDirectory('pu')).toBe(true);
  },
);

test.each(['development', 'preview', 'test'])(
  'shows cms-none demo schools when extra.appEnv is %s',
  (appEnv) => {
    Object.assign(Constants.expoConfig!, {
      extra: { appEnv, release: { releasedSchoolIds: [] } },
    });
    expect(isSchoolVisibleInDirectory('tw-demo-uni')).toBe(true);
    expect(isSchoolVisibleInDirectory('tw-taichung-uni-b')).toBe(true);
  },
);
