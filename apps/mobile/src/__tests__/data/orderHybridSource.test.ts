const mockCreate = jest.fn(),
  mockFallback = jest.fn();
jest.mock('../../data/firebaseSource', () => ({
  firebaseSource: { createOrder: (...args: unknown[]) => mockCreate(...args) },
}));
jest.mock('../../data/mockSource', () => ({
  mockSource: { createOrder: (...args: unknown[]) => mockFallback(...args) },
}));
jest.mock('../../data/apiAdapters/AdapterRegistry', () => ({}));
jest.mock('../../data/apiAdapters/PUAdapter', () => ({ PUAdapter: class {} }));
jest.mock('../../data/courseSpaceSource', () => ({}));
jest.mock('../../data/campusAgentSource', () => ({}));
jest.mock('../../firebase', () => ({}));
import { hybridSource } from '../../data/hybridSource';
import type { CreateOrderInput } from '../../data/source';
const input: CreateOrderInput = {
  requestId: 'persisted-key',
  userId: 'alice',
  schoolId: 'pu',
  cafeteriaId: 'cafe',
  items: [],
  expectedTotal: 100,
  paymentMethod: 'onsite',
};
beforeEach(() => {
  jest.clearAllMocks();
});
test('passes a persisted key unchanged to the real order source', async () => {
  const receipt = { id: 'real-order', userId: 'alice' };
  mockCreate.mockResolvedValue(receipt);
  expect(await hybridSource.createOrder(input)).toBe(receipt);
  expect(mockCreate).toHaveBeenCalledWith(input);
  expect(mockFallback).not.toHaveBeenCalled();
});
test('never substitutes a local order for a rejected or uncertain real request', async () => {
  const error = new Error('outcome unknown');
  mockCreate.mockRejectedValue(error);
  await expect(hybridSource.createOrder(input)).rejects.toBe(error);
  expect(mockFallback).not.toHaveBeenCalled();
});
test('rejects an unmigrated caller with no request key before any real or mock write', async () => {
  await expect(hybridSource.createOrder({ ...input, requestId: undefined })).rejects.toThrow(
    '送出編號',
  );
  expect(mockCreate).not.toHaveBeenCalled();
  expect(mockFallback).not.toHaveBeenCalled();
});
