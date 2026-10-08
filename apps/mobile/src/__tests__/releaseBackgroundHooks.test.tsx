import { loadAiPersonalContext } from '../features/ai';
import React from 'react';
import { act, render, cleanup } from '@testing-library/react-native/pure';
import Constants from 'expo-constants';
import { useAIBrainLifecycle } from '../app/useAIBrain';
import { useAIAmbientAwareness } from '../app/useAIAmbientAwareness';
import { useProactiveAIReporter } from '../app/useProactiveAIReporter';
import { useProactiveAIAgentLoop } from '../app/useProactiveAIAgentLoop';
import { isDevelopmentDemoSession } from '../services/release';
import { aiBrain } from '../services/aiBrain';
import { refreshAIAmbientAwareness } from '../services/aiAmbientAwareness';
import { syncProactiveAIReports } from '../services/proactiveAI';
import { startProactiveBackgroundLoop } from '../services/proactiveAIAgent';
let mockUid: string | null;
const mockData = { listAnnouncements: jest.fn().mockResolvedValue([]) };
const mockSchedule = { courses: [], loading: false };
const mockStop = jest.fn();
jest.mock('../state/auth', () => ({
  useAuth: () => ({
    user: mockUid ? { uid: mockUid } : null,
    profile: { role: 'student', schoolId: 'pu' },
  }),
}));
jest.mock('../state/school', () => ({ useSchool: () => ({ school: { id: 'pu' } }) }));
jest.mock('../state/schedule', () => ({ useSchedule: () => mockSchedule }));
jest.mock('../hooks/useDataSource', () => ({ useDataSource: () => mockData }));
jest.mock('../features/ai', () => ({
  loadAiPersonalContext: jest.fn().mockResolvedValue({ pendingAssignments: [] }),
}));
jest.mock('../services/aiAmbientAwareness', () => ({
  refreshAIAmbientAwareness: jest.fn().mockResolvedValue({}),
}));
jest.mock('../services/proactiveAI', () => ({
  syncProactiveAIReports: jest.fn().mockResolvedValue({}),
}));
jest.mock('../services/proactiveAIAgent', () => ({
  startProactiveBackgroundLoop: jest.fn(() => mockStop),
}));
jest.mock('../services/aiBrain', () => ({
  aiBrain: {
    getSnapshot: () => ({ context: { userId: null }, insights: [], learning: null }),
    subscribe: jest.fn(() => () => undefined),
    start: jest.fn().mockResolvedValue(undefined),
    stop: jest.fn().mockResolvedValue(undefined),
  },
}));
function Lifecycle() {
  useAIBrainLifecycle();
  useAIAmbientAwareness();
  useProactiveAIReporter();
  useProactiveAIAgentLoop();
  return null;
}
beforeEach(() => {
  jest.clearAllMocks();
  jest.useFakeTimers();
  mockUid = 'real-user';
});
afterEach(async () => {
  jest.useRealTimers();
  await cleanup();
});
function configure(appEnv: string, enabled?: boolean) {
  Object.assign(Constants.expoConfig!, { extra: { appEnv, enableUniversalDevAccounts: enabled } });
}
test.each(['production', 'preview'])(
  '%s cannot start local simulated engines even with a demo-shaped ID and an enabled developer flag',
  async (env) => {
    configure(env, true);
    mockUid = 'demo_teacher_chang';
    render(<Lifecycle />);
    await act(async () => jest.advanceTimersByTime(16 * 60_000));
    expect(aiBrain.start).not.toHaveBeenCalled();
    expect(startProactiveBackgroundLoop).not.toHaveBeenCalled();
    expect(refreshAIAmbientAwareness).not.toHaveBeenCalled();
    expect(syncProactiveAIReports).not.toHaveBeenCalled();
  },
);
test('development still needs an explicit demo flag and a demo session', async () => {
  configure('development', true);
  expect(isDevelopmentDemoSession('real-user')).toBe(false);
  configure('development');
  expect(isDevelopmentDemoSession('demo_student_kuchih')).toBe(false);
  render(<Lifecycle />);
  await act(async () => jest.advanceTimersByTime(16 * 60_000));
  expect(startProactiveBackgroundLoop).not.toHaveBeenCalled();
});
test('switching from an explicit development demo to a real account stops future simulated background work', async () => {
  configure('development', true);
  mockUid = 'demo_student_kuchih';
  const view = render(<Lifecycle />);
  await act(async () => jest.advanceTimersByTime(2000));
  expect(aiBrain.start).toHaveBeenCalledTimes(1);
  expect(startProactiveBackgroundLoop).toHaveBeenCalledTimes(1);
  expect(syncProactiveAIReports).toHaveBeenCalledTimes(1);
  expect(refreshAIAmbientAwareness).toHaveBeenCalledTimes(1);
  mockUid = 'real-user';
  view.rerender(<Lifecycle />);
  expect(mockStop).toHaveBeenCalledTimes(1);
  await act(async () => jest.advanceTimersByTime(16 * 60_000));
  expect(aiBrain.start).toHaveBeenCalledTimes(1);
  expect(startProactiveBackgroundLoop).toHaveBeenCalledTimes(1);
  expect(syncProactiveAIReports).toHaveBeenCalledTimes(1);
  expect(refreshAIAmbientAwareness).toHaveBeenCalledTimes(1);
});

test('a late demo data load cannot notify after the account changes', async () => {
  configure('development', true);
  mockUid = 'demo_student_kuchih';
  let resolve!: (value: unknown) => void;
  (loadAiPersonalContext as jest.Mock).mockReturnValueOnce(
    new Promise((yes) => {
      resolve = yes;
    }),
  );
  const view = render(<Lifecycle />);
  await act(async () => jest.advanceTimersByTime(2000));
  mockUid = 'real-user';
  view.rerender(<Lifecycle />);
  await act(async () => resolve({ pendingAssignments: [{ id: 'demo' }] }));
  expect(syncProactiveAIReports).not.toHaveBeenCalled();
});
