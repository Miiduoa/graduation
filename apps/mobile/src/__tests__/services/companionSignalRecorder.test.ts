import AsyncStorage from '@react-native-async-storage/async-storage';
import { setDoc } from 'firebase/firestore';
import {
  flushCompanionEvents,
  getCompanionQueueSize,
  primeCompanionRecorder,
  recordCompanionEvent,
} from '../../services/companionSignalRecorder';

jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: { getItem: jest.fn(), setItem: jest.fn() },
}));
jest.mock('../../firebase', () => ({ getFirebaseApp: jest.fn(() => ({})) }));
jest.mock('firebase/firestore', () => ({
  getFirestore: jest.fn(() => ({})),
  collection: jest.fn(() => ({})),
  doc: jest.fn(() => ({})),
  setDoc: jest.fn(),
  serverTimestamp: jest.fn(),
}));

const getItem = AsyncStorage.getItem as jest.Mock;
const setItem = AsyncStorage.setItem as jest.Mock;
const writeEvent = setDoc as jest.Mock;
let stored: string | null;

function queuedIds(): string[] {
  return JSON.parse(stored ?? '[]').map(
    (event: { payload: { assignmentId: string } }) => event.payload.assignmentId,
  );
}

function record(assignmentId: string, uid: string | null = 'student') {
  return recordCompanionEvent('assignment_submitted', { uid, payload: { assignmentId } });
}

beforeEach(async () => {
  jest.resetAllMocks();
  stored = null;
  getItem.mockImplementation(async () => stored);
  setItem.mockImplementation(async (_key: string, value: string) => {
    stored = value;
  });
  writeEvent.mockResolvedValue(undefined);
  await primeCompanionRecorder();
});

it('preserves all events when multiple callers record concurrently', async () => {
  await Promise.all([record('first'), record('second'), record('third')]);
  expect(queuedIds()).toEqual(['first', 'second', 'third']);
  expect(getCompanionQueueSize()).toBe(3);
});

it('does not block recording during a network write or discard the new event at flush completion', async () => {
  await record('old');
  let finishWrite!: () => void;
  let notifyStarted!: () => void;
  const started = new Promise<void>((resolve) => { notifyStarted = resolve; });
  writeEvent.mockImplementationOnce(() => new Promise<void>((resolve) => {
    finishWrite = resolve;
    notifyStarted();
  }));
  const flushing = flushCompanionEvents();
  await started;
  try {
    await record('new');
    expect(queuedIds()).toEqual(['old', 'new']);
  } finally {
    finishWrite();
  }
  await expect(flushing).resolves.toEqual({ flushed: 1, remaining: 1 });
  expect(queuedIds()).toEqual(['new']);
  expect(getCompanionQueueSize()).toBe(1);
});

it('does not overwrite stored events after a transient storage read failure', async () => {
  await record('old');
  getItem.mockRejectedValueOnce(new Error('storage unavailable'));
  await expect(record('during-failure')).resolves.toBeUndefined();
  expect(queuedIds()).toEqual(['old']);
  await record('recovered');
  expect(queuedIds()).toEqual(['old', 'recovered']);
});

it('retains failed writes and events without a uid while removing only successful writes', async () => {
  await record('failed');
  await record('anonymous', null);
  await record('success');
  writeEvent.mockRejectedValueOnce(new Error('offline'));
  await expect(flushCompanionEvents()).resolves.toEqual({ flushed: 1, remaining: 2 });
  expect(queuedIds()).toEqual(['failed', 'anonymous']);
  expect(writeEvent).toHaveBeenCalledTimes(2);
});

it('keeps the in-memory snapshot within the persisted queue budget', async () => {
  await record('x'.repeat(65_000));
  expect(queuedIds()).toEqual([]);
  expect(getCompanionQueueSize()).toBe(0);
});
