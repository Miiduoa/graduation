import type { AttendanceLiveState } from '@/lib/watchAttendanceLive';
import styles from './attendance-sync-status.module.css';

const labels: Record<AttendanceLiveState, string> = {
  connecting: '正在核對課堂最新狀態',
  live: '課堂狀態已連線',
  paused: '已暫停背景同步',
  offline: '目前離線，尚未確認出席狀態',
  error: '課堂同步暫時中斷',
};
export function AttendanceSyncStatus({ state, teacher }: { state: AttendanceLiveState; teacher: boolean }) {
  const description = state === 'live'
    ? teacher ? '點名場次與人數自動更新；詳細名冊仍以各次查核時間為準。'
      : '老師開啟、結束點名，或更正你的出席狀態時，這裡會自動更新。'
    : state === 'paused' ? '回到這個頁面後會重新核對。相機不會自動重開。'
      : state === 'offline' ? '連線恢復後會重新核對；不會把離線操作當成簽到成功。'
        : state === 'error' ? '暫停簽到與更正操作，請按「更新紀錄」重試。'
          : '收到伺服器確認前，不顯示舊的簽到入口或名單。';
  return <div className={styles.notice} data-state={state} role="status" aria-live="polite">
    <span className={styles.dot} aria-hidden="true" />
    <div><strong>{labels[state]}</strong><p>{description}</p></div>
  </div>;
}
