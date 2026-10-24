import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { EventRegistrationPanel } from './EventRegistrationPanel';
import type { CampusEvent } from '@/lib/campusEvents';
import type { CampusEventRegistrationIntent } from '@/lib/campusEventIntents';
import { campusEventIntentsStorageKey } from '@/lib/campusEventIntents';
import type { EventRegistrationState } from '@/lib/campusEventRegistration';

const dialogDescriptors = ['showModal', 'close'].map(
  (name) => [name, Object.getOwnPropertyDescriptor(HTMLDialogElement.prototype, name)] as const,
);

const auth = vi.hoisted(() => ({
  user: null as null | { uid: string },
  loading: false,
}));
const options = vi.hoisted(() => ({
  google: true,
  studentId: false,
  loading: false,
  error: false,
  retry: vi.fn(),
}));
const membership = vi.hoisted(() => ({
  watch: vi.fn(),
}));
const registration = vi.hoisted(() => ({
  loadEventRegistrationStates: vi.fn(),
  prepareCampusEventIntent: vi.fn(),
  submitCampusEventIntent: vi.fn(),
  finalizeCampusEventIntent: vi.fn(),
  readPendingCampusEventIntent: vi.fn(),
}));

vi.mock('@/components/AuthGuard', () => ({
  useAuth: () => ({ user: auth.user, loading: auth.loading }),
}));
vi.mock('@/lib/signInOptions', () => ({
  useSignInOptions: () => options,
}));
vi.mock('@/lib/privateMessages', () => ({
  watchMessagingSession: (
    uid: string,
    receive: (session: { uid: string; schoolId: string }) => void,
    fail: (reason: 'permission' | 'unavailable' | 'stale') => void,
  ) => membership.watch(uid, receive, fail),
}));
vi.mock('@/lib/campusEventRegistration', async () => {
  const actual = await vi.importActual<typeof import('@/lib/campusEventRegistration')>(
    '@/lib/campusEventRegistration',
  );
  return {
    ...actual,
    loadEventRegistrationStates: registration.loadEventRegistrationStates,
  };
});
vi.mock('@/lib/campusEventIntents', async () => {
  const actual = await vi.importActual<typeof import('@/lib/campusEventIntents')>(
    '@/lib/campusEventIntents',
  );
  return {
    ...actual,
    prepareCampusEventIntent: registration.prepareCampusEventIntent,
    submitCampusEventIntent: registration.submitCampusEventIntent,
    finalizeCampusEventIntent: registration.finalizeCampusEventIntent,
    readPendingCampusEventIntent: registration.readPendingCampusEventIntent,
  };
});

const clubEvent: CampusEvent = {
  id: 'evt-1',
  schoolId: 'nthu',
  title: '社團講座',
  description: '說明',
  startsAt: '2026-05-01T02:00:00.000Z',
  appRegistrationConfigured: true,
  source: 'school-club-events',
};

const infoEvent: CampusEvent = {
  ...clubEvent,
  title: '校園資訊場',
  source: 'school-events',
  appRegistrationConfigured: false,
};

function openState(overrides: Partial<EventRegistrationState> = {}): EventRegistrationState {
  return {
    eventId: 'evt-1',
    policyConfirmed: true,
    status: 'not_registered',
    availability: 'open',
    count: 1,
    capacity: 10,
    canRegister: true,
    canCancel: false,
    opensAt: '2026-01-01T00:00:00.000Z',
    closesAt: '2026-12-31T00:00:00.000Z',
    cancellationClosesAt: null,
    ...overrides,
  };
}

function registeredState(): EventRegistrationState {
  return openState({
    status: 'registered',
    canRegister: false,
    canCancel: true,
    count: 2,
    cancellationClosesAt: '2026-12-30T00:00:00.000Z',
  });
}

function intent(
  action: 'register' | 'cancel',
  requestId = 'requestid00000001',
): CampusEventRegistrationIntent {
  return {
    version: 1,
    uid: 'alice',
    schoolId: 'nthu',
    eventId: 'evt-1',
    action,
    requestId,
    createdAt: '2026-04-01T00:00:00.000Z',
  };
}

function mockReadyMembership(schoolId = 'nthu') {
  membership.watch.mockImplementation((_uid, receive) => {
    receive({ uid: 'alice', schoolId });
    return () => {};
  });
}

beforeEach(() => {
  auth.user = null;
  auth.loading = false;
  options.google = true;
  options.studentId = false;
  options.loading = false;
  options.error = false;
  options.retry.mockReset();
  membership.watch.mockReset();
  Object.values(registration).forEach((fn) => fn.mockReset());
  registration.readPendingCampusEventIntent.mockResolvedValue(null);
  registration.loadEventRegistrationStates.mockResolvedValue([openState()]);
  Object.defineProperty(HTMLDialogElement.prototype, 'showModal', {
    configurable: true,
    value: function (this: HTMLDialogElement) {
      this.setAttribute('open', '');
    },
  });
  Object.defineProperty(HTMLDialogElement.prototype, 'close', {
    configurable: true,
    value: function (this: HTMLDialogElement) {
      this.removeAttribute('open');
    },
  });
});

afterEach(() => {
  for (const [name, descriptor] of dialogDescriptors) {
    if (descriptor) Object.defineProperty(HTMLDialogElement.prototype, name, descriptor);
    else Reflect.deleteProperty(HTMLDialogElement.prototype, name);
  }
});

it('keeps noncanonical sources informational only and never calls registration APIs', async () => {
  auth.user = { uid: 'alice' };
  mockReadyMembership();
  render(
    <EventRegistrationPanel
      event={infoEvent}
      returnPath="/events/evt-1?schoolId=nthu&source=school-events"
    />,
  );
  expect(await screen.findByRole('heading', { name: '僅供瀏覽' })).toBeTruthy();
  expect(screen.getByText(/目前只提供活動資訊。報名方式請查看主辦單位公告/)).toBeTruthy();
  expect(registration.loadEventRegistrationStates).not.toHaveBeenCalled();
  expect(registration.prepareCampusEventIntent).not.toHaveBeenCalled();
});

it('keeps informational content usable when the school auth watcher throws', async () => {
  auth.user = { uid: 'alice' };
  membership.watch.mockImplementation(() => {
    throw new Error('watcher boom');
  });
  render(
    <EventRegistrationPanel
      event={infoEvent}
      returnPath="/events/evt-1?schoolId=nthu&source=school-events"
    />,
  );
  expect(await screen.findByRole('heading', { name: '僅供瀏覽' })).toBeTruthy();
  expect(registration.loadEventRegistrationStates).not.toHaveBeenCalled();
});

it('tells Google-only guests honestly and preserves return target without claiming login equals registration', async () => {
  render(
    <EventRegistrationPanel
      event={clubEvent}
      returnPath="/events/evt-1?schoolId=nthu&source=school-club-events"
    />,
  );
  expect(
    await screen.findByRole('heading', { name: '報名需要學校帳號' }),
  ).toBeTruthy();
  expect(screen.getByText(/Google 平台登入，學校登入尚未開放/)).toBeTruthy();
  expect(screen.queryByText(/登入即可報名/)).toBeNull();
  expect(screen.queryByText(/工作階段/)).toBeNull();
  const link = screen.getByRole('link', { name: '查看學校登入說明' });
  expect(link.getAttribute('href')).toContain('reconnect=school');
  expect(decodeURIComponent(link.getAttribute('href')!.split('returnUrl=')[1]!)).toBe(
    '/events/evt-1?schoolId=nthu&source=school-club-events',
  );
});

it('does not promise Providence school form covers a different selected school', async () => {
  options.studentId = true;
  render(
    <EventRegistrationPanel
      event={clubEvent}
      returnPath="/events/evt-1?schoolId=nthu&source=school-club-events"
    />,
  );
  expect(
    await screen.findByRole('heading', { name: '這所學校尚未開放登入' }),
  ).toBeTruthy();
  expect(screen.getByText(/只支援靜宜大學/)).toBeTruthy();
  expect(
    screen.getByRole('link', { name: '查看學校登入說明' }).getAttribute('href'),
  ).toContain('returnUrl=');
});

it('surfaces sign-in capability errors with retry while preserving return path', async () => {
  options.error = true;
  render(
    <EventRegistrationPanel
      event={clubEvent}
      returnPath="/events/evt-1?schoolId=nthu&source=school-club-events"
    />,
  );
  expect(await screen.findByRole('heading', { name: '暫時無法確認學校登入方式' })).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: '重新確認' }));
  expect(options.retry).toHaveBeenCalled();
  expect(
    screen.getByRole('link', { name: '查看學校登入說明' }).getAttribute('href'),
  ).toContain('returnUrl=');
});

it('blocks mutation for wrong-school membership and still allows reading the public detail panel path', async () => {
  auth.user = { uid: 'alice' };
  mockReadyMembership('pu');
  render(
    <EventRegistrationPanel
      event={clubEvent}
      returnPath="/events/evt-1?schoolId=nthu&source=school-club-events"
    />,
  );
  expect(await screen.findByRole('heading', { name: '瀏覽學校與帳號學校不一致' })).toBeTruthy();
  expect(screen.queryByText(/\bpu\b/)).toBeNull();
  expect(registration.loadEventRegistrationStates).not.toHaveBeenCalled();
  expect(registration.prepareCampusEventIntent).not.toHaveBeenCalled();
});

it('blocks revoked membership and stale cache before actions', async () => {
  auth.user = { uid: 'alice' };
  membership.watch.mockImplementation((_uid, _receive, fail) => {
    fail('permission');
    return () => {};
  });
  const view = render(
    <EventRegistrationPanel
      event={clubEvent}
      returnPath="/events/evt-1?schoolId=nthu&source=school-club-events"
    />,
  );
  expect(
    await screen.findByRole('heading', { name: '目前帳號無法報名這所學校的活動' }),
  ).toBeTruthy();

  membership.watch.mockImplementation((_uid, _receive, fail) => {
    fail('stale');
    return () => {};
  });
  view.unmount();
  render(
    <EventRegistrationPanel
      event={{ ...clubEvent, id: 'evt-2' }}
      returnPath="/events/evt-2?schoolId=nthu&source=school-club-events"
    />,
  );
  expect(await screen.findByRole('heading', { name: '學校資格尚未確認' })).toBeTruthy();
});

it('guest and ready hook renders settle without repeat reads when membership objects are fresh each time', async () => {
  render(
    <EventRegistrationPanel
      event={clubEvent}
      returnPath="/events/evt-1?schoolId=nthu&source=school-club-events"
    />,
  );
  expect(
    await screen.findByRole('heading', { name: '報名需要學校帳號' }),
  ).toBeTruthy();
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
  expect(registration.loadEventRegistrationStates).not.toHaveBeenCalled();

  auth.user = { uid: 'alice' };
  mockReadyMembership();
  const view = render(
    <EventRegistrationPanel
      event={clubEvent}
      returnPath="/events/evt-1?schoolId=nthu&source=school-club-events"
    />,
  );
  expect(await screen.findByText('本系統報名 1 / 10 人')).toBeTruthy();
  const loads = registration.loadEventRegistrationStates.mock.calls.length;
  const pendingReads = registration.readPendingCampusEventIntent.mock.calls.length;
  await act(async () => {
    view.rerender(
      <EventRegistrationPanel
        event={clubEvent}
        returnPath="/events/evt-1?schoolId=nthu&source=school-club-events"
      />,
    );
    await Promise.resolve();
    await Promise.resolve();
  });
  expect(registration.loadEventRegistrationStates.mock.calls.length).toBe(loads);
  expect(registration.readPendingCampusEventIntent.mock.calls.length).toBe(pendingReads);
});

it('lets an active selected-school Firebase member read and register', async () => {
  auth.user = { uid: 'alice' };
  mockReadyMembership();
  const prepared = intent('register');
  registration.prepareCampusEventIntent.mockResolvedValue(prepared);
  registration.submitCampusEventIntent.mockResolvedValue({
    state: registeredState(),
    reused: false,
  });
  registration.finalizeCampusEventIntent.mockResolvedValue(true);
  render(
    <EventRegistrationPanel
      event={clubEvent}
      returnPath="/events/evt-1?schoolId=nthu&source=school-club-events"
    />,
  );
  expect(await screen.findByText('本系統報名 1 / 10 人')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: '報名' }));
  await waitFor(() => expect(registration.prepareCampusEventIntent).toHaveBeenCalled());
  expect(registration.prepareCampusEventIntent.mock.calls[0]?.[0]).toEqual({
    uid: 'alice',
    schoolId: 'nthu',
  });
  expect(registration.submitCampusEventIntent).toHaveBeenCalledWith(
    { uid: 'alice', schoolId: 'nthu' },
    prepared,
    expect.any(Function),
  );
  expect(await screen.findByText('報名已確認。')).toBeTruthy();
});

it('restores durable unknown pending with identical payload and ignores ordinary status refresh clearing', async () => {
  auth.user = { uid: 'alice' };
  mockReadyMembership();
  const pending = intent('register', 'requestid00000099');
  registration.readPendingCampusEventIntent.mockResolvedValue(pending);
  registration.loadEventRegistrationStates.mockResolvedValue([registeredState()]);
  registration.submitCampusEventIntent.mockResolvedValue({
    state: openState({ status: 'cancelled', canRegister: false, availability: 'closed' }),
    reused: true,
  });
  registration.finalizeCampusEventIntent.mockResolvedValue(true);

  const view = render(
    <EventRegistrationPanel
      event={clubEvent}
      returnPath="/events/evt-1?schoolId=nthu&source=school-club-events"
    />,
  );
  expect(await screen.findByRole('button', { name: '繼續確認這次報名' })).toBeTruthy();
  expect(screen.queryByRole('button', { name: '報名' })).toBeNull();

  fireEvent.click(screen.getByRole('button', { name: '更新報名狀態' }));
  await waitFor(() =>
    expect(registration.loadEventRegistrationStates.mock.calls.length).toBeGreaterThan(1),
  );
  expect(screen.getByRole('button', { name: '繼續確認這次報名' })).toBeTruthy();
  expect(registration.prepareCampusEventIntent).not.toHaveBeenCalled();

  view.unmount();
  const restored = render(
    <EventRegistrationPanel
      event={clubEvent}
      returnPath="/events/evt-1?schoolId=nthu&source=school-club-events"
    />,
  );
  expect(await screen.findByRole('button', { name: '繼續確認這次報名' })).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: '繼續確認這次報名' }));
  await waitFor(() => expect(registration.submitCampusEventIntent).toHaveBeenCalled());
  expect(registration.submitCampusEventIntent.mock.calls[0]?.[1]).toEqual(pending);
  expect(registration.prepareCampusEventIntent).not.toHaveBeenCalled();
  expect(
    await screen.findByText('這次待確認的報名已對應到目前狀態：已取消報名。'),
  ).toBeTruthy();
  restored.unmount();
});

it('does not create a network request when storage prepare fails', async () => {
  auth.user = { uid: 'alice' };
  mockReadyMembership();
  registration.prepareCampusEventIntent.mockRejectedValue(
    new Error('這次沒有存成報名紀錄，可能是裝置空間不足或瀏覽器禁止儲存。尚未送出網路請求。'),
  );
  render(
    <EventRegistrationPanel
      event={clubEvent}
      returnPath="/events/evt-1?schoolId=nthu&source=school-club-events"
    />,
  );
  await screen.findByRole('button', { name: '報名' });
  fireEvent.click(screen.getByRole('button', { name: '報名' }));
  expect(await screen.findByRole('alert')).toBeTruthy();
  expect(registration.submitCampusEventIntent).not.toHaveBeenCalled();
});

it('disables actions while pending ledger read fails and recovers via retry', async () => {
  auth.user = { uid: 'alice' };
  mockReadyMembership();
  registration.readPendingCampusEventIntent
    .mockRejectedValueOnce(new Error('這份待確認操作暫時讀不到，原始資料仍保留。請勿清除瀏覽器資料，稍後再試。'))
    .mockResolvedValue(null);
  render(
    <EventRegistrationPanel
      event={clubEvent}
      returnPath="/events/evt-1?schoolId=nthu&source=school-club-events"
    />,
  );
  expect(await screen.findByRole('button', { name: '重新讀取報名紀錄' })).toBeTruthy();
  expect(screen.queryByRole('button', { name: '報名' })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: '重新讀取報名紀錄' }));
  expect(await screen.findByRole('button', { name: '報名' })).toBeTruthy();
});

it('requires cancel confirmation before prepare/send and invalidates stale confirmation', async () => {
  auth.user = { uid: 'alice' };
  let failMembership: ((reason: 'permission' | 'unavailable' | 'stale') => void) | null = null;
  membership.watch.mockImplementation((_uid, receive, fail) => {
    receive({ uid: 'alice', schoolId: 'nthu' });
    failMembership = fail;
    return () => {};
  });
  registration.loadEventRegistrationStates.mockResolvedValue([registeredState()]);
  registration.prepareCampusEventIntent.mockResolvedValue(intent('cancel'));
  registration.submitCampusEventIntent.mockResolvedValue({
    state: openState({ status: 'cancelled', canRegister: false, availability: 'closed' }),
    reused: false,
  });
  registration.finalizeCampusEventIntent.mockResolvedValue(true);

  render(
    <EventRegistrationPanel
      event={clubEvent}
      returnPath="/events/evt-1?schoolId=nthu&source=school-club-events"
    />,
  );
  await screen.findByRole('button', { name: '取消報名' });
  fireEvent.click(screen.getByRole('button', { name: '取消報名' }));
  expect(await screen.findByRole('heading', { name: '確認取消報名' })).toBeTruthy();
  expect(screen.getByText(/社團講座/)).toBeTruthy();
  expect(registration.prepareCampusEventIntent).not.toHaveBeenCalled();

  fireEvent.click(screen.getByRole('button', { name: '返回' }));
  expect(screen.queryByRole('heading', { name: '確認取消報名' })).toBeNull();
  expect(registration.prepareCampusEventIntent).not.toHaveBeenCalled();

  fireEvent.click(screen.getByRole('button', { name: '取消報名' }));
  await screen.findByRole('heading', { name: '確認取消報名' });

  await act(async () => {
    failMembership?.('permission');
  });
  await waitFor(() =>
    expect(screen.queryByRole('heading', { name: '確認取消報名' })).toBeNull(),
  );
  expect(registration.prepareCampusEventIntent).not.toHaveBeenCalled();
});

it('confirms cancel only after dialog confirm and drops stale finally enablement across scope change', async () => {
  auth.user = { uid: 'alice' };
  let failMembership: ((reason: 'permission' | 'unavailable' | 'stale') => void) | null = null;
  membership.watch.mockImplementation((_uid, receive, fail) => {
    receive({ uid: 'alice', schoolId: 'nthu' });
    failMembership = fail;
    return () => {};
  });
  registration.loadEventRegistrationStates.mockResolvedValue([registeredState()]);
  let releasePrepare: (value: CampusEventRegistrationIntent) => void = () => {};
  registration.prepareCampusEventIntent.mockImplementation(
    () =>
      new Promise<CampusEventRegistrationIntent>((resolve) => {
        releasePrepare = resolve;
      }),
  );

  render(
    <EventRegistrationPanel
      event={clubEvent}
      returnPath="/events/evt-1?schoolId=nthu&source=school-club-events"
    />,
  );
  await screen.findByRole('button', { name: '取消報名' });
  fireEvent.click(screen.getByRole('button', { name: '取消報名' }));
  fireEvent.click(await screen.findByRole('button', { name: '確認取消報名' }));
  expect(registration.prepareCampusEventIntent).toHaveBeenCalled();

  await act(async () => {
    failMembership?.('permission');
  });
  expect(
    await screen.findByRole('heading', { name: '目前帳號無法報名這所學校的活動' }),
  ).toBeTruthy();

  await act(async () => {
    releasePrepare(intent('cancel'));
  });
  expect(registration.submitCampusEventIntent).not.toHaveBeenCalled();
});

it('invalidates authorization synchronously on permission fail before a deferred prepare resolves', async () => {
  auth.user = { uid: 'alice' };
  let failMembership: ((reason: 'permission' | 'unavailable' | 'stale') => void) | null = null;
  membership.watch.mockImplementation((_uid, receive, fail) => {
    receive({ uid: 'alice', schoolId: 'nthu' });
    failMembership = fail;
    return () => {};
  });
  let releasePrepare: (value: CampusEventRegistrationIntent) => void = () => {};
  let sawGuardDuringPrepare = true;
  registration.prepareCampusEventIntent.mockImplementation((_scope, _input, current) => {
    return new Promise<CampusEventRegistrationIntent>((resolve) => {
      releasePrepare = (value) => {
        sawGuardDuringPrepare = current();
        resolve(value);
      };
    });
  });

  render(
    <EventRegistrationPanel
      event={clubEvent}
      returnPath="/events/evt-1?schoolId=nthu&source=school-club-events"
    />,
  );
  await screen.findByRole('button', { name: '報名' });
  fireEvent.click(screen.getByRole('button', { name: '報名' }));
  await waitFor(() => expect(registration.prepareCampusEventIntent).toHaveBeenCalled());

  await act(async () => {
    failMembership?.('permission');
  });
  expect(
    await screen.findByRole('heading', { name: '目前帳號無法報名這所學校的活動' }),
  ).toBeTruthy();

  await act(async () => {
    releasePrepare(intent('register'));
  });
  expect(sawGuardDuringPrepare).toBe(false);
  expect(registration.submitCampusEventIntent).not.toHaveBeenCalled();
});

it('owner uid switch clears prior registration UI before passive reset completes', async () => {
  auth.user = { uid: 'alice' };
  let bobReceive: ((session: { uid: string; schoolId: string }) => void) | null = null;
  membership.watch.mockImplementation((uid, receive) => {
    if (uid === 'bob') {
      bobReceive = receive;
      return () => {};
    }
    receive({ uid, schoolId: 'nthu' });
    return () => {};
  });
  registration.loadEventRegistrationStates.mockResolvedValue([registeredState()]);
  const view = render(
    <EventRegistrationPanel
      event={clubEvent}
      returnPath="/events/evt-1?schoolId=nthu&source=school-club-events"
    />,
  );
  expect(await screen.findByText('本系統報名 2 / 10 人')).toBeTruthy();
  expect(screen.getByRole('button', { name: '取消報名' })).toBeTruthy();

  await act(async () => {
    auth.user = { uid: 'bob' };
    view.rerender(
      <EventRegistrationPanel
        event={clubEvent}
        returnPath="/events/evt-1?schoolId=nthu&source=school-club-events"
      />,
    );
  });
  // Before bob's watcher resolves, alice's registration actions must already be gone.
  await waitFor(() => {
    expect(screen.queryByRole('button', { name: '取消報名' })).toBeNull();
    expect(screen.queryByText('本系統報名 2 / 10 人')).toBeNull();
  });
  expect(screen.getByText(/正在確認學校帳號資格/)).toBeTruthy();
  expect(bobReceive).toBeTruthy();
});

it('does not apply an old register reply when finalize is false after a newer cancel pending', async () => {
  auth.user = { uid: 'alice' };
  mockReadyMembership();
  const registerIntent = intent('register', 'requestid00000001');
  const cancelPending = intent('cancel', 'requestid00000077');
  registration.readPendingCampusEventIntent
    .mockResolvedValueOnce(null)
    .mockResolvedValue(cancelPending);
  registration.prepareCampusEventIntent.mockResolvedValue(registerIntent);
  registration.submitCampusEventIntent.mockResolvedValue({
    state: registeredState(),
    reused: false,
  });
  registration.finalizeCampusEventIntent.mockResolvedValue(false);
  registration.loadEventRegistrationStates
    .mockResolvedValueOnce([openState()])
    .mockResolvedValue([
      openState({ status: 'cancelled', canRegister: false, canCancel: false, availability: 'closed' }),
    ]);

  render(
    <EventRegistrationPanel
      event={clubEvent}
      returnPath="/events/evt-1?schoolId=nthu&source=school-club-events"
    />,
  );
  await screen.findByRole('button', { name: '報名' });
  fireEvent.click(screen.getByRole('button', { name: '報名' }));

  expect(await screen.findByRole('button', { name: '繼續確認這次取消' })).toBeTruthy();
  expect(screen.queryByText('報名已確認。')).toBeNull();
  expect(screen.queryByText(/已報名/)).toBeNull();
  expect(await screen.findByText(/已取消報名|報名已截止|未開放/)).toBeTruthy();
});

it('ignores storage events for other school ledgers and does not clobber submitting UI', async () => {
  auth.user = { uid: 'alice' };
  mockReadyMembership();
  const prepared = intent('register');
  let releaseSubmit: (value: {
    state: EventRegistrationState;
    reused: boolean;
  }) => void = () => {};
  registration.prepareCampusEventIntent.mockResolvedValue(prepared);
  registration.submitCampusEventIntent.mockImplementation(
    () =>
      new Promise((resolve) => {
        releaseSubmit = resolve;
      }),
  );
  registration.finalizeCampusEventIntent.mockResolvedValue(true);

  render(
    <EventRegistrationPanel
      event={clubEvent}
      returnPath="/events/evt-1?schoolId=nthu&source=school-club-events"
    />,
  );
  await screen.findByRole('button', { name: '報名' });
  fireEvent.click(screen.getByRole('button', { name: '報名' }));
  await waitFor(() => expect(registration.submitCampusEventIntent).toHaveBeenCalled());
  expect(screen.getByText(/正在確認這次操作/)).toBeTruthy();

  const foreignKey = campusEventIntentsStorageKey({ uid: 'alice', schoolId: 'pu' });
  await act(async () => {
    window.dispatchEvent(
      new StorageEvent('storage', {
        key: foreignKey,
        newValue: '{}',
      }),
    );
  });
  expect(screen.getByText(/正在確認這次操作/)).toBeTruthy();

  registration.readPendingCampusEventIntent.mockResolvedValue(intent('cancel', 'requestid00000088'));
  const ownKey = campusEventIntentsStorageKey({ uid: 'alice', schoolId: 'nthu' });
  await act(async () => {
    window.dispatchEvent(
      new StorageEvent('storage', {
        key: ownKey,
        newValue: '{}',
      }),
    );
  });
  // Still submitting — do not replace with the other-tab cancel snapshot mid-flight.
  expect(screen.getByText(/正在確認這次操作/)).toBeTruthy();

  await act(async () => {
    releaseSubmit({ state: registeredState(), reused: false });
  });
});

it('re-authorization at the same uid cannot revive an old captured guard', async () => {
  auth.user = { uid: 'alice' };
  let failMembership: ((reason: 'permission' | 'unavailable' | 'stale') => void) | null = null;
  let receiveMembership: ((session: { uid: string; schoolId: string }) => void) | null = null;
  membership.watch.mockImplementation((_uid, receive, fail) => {
    receiveMembership = receive;
    failMembership = fail;
    receive({ uid: 'alice', schoolId: 'nthu' });
    return () => {};
  });

  const guards: Array<() => boolean> = [];
  registration.loadEventRegistrationStates.mockImplementation(async (_scope, _ids, current) => {
    guards.push(current);
    return [openState()];
  });

  render(
    <EventRegistrationPanel
      event={clubEvent}
      returnPath="/events/evt-1?schoolId=nthu&source=school-club-events"
    />,
  );
  await screen.findByRole('button', { name: '報名' });
  expect(guards.length).toBeGreaterThan(0);
  const oldGuard = guards[0]!;

  await act(async () => {
    failMembership?.('permission');
  });
  expect(
    await screen.findByRole('heading', { name: '目前帳號無法報名這所學校的活動' }),
  ).toBeTruthy();
  expect(oldGuard()).toBe(false);

  await act(async () => {
    receiveMembership?.({ uid: 'alice', schoolId: 'nthu' });
  });
  // Re-ready at same uid uses a newer epoch; the old callback stays false.
  await waitFor(() => expect(oldGuard()).toBe(false));
});

it('keeps a captured guard revoked when membership recovers before React commits', async () => {
  auth.user = { uid: 'alice' };
  let fail: (reason: 'permission') => void = () => {};
  let receive: (session: { uid: string; schoolId: string }) => void = () => {};
  membership.watch.mockImplementation((_uid, next, rejected) => {
    receive = next;
    fail = rejected;
    next({ uid: 'alice', schoolId: 'nthu' });
    return () => {};
  });
  const guards: Array<() => boolean> = [];
  registration.loadEventRegistrationStates.mockImplementation(async (_scope, _ids, current) => {
    guards.push(current);
    return [openState()];
  });
  render(
    <EventRegistrationPanel
      event={clubEvent}
      returnPath="/events/evt-1?schoolId=nthu&source=school-club-events"
    />,
  );
  await screen.findByRole('button', { name: '報名' });
  const guard = guards[0]!;
  expect(guard()).toBe(true);
  let afterRevoke = true;
  let afterRecovery = true;
  await act(async () => {
    fail('permission');
    afterRevoke = guard();
    receive({ uid: 'alice', schoolId: 'nthu' });
    afterRecovery = guard();
  });
  expect({ afterRevoke, afterRecovery }).toEqual({ afterRevoke: false, afterRecovery: false });
});

it('does not submit a queued registration after membership is revoked and immediately restored', async () => {
  auth.user = { uid: 'alice' };
  let fail: (reason: 'permission') => void = () => {};
  let receive: (session: { uid: string; schoolId: string }) => void = () => {};
  membership.watch.mockImplementation((_uid, next, rejected) => {
    receive = next;
    fail = rejected;
    next({ uid: 'alice', schoolId: 'nthu' });
    return () => {};
  });
  let release: (value: CampusEventRegistrationIntent) => void = () => {};
  registration.prepareCampusEventIntent.mockImplementation(
    () => new Promise<CampusEventRegistrationIntent>((resolve) => { release = resolve; }),
  );
  registration.submitCampusEventIntent.mockResolvedValue({ state: registeredState(), reused: false });
  registration.finalizeCampusEventIntent.mockResolvedValue(true);
  render(
    <EventRegistrationPanel
      event={clubEvent}
      returnPath="/events/evt-1?schoolId=nthu&source=school-club-events"
    />,
  );
  await screen.findByRole('button', { name: '報名' });
  fireEvent.click(screen.getByRole('button', { name: '報名' }));
  await waitFor(() => expect(registration.prepareCampusEventIntent).toHaveBeenCalled());
  await act(async () => {
    fail('permission');
    receive({ uid: 'alice', schoolId: 'nthu' });
    release(intent('register'));
    await Promise.resolve();
    await Promise.resolve();
  });
  expect(registration.submitCampusEventIntent).not.toHaveBeenCalled();
});
