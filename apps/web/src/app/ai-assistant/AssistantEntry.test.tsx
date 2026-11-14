import { render, screen } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { AssistantEntry } from './AssistantEntry';

const state = vi.hoisted(() => ({
  session: { context: 'session-a', platformAccountId: 'account-a' } as { context: string; platformAccountId: string } | null,
  loading: false,
  error: '',
  pendingLogout: false,
  uid: 'school-a' as string | null,
  schoolLoading: false,
  schoolError: null as string | null,
  functionsConfigured: false,
  instance: 0,
}));
vi.mock('@/features/nuni/Session', () => ({ useNuniSession: () => ({
  session: state.session, loading: state.loading, error: state.error, pendingLogout: state.pendingLogout,
}) }));
vi.mock('@/components/AuthGuard', () => ({ useAuth: () => ({
  user: state.uid ? { uid: state.uid } : null, loading: state.schoolLoading, error: state.schoolError,
}) }));
vi.mock('@/lib/functionsUrl', () => ({ areFunctionsConfigured: () => state.functionsConfigured }));
vi.mock('./LegacyAssistant', () => ({ default: ({ children }: { children?: React.ReactNode }) =>
  <section data-testid="school-assistant">{children}</section> }));
vi.mock('@/features/nuni/Assistant', async () => {
  const { useState } = await import('react');
  return { Assistant: ({ cloudEnabled, children }: { cloudEnabled: boolean; children?: React.ReactNode }) => {
    const [instance] = useState(() => ++state.instance);
    return <section data-testid="platform-assistant" data-cloud-enabled={String(cloudEnabled)} data-instance={instance}>{children}</section>;
  } };
});

beforeEach(() => {
  state.session = { context: 'session-a', platformAccountId: 'account-a' };
  state.loading = false;
  state.error = '';
  state.pendingLogout = false;
  state.uid = 'school-a';
  state.schoolLoading = false;
  state.schoolError = null;
  state.functionsConfigured = false;
});

it.each([null, 'school-a'])('uses verified platform reads with cloud disabled and no Functions (school user %s)', (uid) => {
  state.uid = uid;
  render(<AssistantEntry cloudEnabled={false}><p>頁面說明</p></AssistantEntry>);
  expect(screen.getByTestId('platform-assistant').getAttribute('data-cloud-enabled')).toBe('false');
  expect(screen.getByText('頁面說明')).toBeTruthy();
  expect(screen.queryByTestId('school-assistant')).toBeNull();
});

it('preserves the configured school data engine for a dual account', () => {
  state.functionsConfigured = true;
  render(<AssistantEntry cloudEnabled={false} />);
  expect(screen.getByTestId('school-assistant')).toBeTruthy();
  expect(screen.queryByTestId('platform-assistant')).toBeNull();
});

it('uses platform-only reads even when Functions exist but there is no school account', () => {
  state.functionsConfigured = true;
  state.uid = null;
  render(<AssistantEntry cloudEnabled={false} />);
  expect(screen.getByTestId('platform-assistant').getAttribute('data-cloud-enabled')).toBe('false');
});

it('keeps the enabled cloud assistant selected for a verified platform session', () => {
  state.functionsConfigured = true;
  render(<AssistantEntry cloudEnabled />);
  expect(screen.getByTestId('platform-assistant').getAttribute('data-cloud-enabled')).toBe('true');
});

it('retains the school entry when no platform session exists', () => {
  state.session = null;
  render(<AssistantEntry cloudEnabled={false} />);
  expect(screen.getByTestId('school-assistant')).toBeTruthy();
});

it('waits for school identity only when that configured engine may be selected', () => {
  state.functionsConfigured = true;
  state.schoolLoading = true;
  const view = render(<AssistantEntry cloudEnabled={false} />);
  expect(screen.getByRole('status').textContent).toContain('正在確認學校帳號');
  state.functionsConfigured = false;
  view.rerender(<AssistantEntry cloudEnabled={false} />);
  expect(screen.getByTestId('platform-assistant')).toBeTruthy();
});

it.each(['flag', 'session', 'account'])('remounts a platform conversation boundary on a %s change', (change) => {
  const view = render(<AssistantEntry cloudEnabled />);
  const first = screen.getByTestId('platform-assistant').getAttribute('data-instance');
  if (change === 'session') state.session = { ...state.session!, context: 'session-b' };
  if (change === 'account') state.session = { ...state.session!, platformAccountId: 'account-b' };
  view.rerender(<AssistantEntry cloudEnabled={change !== 'flag'} />);
  expect(screen.getByTestId('platform-assistant').getAttribute('data-instance')).not.toBe(first);
});
