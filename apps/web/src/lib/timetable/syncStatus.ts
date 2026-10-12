export type TimetableSyncStatus = {
  kind: 'idle' | 'loading' | 'local' | 'syncing' | 'synced' | 'pending' | 'offline' | 'conflict' | 'error';
  savedAt?: string;
  detail?: 'local-data' | 'local-unavailable' | 'cloud-school' | 'read-failed' | 'cache-unavailable';
};

const idle: TimetableSyncStatus = Object.freeze({ kind: 'idle' });
const states = new Map<string, TimetableSyncStatus>();
const listeners = new Set<() => void>();

function scope(uid: string | null, schoolId: string): string {
  return JSON.stringify([uid, schoolId]);
}

export function getTimetableSyncStatus(uid: string | null, schoolId: string): TimetableSyncStatus {
  return states.get(scope(uid, schoolId)) || idle;
}

export function getServerTimetableSyncStatus(): TimetableSyncStatus {
  return idle;
}

export function setTimetableSyncStatus(uid: string | null, schoolId: string, state: TimetableSyncStatus): void {
  states.set(scope(uid, schoolId), state);
  listeners.forEach((listener) => listener());
}

export function subscribeTimetableSyncStatus(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

export function timetableSyncCopy(status: TimetableSyncStatus): { label: string; description: string } {
  switch (status.kind) {
    case 'loading': return { label: '正在讀取', description: '確認這個帳號與校園的課表。' };
    case 'syncing': return { label: '正在同步', description: '這一版已存到本機，正在確認雲端寫入結果。' };
    case 'synced': return {
      label: '已同步至雲端',
      description: status.detail === 'cache-unavailable'
        ? '雲端資料可用，但無法更新本機副本；離線前請先備份。'
        : '目前顯示的是已確認的雲端版本。',
    };
    case 'pending': return { label: '本機已存・尚未同步', description: '重新整理仍會保留這一版。好友看到的仍是雲端版本。' };
    case 'offline': return { label: '使用本機副本', description: '目前無法確認雲端狀態，這份副本不一定是最新版本。' };
    case 'conflict': return { label: '雲端校園尚未對應', description: '這裡只使用目前校園的本機課表，不會覆蓋另一校園或未標記校園的雲端資料。' };
    case 'error': return {
      label: '課表需要檢查',
      description: status.detail === 'local-data'
        ? '本機資料格式異常，已保留原始資料，沒有用空白課表覆蓋。'
        : status.detail === 'local-unavailable'
          ? '瀏覽器目前無法讀寫課表，請保留編輯內容並確認網站儲存權限。'
          : '無法確認課表內容，請使用下方的重新讀取按鈕；目前不會把缺少資料當成空課表。',
    };
    default: return { label: '本機課表', description: '只有儲存在這台瀏覽器的內容；清除網站資料前請先備份。' };
  }
}
