'use client';

import { useId } from 'react';
import type { AcademicAutomaticStatus } from '@/lib/academicRefreshController';
import styles from './AcademicRefreshControls.module.css';

const COPY: Record<AcademicAutomaticStatus, string> = {
  off: '自動更新已關閉，仍可手動更新資料。',
  waiting: '此頁開啟且有網路時，每 5 分鐘重新讀取學校資料。',
  updating: '正在向學校讀取新資料，讀取完成前仍標示上次的來源時間。',
  offline: '目前離線，自動更新已暫停；網路恢復後再檢查。',
  hidden: '分頁未顯示時暫停更新，回到此頁後再檢查。',
  blocked: '校務連線或權限需要處理，自動更新已停止。請依下方提示重新連線。',
  retrying: '這次未取得新的學校資料，將延後重試；不會將失敗當成同步完成。',
};

export function AcademicRefreshControls({
  enabled,
  status,
  onChange,
}: {
  enabled: boolean;
  status: AcademicAutomaticStatus;
  onChange: (value: boolean) => void;
}) {
  const description = useId();
  return (
    <section className={styles.root} aria-label="學校資料更新設定">
      <label className={styles.toggle}>
        <input
          type="checkbox"
          checked={enabled}
          onChange={(event) => onChange(event.target.checked)}
          aria-describedby={description}
        />
        此頁自動更新學校資料
      </label>
      <p id={description} role="status" aria-live="polite">{COPY[status]}</p>
      <p className={styles.note}>
        只更新此頁顯示，不會修改學校紀錄或覆蓋自行匯入資料。離開此頁後不再排程更新，切換帳號後需重新開啟。
      </p>
    </section>
  );
}
