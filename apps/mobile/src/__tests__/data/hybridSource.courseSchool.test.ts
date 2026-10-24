const mockAdapterGetCourse = jest.fn();
const mockFallbackGetCourse = jest.fn();
const mockGetAdapter = jest.fn();
const mockHasAdapter = jest.fn();
jest.mock('../../data/firebaseSource', () => ({ firebaseSource: {} }));
jest.mock('../../data/mockSource', () => ({
  mockSource: { getCourse: (...args: unknown[]) => mockFallbackGetCourse(...args) },
}));
jest.mock('../../data/apiAdapters/AdapterRegistry', () => ({
  getAdapter: (...args: unknown[]) => mockGetAdapter(...args),
  hasAdapter: (...args: unknown[]) => mockHasAdapter(...args),
}));
jest.mock('../../data/apiAdapters/PUAdapter', () => ({ PUAdapter: class {} }));
jest.mock('../../data/courseSpaceSource', () => ({}));
jest.mock('../../data/campusAgentSource', () => ({}));
jest.mock('../../firebase', () => ({}));

import { configureHybridSource, hybridSource, setHybridSourceSchoolContext } from '../../data/hybridSource';

beforeEach(() => {
  jest.useFakeTimers();
  jest.clearAllMocks();
  setHybridSourceSchoolContext('pu');
  configureHybridSource({ preferRealApi: true, fallbackToMock: false });
  mockHasAdapter.mockReturnValue(true);
  mockGetAdapter.mockResolvedValue({ getCourse: mockAdapterGetCourse });
});
afterEach(() => {
  jest.clearAllTimers();
  jest.useRealTimers();
});

test('explicit school B overrides global school A when choosing the real adapter', async () => {
  mockAdapterGetCourse.mockResolvedValue({ id: 'shared', name: 'B course', schoolId: 'ntu' });
  await expect(hybridSource.getCourse('shared', 'ntu')).resolves.toMatchObject({ schoolId: 'ntu' });
  expect(mockGetAdapter).toHaveBeenCalledWith('ntu');
  expect(mockGetAdapter).not.toHaveBeenCalledWith('tw-pu');
  expect(mockAdapterGetCourse).toHaveBeenCalledWith('shared', 'ntu');
  expect(mockFallbackGetCourse).not.toHaveBeenCalled();
});

test('a wrong-school adapter result is rejected', async () => {
  mockAdapterGetCourse.mockResolvedValue({ id: 'shared', name: 'A course', schoolId: 'pu' });
  await expect(hybridSource.getCourse('shared', 'ntu')).resolves.toBeNull();
});

test('the existing no-adapter fallback receives the explicit school instead of PU defaults', async () => {
  mockHasAdapter.mockReturnValue(false);
  mockFallbackGetCourse.mockResolvedValue({ id: 'shared', name: 'A course', schoolId: 'pu' });
  await expect(hybridSource.getCourse('shared', 'ntu')).resolves.toBeNull();
  expect(mockFallbackGetCourse).toHaveBeenCalledWith('shared', 'ntu');
  expect(mockGetAdapter).not.toHaveBeenCalled();
});
