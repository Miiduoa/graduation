import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';
import { CampusHubScreen } from '../screens/CampusHubScreen';

let mockSchool = { id: 'pu', name: '靜宜大學' };
jest.mock('../state/school', () => ({ useSchool: () => ({ school: mockSchool }) }));
jest.mock('../state/theme', () => ({ useTheme: () => require('../ui/theme').theme }));
jest.mock('../components/HeaderAvatarButton', () => ({ HeaderAvatarButton: () => null }));
jest.mock('../components/OpenOrderCard', () => ({ OpenOrderCard: () => null }));
jest.mock('../app/rootNavigation', () => ({ rootNavigateNested: jest.fn() }));
jest.mock('../utils/safeNavigate', () => ({ safeNavigate: jest.fn() }));
jest.mock('../ui/AppActionIcon', () => ({ AppActionIcon: () => null }));
jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));

beforeEach(() => {
  mockSchool = { id: 'pu', name: '靜宜大學' };
});

test('Taichung-specific transport entry is only available in its original PU context', () => {
  const view = render(<CampusHubScreen />);
  expect(view.getByText('台中交通')).toBeTruthy();
  mockSchool = { id: 'nthu', name: '國立清華大學' };
  view.rerender(<CampusHubScreen />);
  expect(view.queryByText('台中交通')).toBeNull();
  expect(view.getByText('國立清華大學')).toBeTruthy();
  expect(view.getByText('圖書館')).toBeTruthy();
});

test('another school does not expose Providence-specific library search keywords', () => {
  mockSchool = { id: 'nthu', name: '國立清華大學' };
  const view = render(<CampusHubScreen />);
  fireEvent.changeText(view.getByPlaceholderText('搜尋地點或服務'), '蓋夏');
  expect(view.queryByText('圖書館')).toBeNull();
  fireEvent.changeText(view.getByPlaceholderText('搜尋地點或服務'), '圖書館');
  expect(view.getByText('圖書館')).toBeTruthy();
});
