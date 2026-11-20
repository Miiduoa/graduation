import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createDefaultCampusPreferences } from '@campus/shared/src/campusPersonalization';
import type { PersonalImportScope } from './personalImports';
import { useCampusPersonalization } from './useCampusPersonalization';
import {
  campusPreferencesStorageKey,
  readCampusPreferences,
  writeCampusPreferences,
} from './campusPreferences';

const alice = { owner: 'platform:alice', schoolId: 'pu' };
const bob = { owner: 'platform:bob', schoolId: 'pu' };
const preferences = (stage: 'year-1' | 'year-4') => ({
  ...createDefaultCampusPreferences(),
  stage,
  configured: true,
});

beforeEach(() => {
  vi.restoreAllMocks();
  localStorage.clear();
});

describe('account and campus preferences', () => {
  it('isolates guest, platform, school login and other campuses without copying preferences', () => {
    writeCampusPreferences(alice, preferences('year-4'));
    for (const scope of [
      bob,
      { ...alice, schoolId: 'nthu' },
      { owner: 'school:alice', schoolId: 'pu' },
      { owner: 'guest', schoolId: 'pu' },
    ]) {
      expect(readCampusPreferences(scope)).toEqual(createDefaultCampusPreferences());
    }
    expect(readCampusPreferences(alice).stage).toBe('year-4');
    expect(campusPreferencesStorageKey({ owner: 'a:b', schoolId: 'c' })).not.toBe(
      campusPreferencesStorageKey({ owner: 'a', schoolId: 'b:c' }),
    );
  });

  it('projects only preference fields and never persists claimed permissions', () => {
    writeCampusPreferences(alice, {
      ...preferences('year-4'),
      role: 'admin',
      isPlatformOperator: true,
      accountId: 'bob',
      aiPermissions: { all: true },
    } as ReturnType<typeof createDefaultCampusPreferences>);
    const value = JSON.parse(localStorage.getItem(campusPreferencesStorageKey(alice))!);
    expect(value.stage).toBe('year-4');
    expect(value).not.toHaveProperty('role');
    expect(value).not.toHaveProperty('isPlatformOperator');
    expect(value).not.toHaveProperty('accountId');
    expect(value).not.toHaveProperty('aiPermissions');
  });

  it('preserves unreadable data and reports a recoverable read error', () => {
    const key = campusPreferencesStorageKey(alice);
    localStorage.setItem(key, '{broken');
    const { result } = renderHook(() => useCampusPersonalization(alice));
    expect(result.current.storageError).toMatch(/暫時讀不到/);
    expect(result.current.preferences).toEqual(createDefaultCampusPreferences());
    expect(localStorage.getItem(key)).toBe('{broken');
    act(() => {
      expect(result.current.save(preferences('year-1'))).toBe(true);
    });
    expect(result.current.storageError).toBe('');
    expect(readCampusPreferences(alice).stage).toBe('year-1');
  });

  it('hides the previous account in the first render and rejects its captured save callback', () => {
    writeCampusPreferences(alice, preferences('year-4'));
    writeCampusPreferences(bob, preferences('year-1'));
    const renders: Array<{ owner?: string; stage?: string }> = [];
    const { result, rerender } = renderHook(
      ({ scope }: { scope: PersonalImportScope | null }) => {
        const model = useCampusPersonalization(scope);
        renders.push({ owner: scope?.owner, stage: model.preferences?.stage });
        return model;
      },
      { initialProps: { scope: alice as PersonalImportScope | null } },
    );
    expect(result.current.preferences?.stage).toBe('year-4');
    const oldSave = result.current.save;
    const before = renders.length;
    rerender({ scope: bob });
    expect(renders[before]).toEqual({ owner: bob.owner, stage: undefined });
    expect(renders.slice(before).some((row) => row.stage === 'year-4')).toBe(false);
    expect(result.current.preferences?.stage).toBe('year-1');
    act(() => {
      expect(oldSave(preferences('year-1'))).toBe(false);
    });
    expect(readCampusPreferences(alice).stage).toBe('year-4');
    expect(readCampusPreferences(bob).stage).toBe('year-1');
  });

  it('hides all preferences while the session is unresolved and rejects writes after unmount', () => {
    writeCampusPreferences(alice, preferences('year-4'));
    const { result, rerender, unmount } = renderHook(
      ({ scope }: { scope: PersonalImportScope | null }) => useCampusPersonalization(scope),
      { initialProps: { scope: alice as PersonalImportScope | null } },
    );
    const save = result.current.save;
    rerender({ scope: null });
    expect(result.current.preferences).toBeNull();
    expect(result.current.storageError).toBe('');
    act(() => {
      expect(save(preferences('year-1'))).toBe(false);
    });
    rerender({ scope: alice });
    const after = result.current.save;
    unmount();
    expect(after(preferences('year-1'))).toBe(false);
    expect(readCampusPreferences(alice).stage).toBe('year-4');
  });

  it('loads only the new campus and does not carry a scheduled exam mode across campuses', () => {
    writeCampusPreferences(alice, {
      ...preferences('year-4'),
      phaseOverride: { kind: 'finals', startDate: '2026-11-13', endDate: '2026-11-20' },
    });
    const { result, rerender } = renderHook(({ scope }) => useCampusPersonalization(scope), {
      initialProps: { scope: alice },
    });
    expect(result.current.preferences?.phaseOverride?.kind).toBe('finals');
    rerender({ scope: { ...alice, schoolId: 'nthu' } });
    expect(result.current.preferences).toEqual(createDefaultCampusPreferences());
  });

  it('reacts to the current campus in another tab, ignores other keys, and resets after storage clear', () => {
    writeCampusPreferences(alice, preferences('year-4'));
    const { result } = renderHook(() => useCampusPersonalization(alice));
    localStorage.setItem(campusPreferencesStorageKey(alice), JSON.stringify(preferences('year-1')));
    act(() =>
      window.dispatchEvent(new StorageEvent('storage', { key: campusPreferencesStorageKey(bob) })),
    );
    expect(result.current.preferences?.stage).toBe('year-4');
    act(() =>
      window.dispatchEvent(
        new StorageEvent('storage', { key: campusPreferencesStorageKey(alice) }),
      ),
    );
    expect(result.current.preferences?.stage).toBe('year-1');
    localStorage.clear();
    act(() => window.dispatchEvent(new StorageEvent('storage', { key: null })));
    expect(result.current.preferences).toEqual(createDefaultCampusPreferences());
  });

  it('does not claim success or change stored preferences when storage is full', () => {
    writeCampusPreferences(alice, preferences('year-4'));
    const { result } = renderHook(() => useCampusPersonalization(alice));
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('Full', 'QuotaExceededError');
    });
    act(() => {
      expect(result.current.save(preferences('year-1'))).toBe(false);
    });
    expect(result.current.storageError).toMatch(/未能儲存/);
    expect(result.current.preferences?.stage).toBe('year-4');
    expect(readCampusPreferences(alice).stage).toBe('year-4');
  });
});
