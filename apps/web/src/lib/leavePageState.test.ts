import { describe, expect, it, vi } from 'vitest';
import { FunctionsUnconfiguredError } from '@/lib/functionsUrl';
import {
  LEAVE_COPY,
  LEAVE_LOAD_TIMEOUT_MS,
  LeaveLoadTimeoutError,
  initialLeavePageView,
  leaveFailureCopy,
  leavePageFailureFromError,
  leavePageSuccess,
  shouldRetryLeaveFailure,
  withLeaveLoadTimeout,
} from './leavePageState';

describe('leave page view state', () => {
  it('starts as unavailable when the backend is not configured, otherwise loading', () => {
    expect(initialLeavePageView(false)).toEqual({ status: 'unavailable' });
    expect(initialLeavePageView(true)).toEqual({ status: 'loading' });
  });

  it('keeps empty and ready mutually exclusive after a successful read', () => {
    expect(leavePageSuccess(['a'], false)).toEqual({ status: 'ready', data: ['a'] });
    expect(leavePageSuccess([], true)).toEqual({ status: 'empty', data: [] });
  });

  it('treats missing Functions, 404 and unimplemented as unavailable rather than a network error', () => {
    expect(leavePageFailureFromError(new FunctionsUnconfiguredError('請假服務尚未接通'))).toEqual({
      status: 'unavailable',
    });
    expect(leavePageFailureFromError({ code: 'functions/not-found' })).toEqual({
      status: 'unavailable',
    });
    expect(leavePageFailureFromError({ status: 404 })).toEqual({ status: 'unavailable' });
    expect(leavePageFailureFromError({ code: 'functions/unimplemented' })).toEqual({
      status: 'unavailable',
    });
    expect(leaveFailureCopy('submit', { status: 'unavailable' })).toBe(LEAVE_COPY.unavailableSubmit);
    expect(leaveFailureCopy('review', { status: 'unavailable' })).toBe(LEAVE_COPY.unavailableReview);
    expect(shouldRetryLeaveFailure({ status: 'unavailable' })).toBe(false);
  });

  it('sends 401 to login and 403 to a permission state, not a network error', () => {
    expect(leavePageFailureFromError({ code: 'functions/unauthenticated' })).toEqual({
      status: 'unauthorized',
    });
    expect(leavePageFailureFromError({ status: 401 })).toEqual({ status: 'unauthorized' });
    expect(leavePageFailureFromError({ code: 'permission-denied' })).toEqual({
      status: 'forbidden',
    });
    expect(leavePageFailureFromError({ status: 403 })).toEqual({ status: 'forbidden' });
    expect(leaveFailureCopy('submit', { status: 'unauthorized' })).toBe(LEAVE_COPY.unauthorized);
    expect(leaveFailureCopy('review', { status: 'forbidden' })).toBe(LEAVE_COPY.forbiddenReview);
    expect(leaveFailureCopy('submit', { status: 'unauthorized' })).not.toContain('網路');
    expect(leaveFailureCopy('review', { status: 'forbidden' })).not.toContain('網路');
  });

  it('blames the network only for network-layer failures and offers retry', () => {
    const failure = leavePageFailureFromError(new TypeError('Failed to fetch'));
    expect(failure).toEqual({ status: 'error', reason: 'network' });
    expect(leaveFailureCopy('submit', failure)).toBe(LEAVE_COPY.network);
    expect(shouldRetryLeaveFailure(failure)).toBe(true);
  });

  it('keeps timeout distinct from a user network problem', () => {
    const failure = leavePageFailureFromError(new LeaveLoadTimeoutError());
    expect(failure).toEqual({ status: 'error', reason: 'timeout' });
    expect(leaveFailureCopy('review', failure)).toBe(LEAVE_COPY.timeout);
    expect(leaveFailureCopy('review', failure)).not.toContain('網路');
    expect(shouldRetryLeaveFailure(failure)).toBe(true);
  });
});

describe('leave load timeout', () => {
  it('fails a stuck source after the timeout instead of waiting forever', async () => {
    vi.useFakeTimers();
    try {
      const result = withLeaveLoadTimeout(new Promise(() => {}), 50);
      const settled = expect(result).rejects.toBeInstanceOf(LeaveLoadTimeoutError);
      await vi.advanceTimersByTimeAsync(50);
      await settled;
    } finally {
      vi.useRealTimers();
    }
  });

  it('passes through a source answer that arrives before the timeout', async () => {
    await expect(withLeaveLoadTimeout(Promise.resolve(['ok']), 1000)).resolves.toEqual(['ok']);
    await expect(withLeaveLoadTimeout(Promise.reject(new Error('denied')), 1000)).rejects.toThrow(
      'denied',
    );
  });

  it('uses the shared leave load window', () => {
    expect(LEAVE_LOAD_TIMEOUT_MS).toBe(8000);
  });
});
