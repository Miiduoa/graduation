import { beforeEach, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => {
  process.env.NEXT_PUBLIC_FIREBASE_API_KEY = 'library-test-key';
  process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN = 'library-test.firebaseapp.com';
  process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID = 'library-test';
  return {
    functionsConfigured: true,
    callable: vi.fn(),
  };
});

vi.mock('firebase/app', async (original) => ({
  ...(await original<typeof import('firebase/app')>()),
  initializeApp: () => ({}),
  getApps: () => [{}],
}));
vi.mock('firebase/functions', async (original) => ({
  ...(await original<typeof import('firebase/functions')>()),
  httpsCallable: () => state.callable,
  getFunctions: () => ({}),
  connectFunctionsEmulator: () => undefined,
}));
vi.mock('./functionsUrl', async (original) => ({
  ...(await original<typeof import('./functionsUrl')>()),
  areFunctionsConfigured: () => state.functionsConfigured,
}));

import { borrowLibraryBook, returnLibraryBook } from './firebase';

beforeEach(() => {
  vi.clearAllMocks();
  state.functionsConfigured = true;
  state.callable.mockReset();
  state.callable.mockResolvedValue({ data: { success: true, loanId: 'loan-1' } });
});

it('does not call Cloud Functions for library loans when the functions base URL is unset', async () => {
  state.functionsConfigured = false;
  await expect(borrowLibraryBook({ schoolId: 'pu', bookId: 'book-1' })).rejects.toMatchObject({
    code: 'functions-unconfigured',
    message: '圖書館借還尚未啟用',
  });
  await expect(returnLibraryBook({ schoolId: 'pu', loanId: 'loan-1' })).rejects.toMatchObject({
    code: 'functions-unconfigured',
    message: '圖書館借還尚未啟用',
  });
  expect(state.callable).not.toHaveBeenCalled();
});

it('calls Cloud Functions for library loans when the functions base URL is set', async () => {
  await expect(borrowLibraryBook({ schoolId: 'pu', bookId: 'book-1' })).resolves.toEqual({
    success: true,
    loanId: 'loan-1',
  });
  expect(state.callable).toHaveBeenCalledWith({ schoolId: 'pu', bookId: 'book-1' });
  state.callable.mockResolvedValueOnce({ data: { success: true } });
  await expect(returnLibraryBook({ schoolId: 'pu', loanId: 'loan-1' })).resolves.toEqual({
    success: true,
  });
  expect(state.callable).toHaveBeenCalledWith({ schoolId: 'pu', loanId: 'loan-1' });
});
