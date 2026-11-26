import { safeTronClassHref } from '@/lib/tronClassIntegrationClient';
import styles from './tronclass.module.css';

export function tronClassTime(value: string | null): string {
  if (!value) return '未提供時間';
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return '未提供時間';
  return new Intl.DateTimeFormat('zh-TW', {
    timeZone: 'Asia/Taipei',
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}

export function SourceLink({ href, children }: { href: string | null; children: React.ReactNode }) {
  const safe = safeTronClassHref(href);
  return safe ? (
    <a className={styles.sourceLink} href={safe} target="_blank" rel="noopener noreferrer">
      {children}
      <span aria-hidden="true"> ↗</span>
    </a>
  ) : null;
}
