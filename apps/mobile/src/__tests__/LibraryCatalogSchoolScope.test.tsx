import React from 'react';
import { act, fireEvent, render } from '@testing-library/react-native';
import { Linking } from 'react-native';
import LibraryCatalogScreen from '../screens/LibraryCatalogScreen';

let mockSchool = { id: 'nthu', name: '國立清華大學' };

jest.mock('../state/school', () => ({ useSchool: () => ({ school: mockSchool }) }));
jest.mock('../ui/components', () => ({
  Screen: ({ children }: { children: React.ReactNode }) =>
    require('react').createElement(require('react-native').View, null, children),
}));
jest.mock('../screens/LibraryOpacPanel', () => ({
  LibraryOpacPanel: () =>
    require('react').createElement(require('react-native').Text, null, '靜宜館藏搜尋面板'),
}));
jest.mock('../services/analytics', () => ({
  analytics: { logScreenView: jest.fn() },
}));
jest.mock('../ui/navigationTheme', () => ({ TAB_BAR_CONTENT_BOTTOM_PADDING: 80 }));
jest.mock('../ui/theme', () => ({
  theme: {
    layout: { screenHorizontalPadding: 16 },
    colors: {
      text: '#202020',
      muted: '#686868',
      accent: '#08715a',
      onAccent: '#ffffff',
      danger: '#b91c1c',
    },
  },
}));

beforeEach(() => {
  jest.clearAllMocks();
  mockSchool = { id: 'nthu', name: '國立清華大學' };
  jest.spyOn(Linking, 'openURL').mockResolvedValue(undefined);
});
afterEach(() => jest.restoreAllMocks());

test('a foreign campus deep link opens its own catalog, never Providence OPAC', async () => {
  const view = render(<LibraryCatalogScreen route={{ params: { initialQuery: '資料庫' } }} />);
  expect(view.queryByText('靜宜館藏搜尋面板')).toBeNull();
  await act(async () => fireEvent.press(view.getByText('搜尋本校館藏')));
  const url = new URL(jest.mocked(Linking.openURL).mock.calls[0][0]);
  expect(url.hostname).toBe('nthu.primo.exlibrisgroup.com');
  expect(url.searchParams.get('vid')).toBe('886UST_NTHU:886UST_NTHU');
  expect(url.searchParams.get('query')).toBe('any,contains,資料庫');
});

test('a failed official catalog link reports the error instead of silently ignoring it', async () => {
  jest.mocked(Linking.openURL).mockRejectedValueOnce(new Error('no browser'));
  const view = render(<LibraryCatalogScreen />);
  await act(async () => fireEvent.press(view.getByText('開啟學校官方館藏')));
  expect(view.getByText('無法開啟館藏網站，請確認網路連線後再試。')).toBeTruthy();
  mockSchool = { id: 'ntu', name: '國立臺灣大學' };
  view.rerender(<LibraryCatalogScreen />);
  expect(view.queryByText('無法開啟館藏網站，請確認網路連線後再試。')).toBeNull();
});

test('an unknown school cannot open any other institution catalog', () => {
  mockSchool = { id: 'unknown-campus', name: '未接入校園' };
  const view = render(<LibraryCatalogScreen />);
  expect(view.queryByText('開啟學校官方館藏')).toBeNull();
  expect(view.queryByText('靜宜館藏搜尋面板')).toBeNull();
  expect(Linking.openURL).not.toHaveBeenCalled();
});

test('Providence retains its real integrated OPAC search', () => {
  mockSchool = { id: 'pu', name: '靜宜大學' };
  const view = render(<LibraryCatalogScreen />);
  expect(view.getByText('靜宜館藏搜尋面板')).toBeTruthy();
  expect(view.queryByText('開啟學校官方館藏')).toBeNull();
});
