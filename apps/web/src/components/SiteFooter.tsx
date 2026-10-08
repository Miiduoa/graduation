import Link from 'next/link';
import styles from '@/app/home.module.css';

export function SiteFooter() {
  return (
    <footer className={styles.footer}>
      <span>Campus One</span>
      <nav aria-label="網站資訊">
        <Link href="/terms">服務條款</Link>
        <Link href="/privacy">隱私政策</Link>
        <Link href="/settings">設定</Link>
      </nav>
    </footer>
  );
}
