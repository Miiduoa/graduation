import * as Linking from 'expo-linking';
import { parseStudentCardDeepLink } from '../app/studentCardDeepLink';
import { preAuthLinking } from '../app/preAuthLinking';

jest.mock('expo-linking', () => ({
  createURL: (path: string) => `campus://${path}`,
  getInitialURL: jest.fn(),
  addEventListener: jest.fn(),
}));

const token = 'aB01_-'.repeat(5) + 'xY';
const url = `https://nuni.tw/student-card/verify#${token}`;

beforeEach(() => jest.clearAllMocks());

test('accepts the canonical fragment link emitted by the student card', () => {
  expect(parseStudentCardDeepLink(url)).toBe(token);
});

test.each([
  null,
  undefined,
  123,
  '',
  `http://nuni.tw/student-card/verify#${token}`,
  `campus://student-card/verify#${token}`,
  `https://www.nuni.tw/student-card/verify#${token}`,
  `https://nuni.tw.example.com/student-card/verify#${token}`,
  `https://nuni.tw@other.example/student-card/verify#${token}`,
  `https://user:password@nuni.tw/student-card/verify#${token}`,
  `https://nuni.tw:443/student-card/verify#${token}`,
  `https://nuni.tw/student-card/verify/#${token}`,
  `https://nuni.tw/other/../student-card/verify#${token}`,
  `https://nuni.tw/student-card/%76erify#${token}`,
  `https://nuni.tw/student-card/verify?token=${token}`,
  `https://nuni.tw/student-card/verify?source=qr#${token}`,
  `https://nuni.tw/student-card/verify?#${token}`,
  'https://nuni.tw/student-card/verify#',
  `https://nuni.tw/student-card/verify#${'a'.repeat(31)}`,
  `https://nuni.tw/student-card/verify#${'a'.repeat(33)}`,
  `https://nuni.tw/student-card/verify#${'a'.repeat(31)}%61`,
  `https://nuni.tw/student-card/verify#${'a'.repeat(31)}+`,
  `https://nuni.tw/student-card/verify#${token}?other=1`,
  ` ${url}`,
  `${url}\n`,
])('ignores a noncanonical or malformed verification URL (%#)', (candidate) => {
  expect(parseStudentCardDeepLink(candidate)).toBeNull();
});

test('keeps a cold-start verification token out of public navigation state', async () => {
  jest.mocked(Linking.getInitialURL).mockResolvedValueOnce(url);
  expect(await preAuthLinking.getInitialURL?.()).toBeNull();
  jest.mocked(Linking.getInitialURL).mockResolvedValueOnce('campus://map');
  expect(await preAuthLinking.getInitialURL?.()).toBe('campus://map');
});

test('intercepts verification events while preserving other public links and cleanup', () => {
  let receive: (event: { url: string }) => void = () => undefined;
  const remove = jest.fn();
  jest.mocked(Linking.addEventListener).mockImplementation((_event, listener) => {
    receive = listener;
    return { remove };
  });
  const listener = jest.fn();
  const unsubscribe = preAuthLinking.subscribe?.(listener);
  receive({ url });
  expect(listener).not.toHaveBeenCalled();
  receive({ url: 'campus://map' });
  expect(listener).toHaveBeenCalledWith('campus://map');
  if (typeof unsubscribe === 'function') unsubscribe();
  expect(remove).toHaveBeenCalledTimes(1);
});
