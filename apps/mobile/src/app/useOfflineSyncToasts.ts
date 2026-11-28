import { useEffect } from 'react';
import { subscribeToSyncEvents } from '../services/offline';
import { useToast } from '../ui/Toast';

export function useOfflineSyncToasts() {
  const toast = useToast();
  useEffect(() => {
    return subscribeToSyncEvents((event) => {
      switch (event.type) {
        case 'queued':
          toast.show({
            message: '變更已儲存在此裝置，等待同步',
            type: 'info',
            duration: 3000,
          });
          break;
        case 'sync_complete':
          if (event.success && event.success > 0) {
            toast.show({
              message: `已同步 ${event.success} 筆資料`,
              type: 'success',
              duration: 2000,
            });
          }
          break;
        case 'sync_error':
          toast.show({
            message: `同步失敗：${event.error?.message ?? '未知錯誤'}`,
            type: 'error',
            duration: 4000,
          });
          break;
        case 'conflict':
          toast.show({
            message: '部分資料與伺服器衝突，請檢查',
            type: 'warning',
            duration: 4000,
          });
          break;
      }
    });
  }, [toast]);
}
