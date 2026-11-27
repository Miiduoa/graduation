import AsyncStorage from '@react-native-async-storage/async-storage';
import { setDoc } from 'firebase/firestore';
import { getFirebaseApp } from '../../firebase';
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
const firebaseApp = getFirebaseApp as jest.Mock;
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
  getItem.mockReset();
  setItem.mockReset();
  writeEvent.mockReset();
  firebaseApp.mockReset();
  stored = null;
  getItem.mockImplementation(async () => stored);
  setItem.mockImplementation(async (_key: string, value: string) => {
    stored = value;
  });
  writeEvent.mockResolvedValue(undefined);
  firebaseApp.mockReturnValue({});
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

it('does not treat a malformed queue snapshot as empty storage', async () => {
  await record('old');
  stored = '{not-json';
  await expect(record('during-parse-failure')).resolves.toBeUndefined();
  expect(stored).toBe('{not-json');
  stored = JSON.stringify([{
    kind: 'assignment_submitted',
    at: '2026-11-26T00:00:00.000Z',
    eventId: 'kept',
    payload: { assignmentId: 'old' },
    uid: 'student',
  }]);
  await record('recovered');
  expect(queuedIds()).toEqual(['old', 'recovered']);
});

it('does not treat a non-array queue snapshot as empty storage', async () => {
  await record('old');
  stored = '{"payload":{"assignmentId":"corrupt"}}';
  await expect(record('during-shape-failure')).resolves.toBeUndefined();
  expect(JSON.parse(stored)).toEqual({ payload: { assignmentId: 'corrupt' } });
});

it('resolves when Firebase initialization fails and leaves the queue intact', async () => {
  await record('kept');
  firebaseApp.mockImplementation(() => {
    throw new Error('firebase unavailable');
  });
  await expect(flushCompanionEvents()).resolves.toEqual({ flushed: 0, remaining: 1 });
  expect(queuedIds()).toEqual(['kept']);
  expect(writeEvent).not.toHaveBeenCalled();
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
