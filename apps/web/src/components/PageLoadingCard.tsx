import styles from './PageLoadingCard.module.css';

export function PageLoadingCard({
  icon,
  message,
  compact = false,
}: {
  icon?: string;
  message: string;
  compact?: boolean;
}) {
  return (
    <div
      className={`${styles.loading} ${compact ? styles.compact : styles.card}`}
      role="status"
      aria-live="polite"
      aria-atomic="true"
    >
      {icon && (
        <span className={styles.icon} aria-hidden="true">
          {icon}
        </span>
      )}
      <p className={styles.message}>{message}</p>
      <span className={styles.track} aria-hidden="true">
        <span />
      </span>
    </div>
  );
}
