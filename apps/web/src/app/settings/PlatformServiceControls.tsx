'use client';

import Link from 'next/link';
import styles from './settings.module.css';

export function PlatformServiceControls({ onManageAssistant }: { onManageAssistant?: () => void }) {
  return (
    <section className={styles.stack} aria-label="Google 平台權限">
      <div className={styles.sectionHeading}>
        <h2>平台服務權限</h2>
        <p>公開社群與雲端 AI 助理會維持開啟，無法透過設定關閉。</p>
      </div>
      <div className={styles.group}>
        <div className={styles.row}>
          <div className={styles.rowText}>
            <h3>公開社群</h3>
            <p>維持開啟，無法關閉。登入後可依既有權限閱讀、發布與操作平台社群。</p>
          </div>
        </div>
        <div className={styles.row}>
          <div className={styles.rowText}>
            <h3>雲端 AI 助理</h3>
            <p>維持開啟，無法關閉。模型資料分享與每項寫入動作仍需另外確認。</p>
          </div>
          {onManageAssistant ? (
            <button type="button" className="btn" onClick={onManageAssistant}>設定 AI 代辦權限</button>
          ) : (
            <Link className="btn" href="/settings?section=assistant">設定 AI 代辦權限</Link>
          )}
        </div>
        <div className={styles.row}>
          <div className={styles.rowText}>
            <h3>私人訊息</h3>
            <p>目前校內私訊依學校帳號與校籍資格授權。Google 平台私訊尚未接通，兩種身分的訊息不會混用。</p>
          </div>
          <Link className="btn" href="/dms">查看校內私訊</Link>
        </div>
      </div>
      <p role="note">舊版設定與殘留的服務限制不會關閉這些功能，也不會新增學校身分或管理員權限。</p>
    </section>
  );
}
