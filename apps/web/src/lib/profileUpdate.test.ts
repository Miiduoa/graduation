import { beforeEach, expect, it, vi } from 'vitest';
const state = vi.hoisted(() => {
  process.env.NEXT_PUBLIC_FIREBASE_API_KEY = 'profile-test-key';
  process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN = 'profile-test.firebaseapp.com';
  process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID = 'profile-test';
  return {
    auth: { currentUser: { uid: 'a' } as { uid: string } | null },
    write: vi.fn(),
    writeAuth: vi.fn(),
  };
});
vi.mock('firebase/app', async (original) => ({
  ...(await original<typeof import('firebase/app')>()),
  initializeApp: () => ({}),
  getApps: () => [{}],
}));
vi.mock('firebase/auth', async (original) => ({
  ...(await original<typeof import('firebase/auth')>()),
  getAuth: () => state.auth,
  updateProfile: state.writeAuth,
}));
vi.mock('firebase/firestore', async (original) => ({
  ...(await original<typeof import('firebase/firestore')>()),
  getFirestore: () => ({}),
  doc: (_: unknown, ...path: string[]) => path.join('/'),
  updateDoc: state.write,
}));
import { updateUserProfile } from './firebase';
beforeEach(() => {
  vi.clearAllMocks();
  state.auth.currentUser = { uid: 'a' };
  state.write.mockResolvedValue(undefined);
  state.writeAuth.mockResolvedValue(undefined);
});
it('rejects a request for a different current owner before writing', async () => {
  expect((await updateUserProfile('b', { displayName: 'Other' })).success).toBe(false);
  expect(state.write).not.toHaveBeenCalled();
  expect(state.writeAuth).not.toHaveBeenCalled();
});
it('does not apply the previous account name to the next Firebase user', async () => {
  let finish!: () => void;
  state.write.mockImplementation(
    () =>
      new Promise<void>((resolve) => {
        finish = resolve;
      }),
  );
  const pending = updateUserProfile('a', { displayName: 'A name' });
  state.auth.currentUser = { uid: 'b' };
  finish();
  expect((await pending).success).toBe(false);
  expect(state.writeAuth).not.toHaveBeenCalled();
});
it('uses the captured user for the auth write and suppresses success if the account changes', async () => {
  const owner = state.auth.currentUser;
  let finish!: () => void;
  state.writeAuth.mockImplementation(
    () =>
      new Promise<void>((resolve) => {
        finish = resolve;
      }),
  );
  const pending = updateUserProfile('a', { displayName: 'A name' });
  await vi.waitFor(() => expect(state.writeAuth).toHaveBeenCalled());
  state.auth.currentUser = { uid: 'b' };
  finish();
  expect((await pending).success).toBe(false);
  expect(state.writeAuth).toHaveBeenCalledWith(owner, { displayName: 'A name' });
});
it('omits undefined fields while allowing intentional empty values', async () => {
  const result = await updateUserProfile('a', { phone: '', bio: undefined });
  expect(result.success).toBe(true);
  expect(state.write.mock.calls[0][0]).toBe('users/a');
  expect(state.write.mock.calls[0][1].phone).toBe('');
  expect(Object.hasOwn(state.write.mock.calls[0][1], 'bio')).toBe(false);
});
it('does not change auth metadata when the profile write fails', async () => {
  state.write.mockRejectedValue(new Error('permission denied'));
  expect((await updateUserProfile('a', { displayName: 'Changed' })).success).toBe(false);
  expect(state.writeAuth).not.toHaveBeenCalled();
});
