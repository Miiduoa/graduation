const mockCollection = jest.fn();
const mockInvoke = jest.fn();
const mockStop = jest.fn();
jest.mock('../firebase', () => ({ getDb: () => ({}), getFunctionsInstance: () => ({}) }));
jest.mock('firebase/functions', () => ({ httpsCallable: () => mockInvoke }));
jest.mock('firebase/firestore', () => ({
  collection: (...args: unknown[]) => {
    mockCollection(...args);
    return {};
  },
  doc: () => ({}),
  query: () => ({}),
  where: () => ({}),
  onSnapshot: () => mockStop,
}));
import { subscribeDormCloud } from '../services/dormitoryCloud';
import { waitFor } from '@testing-library/react-native';
test('mobile loads legacy parcels through the backend without receiving their Firestore document IDs', async () => {
  mockInvoke.mockResolvedValue({
    data: {
      rows: [{ id: 'dw_synthetic', data: { description: '合成舊包裹', status: 'waiting' } }],
    },
  });
  const update = jest.fn();
  const stop = subscribeDormCloud('tw-pu', 'student', update);
  try {
    await waitFor(() =>
      expect(update.mock.calls.at(-1)?.[0].packages).toEqual([
        expect.objectContaining({ id: 'dw_synthetic', title: '合成舊包裹' }),
      ]),
    );
    expect(mockInvoke).toHaveBeenCalledWith({ schoolId: 'pu', action: 'parcels' });
    expect(mockCollection.mock.calls.some((args) => args.includes('packages'))).toBe(false);
  } finally {
    stop();
  }
});
