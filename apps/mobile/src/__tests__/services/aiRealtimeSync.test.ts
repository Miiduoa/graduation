const mockUnsubscribers = { pu: jest.fn(), nthu: jest.fn() };

jest.mock('../../firebase', () => ({
  getDb: () => 'db',
}));
jest.mock('../../services/liveFirestoreGate', () => ({
  shouldUseLiveFirestoreListeners: () => true,
}));
jest.mock('../../services/aiAppContext', () => ({
  refreshAIAmbientAwareness: jest.fn(),
}));
jest.mock('firebase/firestore', () => ({
  collection: (_db: unknown, ...path: string[]) => path.join('/'),
  query: (path: string) => path,
  orderBy: jest.fn(),
  limit: jest.fn(),
  where: jest.fn(),
  Timestamp: { now: () => ({}), fromMillis: () => ({}) },
  onSnapshot: (path: string) => {
    if (String(path).includes('/pu/')) return mockUnsubscribers.pu;
    if (String(path).includes('/nthu/')) return mockUnsubscribers.nthu;
    return jest.fn();
  },
}));

import { startRealtimeSync, stopRealtimeSync } from '../../services/aiRealtimeSync';

afterEach(() => {
  stopRealtimeSync();
  jest.clearAllMocks();
});

test('switching schools unsubscribes the previous announcement listener', () => {
  const dataSource = {} as never;
  startRealtimeSync({ userId: 'u1', schoolId: 'pu', dataSource });
  expect(mockUnsubscribers.pu).not.toHaveBeenCalled();
  startRealtimeSync({ userId: 'u1', schoolId: 'nthu', dataSource });
  expect(mockUnsubscribers.pu).toHaveBeenCalled();
  stopRealtimeSync();
  expect(mockUnsubscribers.nthu).toHaveBeenCalled();
});
