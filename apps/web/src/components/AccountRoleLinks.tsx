import Link from 'next/link';
import styles from './AccountRoleLinks.module.css';

export function AccountRoleLinks({ showSchool = false }: { showSchool?: boolean }) {
  return (
    <nav aria-label="身分與工作入口" className={styles.roles}>
      <h2>你要使用哪項服務？</h2>
      <ul>
        <li>
          <Link href="/merchant/apply">第一次申請店家進駐</Link>
          <p>用 Google 帳號填寫店家資料，送交審核。</p>
        </li>
        <li>
          <Link href="/merchant/workspace">查看申請或進入門市</Link>
          <p>用原申請人的帳號查進度。已開通的門市可從這裡管理。</p>
        </li>
        <li>
          <Link href="/classroom">學生與教師進入課程</Link>
          <p>用 Google 帳號加入課班或開啟獲授權的授課課程。</p>
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
  );
}
