import Link from 'next/link';
import styles from './AccountRoleLinks.module.css';

export function AccountRoleLinks({ showSchool = false }: { showSchool?: boolean }) {
  return (
    <details className={styles.roles} aria-label="其他身分與工作入口">
      <summary className={styles.summary}>
        <span>
          <strong>其他身分與工作入口</strong>
          <span className={styles.hint}>授課、店家合作與平台管理</span>
        </span>
        <svg viewBox="0 0 24 24" width="20" height="20" fill="none" aria-hidden="true">
          <path
            d="m9 5 7 7-7 7"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </summary>
      <nav aria-label="身分與工作入口">
        <ul>
          <li>
            <Link href="/classroom">學生與教師進入課程</Link>
            <p>用 Google 帳號加入課班或開啟獲授權的授課課程。</p>
          </li>
          <li>
            <Link href="/merchant/apply">第一次申請店家進駐</Link>
            <p>用 Google 帳號填寫店家資料，送交審核。</p>
          </li>
          <li>
            <Link href="/merchant/workspace">查看申請或進入門市</Link>
            <p>用原申請人的帳號查進度。已開通的門市可從這裡管理。</p>
          </li>
          {showSchool && (
            <li>
              <Link href="/auth/account?method=school">校方人員登入</Link>
              <p>使用學校核發的帳號。承辦權限由校方指派。</p>
            </li>
          )}
          <li>
            <Link href="/admin/login">平台管理員登入</Link>
            <p>使用已取得平台管理權限的帳號。</p>
          </li>
        </ul>
      </nav>
    </details>
  );
}
