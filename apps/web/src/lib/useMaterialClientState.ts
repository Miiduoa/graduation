'use client';

import { useEffect, useState, useSyncExternalStore } from 'react';
import {
  MATERIAL_READ_KEY_PREFIX,
  listReadMaterialIds,
  subscribeMaterialReads,
} from './courseMaterials';

const emptyReads = new Set<string>();
const snapshots = new Map<string, { raw: string | null; ids: Set<string> }>();

function browserStorage(): Pick<Storage, 'getItem'> | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

function readSnapshot(accountId: string): Set<string> {
  const storage = browserStorage();
  if (!accountId || !storage) return emptyReads;
  let raw: string | null = null;
  try {
    raw = storage.getItem(`${MATERIAL_READ_KEY_PREFIX}${accountId}`);
  } catch {
    return emptyReads;
  }
  const cached = snapshots.get(accountId);
  if (cached && cached.raw === raw) return cached.ids;
  const ids = listReadMaterialIds(accountId, storage);
  snapshots.set(accountId, { raw, ids });
  return ids;
}

export function useMaterialReadIds(accountId: string): Set<string> | null {
  return useSyncExternalStore(
    subscribeMaterialReads,
    () => (accountId ? readSnapshot(accountId) : emptyReads),
    () => null,
  );
}

export function useClientNow(intervalMs = 60_000): number | null {
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    const tick = () => setNow(Date.now());
    tick();
    const timer = setInterval(tick, intervalMs);
    return () => clearInterval(timer);
  }, [intervalMs]);
  return now;
}

export function materialBrowserStorage(): Pick<Storage, 'getItem' | 'setItem'> | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}
