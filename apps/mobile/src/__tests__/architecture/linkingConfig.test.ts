import { schoolLinking } from '../../app/schoolLinking';

jest.unmock('@react-navigation/native');
jest.mock('expo-linking', () => ({ createURL: () => 'campus://' }));

type ScreenPaths = {
  [screen: string]: string | { path?: string; screens?: ScreenPaths } | undefined;
};

function registeredPaths(
  screens: ScreenPaths,
  prefix = '',
): Array<{ screen: string; path: string }> {
  return Object.entries(screens).flatMap(([screen, entry]) => {
    if (entry === undefined) return [];
    if (typeof entry === 'string') return [{ screen, path: `${prefix}${entry}` }];
    const path = `${prefix}${entry.path ?? ''}`;
    if (entry.screens) return registeredPaths(entry.screens, path ? `${path}/` : '');
    return entry.path === undefined ? [] : [{ screen, path }];
  });
}

describe('navigation linking config', () => {
  it('registers the dormitory deep link in the school-session campus tab', () => {
    expect(
      schoolLinking.getStateFromPath?.('dormitory?schoolId=pu', schoolLinking.config),
    ).toMatchObject({
      routes: [
        {
          name: '校園',
          state: { routes: [{ name: 'Dormitory', params: { schoolId: 'pu' } }] },
        },
      ],
    });
  });

  it('does not reuse the same path for multiple screens', () => {
    const paths = registeredPaths(schoolLinking.config?.screens ?? {});
    expect(paths.length).toBeGreaterThan(0);
    const duplicatePaths = [...new Set(paths.map((entry) => entry.path))]
      .map((pathValue) => ({
        path: pathValue,
        screens: paths.filter((entry) => entry.path === pathValue).map((entry) => entry.screen),
      }))
      .filter((entry) => entry.screens.length > 1);

    expect(duplicatePaths).toEqual([]);
  });
});
