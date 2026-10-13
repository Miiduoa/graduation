import { finishLoginReturn, parseLoginReturnTo } from '../utils/loginReturn';
import { safeNavigate } from '../utils/safeNavigate';

jest.mock('../utils/safeNavigate', () => ({
  safeNavigate: jest.fn(() => true),
}));

beforeEach(() => {
  jest.mocked(safeNavigate).mockReset().mockReturnValue(true);
});

test.each([
  ['/cafeteria/stall', { route: 'Storefront', params: { cafeteriaId: 'stall' } }],
  ['/cafeteria', { route: 'Cafeteria' }],
  ['/lost-found', { route: 'LostFound' }],
  ['/lost-found/item-1', { route: 'LostFoundDetail', params: { id: 'item-1' } }],
  ['/lost-found/post', { route: 'LostFoundPost' }],
])('maps in-app return path %s', (path, destination) => {
  expect(parseLoginReturnTo(path)).toEqual(destination);
});

test.each(['https://evil.test', '//evil.test', '/\\evil.test', 'javascript:alert(1)', ''])(
  'rejects an off-site or empty returnTo %j',
  (path) => {
    expect(parseLoginReturnTo(path)).toBeNull();
  },
);

test('returns to the same storefront after login', () => {
  const navigation = { goBack: jest.fn(), navigate: jest.fn() };
  expect(finishLoginReturn(navigation, '/cafeteria/stall')).toBe(true);
  expect(safeNavigate).toHaveBeenCalledWith(navigation, 'Storefront', { cafeteriaId: 'stall' });
  expect(navigation.goBack).not.toHaveBeenCalled();
});

test('falls back to goBack when returnTo is off-site', () => {
  const navigation = { goBack: jest.fn(), navigate: jest.fn() };
  expect(finishLoginReturn(navigation, 'https://evil.test')).toBe(false);
  expect(safeNavigate).not.toHaveBeenCalled();
  expect(navigation.goBack).toHaveBeenCalled();
});
