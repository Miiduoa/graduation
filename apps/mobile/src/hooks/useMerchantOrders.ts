import { useCallback, useEffect, useState } from 'react';

import type { MerchantAssignment, Order } from '../data/types';
import { listDemoMerchantOrders, subscribeDemoOrders } from '../services/demoMerchantOrders';
import { watchMerchantOrders } from '../services/merchant';

export type MerchantOrdersState = {
  orders: Order[];
  loading: boolean;
  refreshing: boolean;
  error: string | null;
  refresh: () => Promise<void>;
};

/**
 * 店家訂單即時監聽：只監聽傳進來那家店（schoolId + cafeteriaId），
 * 換店或畫面卸載就把舊的監聽關掉。新單進來不用下拉就會出現。
 */
export function useMerchantOrders(input: {
  assignment: Pick<MerchantAssignment, 'schoolId' | 'cafeteriaId' | 'merchantId'> | null;
  isDemo: boolean;
  includeClosed?: boolean;
}): MerchantOrdersState {
  const schoolId = input.assignment?.schoolId ?? null;
  const cafeteriaId = input.assignment?.cafeteriaId ?? null;
  const merchantKey = input.assignment?.merchantId ?? cafeteriaId;
  const { isDemo } = input;
  const includeClosed = input.includeClosed === true;

  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [generation, setGeneration] = useState(0);

  useEffect(() => {
    if (!schoolId || !cafeteriaId) {
      setOrders([]);
      setLoading(false);
      setError(null);
      return undefined;
    }

    setError(null);

    if (isDemo) {
      const read = () => {
        setOrders(listDemoMerchantOrders(merchantKey ?? cafeteriaId));
        setLoading(false);
      };
      read();
      return subscribeDemoOrders(read);
    }

    setLoading(true);
    const unsubscribe = watchMerchantOrders(
      { schoolId, cafeteriaId, includeClosed },
      (next) => {
        setOrders(next);
        setError(null);
        setLoading(false);
      },
      () => {
        setError('訂單讀不到，請確認網路後再下拉一次。');
        setLoading(false);
      },
    );
    return unsubscribe;
  }, [schoolId, cafeteriaId, merchantKey, isDemo, includeClosed, generation]);

  // 監聽本來就會自己更新；下拉只是在監聽斷掉（例如網路錯誤）時重新接上
  const refresh = useCallback(async () => {
    setGeneration((value) => value + 1);
  }, []);

  return { orders, loading, refreshing: false, error, refresh };
}
