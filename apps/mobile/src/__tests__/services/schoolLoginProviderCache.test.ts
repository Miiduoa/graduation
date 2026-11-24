import { nuniPlatformRequest } from '../../services/nuniClient';
import {
  loadSchoolLoginProviderKinds,
  resetSchoolLoginProviderCache,
  setSchoolLoginProviderKinds,
} from '../../services/schoolLoginAvailability';

jest.mock('../../services/nuniClient', () => ({ nuniPlatformRequest: jest.fn() }));
const request = nuniPlatformRequest as jest.Mock;

beforeEach(() => {
  request.mockReset();
  resetSchoolLoginProviderCache();
});

test('a transient or malformed response fails closed but does not poison later sign-in checks', async () => {
  request.mockRejectedValueOnce(new Error('offline'))
    .mockResolvedValueOnce({ kinds: [42] })
    .mockResolvedValueOnce({ kinds: ['school-issued'] });
  await expect(loadSchoolLoginProviderKinds()).resolves.toEqual([]);
  await expect(loadSchoolLoginProviderKinds()).resolves.toEqual([]);
  await expect(loadSchoolLoginProviderKinds()).resolves.toEqual(['school-issued']);
  await expect(loadSchoolLoginProviderKinds()).resolves.toEqual(['school-issued']);
  expect(request).toHaveBeenCalledTimes(3);
});

test('an authoritative empty provider list remains closed and cached', async () => {
  request.mockResolvedValue({ kinds: [] });
  await expect(loadSchoolLoginProviderKinds()).resolves.toEqual([]);
  await expect(loadSchoolLoginProviderKinds()).resolves.toEqual([]);
  expect(request).toHaveBeenCalledTimes(1);
});

test('a response started before reset cannot restore stale availability', async () => {
  let finish!: (value: unknown) => void;
  request.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
  const pending = loadSchoolLoginProviderKinds();
  resetSchoolLoginProviderCache();
  setSchoolLoginProviderKinds(['google-consumer']);
  finish({ kinds: ['school-issued'] });
  await expect(pending).resolves.toEqual(['google-consumer']);
  await expect(loadSchoolLoginProviderKinds()).resolves.toEqual(['google-consumer']);
});
