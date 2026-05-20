/**
 * useMerchantContext — 解析當下使用者該管理哪個店家
 *
 * 邏輯：
 *  1. 從 auth.profile.merchantAssignments 拿 active assignments
 *  2. demo 帳號（uid 開頭 demo_cafeteria）→ 自動帶 1 個 assignment 給「中餐部」
 *  3. 多個 assignment → 預設第一個 active，UI 提供切換器
 *  4. 沒 assignment → 不該進 vendor cockpit（外層 dispatcher 已擋）
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useMemo, useEffect, useState, useCallback } from 'react';

import { useAuth } from '../state/auth';
import {
  DEMO_MERCHANTS,
  MERCHANT_ROLES,
  getDemoMerchantAssignmentsForUid,
  type DemoMerchant,
  type MerchantRole,
} from '../data/demoMerchants';
import { getScopedStorageKey } from '../services/scopedStorage';

const ACTIVE_MERCHANT_STORAGE_BASE = 'merchant_active_v1';

export interface ResolvedMerchant {
  merchant: DemoMerchant;
  role: MerchantRole;
  /** 是這個員工的多家中的哪一家 */
  index: number;
  totalAssignments: number;
}

export interface MerchantContext {
  loading: boolean;
  current: ResolvedMerchant | null;
  available: ResolvedMerchant[];
  switchTo: (merchantId: string) => Promise<void>;
}

export function useMerchantContext(): MerchantContext {
  const auth = useAuth();
  const uid = auth.user?.uid ?? null;
  const [activeId, setActiveId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const storageKey = useMemo(
    () => uid ? getScopedStorageKey(ACTIVE_MERCHANT_STORAGE_BASE, { uid, schoolId: null }) : null,
    [uid],
  );

  // 解析 assignments（從 auth.profile + demo fallback）
  const available = useMemo<ResolvedMerchant[]>(() => {
    const fromProfile = (auth.profile?.merchantAssignments ?? [])
      .filter((a) => a.status === 'active');

    // 把 profile assignments map 到 demo merchants
    let assignments: Array<{ merchantId: string; role: 'owner' | 'manager' | 'staff' }> =
      fromProfile.map((a) => ({
        merchantId: (a as any).merchantId ?? '',
        role: ((a as any).role ?? 'staff') as 'owner' | 'manager' | 'staff',
      })).filter((a) => a.merchantId);

    // demo fallback
    if (assignments.length === 0 && uid) {
      assignments = getDemoMerchantAssignmentsForUid(uid);
    }

    return assignments
      .map((a, i): ResolvedMerchant | null => {
        const merchant = DEMO_MERCHANTS.find((m) => m.id === a.merchantId);
        if (!merchant) return null;
        return {
          merchant,
          role: MERCHANT_ROLES[a.role],
          index: i,
          totalAssignments: assignments.length,
        };
      })
      .filter((x): x is ResolvedMerchant => x !== null);
  }, [auth.profile?.merchantAssignments, uid]);

  // 從 storage 讀上次選的 merchant
  useEffect(() => {
    if (!storageKey || available.length === 0) {
      setLoading(false);
      return;
    }
    let mounted = true;
    AsyncStorage.getItem(storageKey).then((raw) => {
      if (!mounted) return;
      const saved = raw && available.find((a) => a.merchant.id === raw);
      setActiveId(saved ? raw : available[0].merchant.id);
      setLoading(false);
    });
    return () => { mounted = false; };
  }, [storageKey, available]);

  const switchTo = useCallback(
    async (merchantId: string) => {
      setActiveId(merchantId);
      if (storageKey) {
        try {
          await AsyncStorage.setItem(storageKey, merchantId);
        } catch { /* swallow */ }
      }
    },
    [storageKey],
  );

  const current = useMemo<ResolvedMerchant | null>(() => {
    if (!activeId) return available[0] ?? null;
    return available.find((a) => a.merchant.id === activeId) ?? available[0] ?? null;
  }, [activeId, available]);

  return { loading, current, available, switchTo };
}
