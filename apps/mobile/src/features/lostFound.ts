import { useCallback, useRef, useState } from 'react';
import { useFocusEffect } from '@react-navigation/native';
import { getDataSource, getDataSourceEvidence, hasDataSource } from '../data/source';
import { useAuth } from '../state/auth';
import { useSchool } from '../state/school';
import type { LostFoundCategory, LostFoundItem } from '../data/types';

export const LOST_FOUND_CATEGORIES: { id: LostFoundCategory; label: string }[] = [
  { id: 'electronics', label: '電子產品' },
  { id: 'cards', label: '證件／卡片' },
  { id: 'documents', label: '文件' },
  { id: 'wallet', label: '錢包' },
  { id: 'clothing', label: '衣物' },
  { id: 'accessories', label: '配件' },
  { id: 'books', label: '書籍' },
  { id: 'keys', label: '鑰匙' },
  { id: 'other', label: '其他' },
];
export const categoryLabel = (category: string) =>
  LOST_FOUND_CATEGORIES.find((row) => row.id === category)?.label ?? '未分類';
export const isOpenItem = (item: LostFoundItem) =>
  item.status === 'open' || item.status === 'active';
export const statusLabel = (status: LostFoundItem['status']) =>
  ({
    open: '尋找中',
    active: '尋找中',
    claimed: '待交接',
    resolved: '已結案',
    returned: '已結案',
    expired: '已過期',
  })[status];

export function lostFoundDataSource() {
  const evidence = getDataSourceEvidence();
  if (!hasDataSource() || evidence?.sourceLabel !== 'real' || evidence.mode === 'mock') {
    throw new Error('失物招領服務尚未連線，請稍後再試。');
  }
  return getDataSource();
}

export function useLostFoundScope(recordId = '') {
  const { user } = useAuth();
  const { school } = useSchool();
  const uid = user?.uid;
  const schoolId = school.id;
  const scope = JSON.stringify([uid, schoolId, recordId]);
  const currentScope = useRef(scope);
  currentScope.current = scope;
  const active = useRef<string | null>(null);
  useFocusEffect(
    useCallback(() => {
      active.current = scope;
      return () => {
        active.current = null;
      };
    }, [scope]),
  );
  const isCurrent = useCallback(
    () => active.current === scope && currentScope.current === scope,
    [scope],
  );
  return { uid, schoolId, scope, isCurrent };
}

type LoadState<T> = { scope: string; status: 'loading' | 'ready' | 'error'; data?: T };
export function useLostFoundLoad<T>(
  scope: string,
  loader: () => Promise<T>,
  isCurrent: () => boolean,
) {
  const [state, setState] = useState<LoadState<T>>({ scope, status: 'loading' });
  const sequence = useRef(0);
  const refresh = useCallback(async () => {
    const request = ++sequence.current;
    setState({ scope, status: 'loading' });
    try {
      const data = await loader();
      if (isCurrent() && sequence.current === request) setState({ scope, status: 'ready', data });
    } catch {
      if (isCurrent() && sequence.current === request) setState({ scope, status: 'error' });
    }
  }, [scope, loader, isCurrent]);
  useFocusEffect(
    useCallback(() => {
      void refresh();
      return () => {
        sequence.current += 1;
      };
    }, [refresh]),
  );
  return { state: state.scope === scope ? state : { scope, status: 'loading' as const }, refresh };
}
