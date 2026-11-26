import * as Linking from 'expo-linking';
import { isReservedMaestroHarnessUrl, MAESTRO_LOGIN_LINK } from '../app/maestroHarnessLink';
import { preAuthLinking } from '../app/preAuthLinking';
import { schoolLinking } from '../app/schoolLinking';

jest.mock('expo-linking', () => ({
  createURL: (path: string) => `campus://${path}`,
  getInitialURL: jest.fn(),
  addEventListener: jest.fn(),
}));

beforeEach(() => jest.clearAllMocks());

test('accepts the canonical emulator-login URI and its host-or-path forms', () => {
  expect(MAESTRO_LOGIN_LINK).toBe('campus://maestro/sign-in');
  expect(isReservedMaestroHarnessUrl('campus://maestro/sign-in')).toBe(true);
  expect(isReservedMaestroHarnessUrl('campus://maestro/sign-in/')).toBe(true);
  expect(isReservedMaestroHarnessUrl('campus:///maestro/sign-in')).toBe(true);
});

test.each([
  null,
  undefined,
  '',
  'campus://maestro',
  'campus://maestro/sign-in/extra',
  'campus://maestro/signin',
  'campus://map',
  'campus://groups',
  'campus://maestro/sign-in?source=other',
  'campus://maestro/sign-in#next',
  'https://maestro/sign-in',
  'campus://other/sign-in',
  ' campus://maestro/sign-in',
])('rejects a noncanonical emulator-login URI (%#)', (candidate) => {
  expect(isReservedMaestroHarnessUrl(candidate as string | null | undefined)).toBe(false);
});

test('keeps the emulator-login URI out of guest and school navigation state', () => {
  expect(preAuthLinking.getStateFromPath?.('maestro/sign-in', preAuthLinking.config)).toBeUndefined();
  expect(schoolLinking.getStateFromPath?.('maestro/sign-in', schoolLinking.config)).toBeUndefined();
});

test('keeps a cold-start emulator-login URI out of public navigation', async () => {
  jest.mocked(Linking.getInitialURL).mockResolvedValueOnce(MAESTRO_LOGIN_LINK);
  expect(await preAuthLinking.getInitialURL?.()).toBeNull();
  jest.mocked(Linking.getInitialURL).mockResolvedValueOnce(MAESTRO_LOGIN_LINK);
  expect(await schoolLinking.getInitialURL?.()).toBeNull();
  jest.mocked(Linking.getInitialURL).mockResolvedValueOnce('campus://map');
  expect(await preAuthLinking.getInitialURL?.()).toBe('campus://map');
  jest.mocked(Linking.getInitialURL).mockResolvedValueOnce('campus://map');
  expect(await schoolLinking.getInitialURL?.()).toBe('campus://map');
});

test('intercepts emulator-login events while preserving other public links and cleanup', () => {
  let receive: (event: { url: string }) => void = () => undefined;
  const remove = jest.fn();
  jest.mocked(Linking.addEventListener).mockImplementation((_event, listener) => {
    receive = listener;
    return { remove };
  });
  const listener = jest.fn();
  const unsubscribe = preAuthLinking.subscribe?.(listener);
  receive({ url: MAESTRO_LOGIN_LINK });
  expect(listener).not.toHaveBeenCalled();
  receive({ url: 'campus://map' });
  expect(listener).toHaveBeenCalledWith('campus://map');
  if (typeof unsubscribe === 'function') unsubscribe();
  expect(remove).toHaveBeenCalledTimes(1);
});
