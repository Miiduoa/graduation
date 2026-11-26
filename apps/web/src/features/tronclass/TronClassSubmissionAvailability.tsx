import { useId } from 'react';
import type { TronClassSubmissionAvailability as Availability } from '@/lib/tronClassIntegrationTypes';
import {
  TRONCLASS_AVAILABILITY_DESCRIPTION, TRONCLASS_AVAILABILITY_GROUP,
  TRONCLASS_AVAILABILITY_UNAVAILABLE, tronClassSubmissionAvailabilityFacts,
} from '@campus/shared/src/tronClassSubmissionAvailabilityDisplay';
import { tronClassTime } from './TronClassSource';
import styles from './tronclass.module.css';

export function TronClassSubmissionAvailability({ availability, onRetry, retryDisabled = false }: {
  availability: Availability;
  onRetry(): void;
  retryDisabled?: boolean;
}) {
  const headingId = useId();
  return (
    <section className={styles.assignmentSettings} aria-labelledby={headingId}>
      <div className={styles.settingsHeading}>
        <h3 id={headingId}>你的校方繳交狀態</h3>
        <p className={styles.muted}>更新於 {tronClassTime(availability.fetchedAt)}</p>
      </div>
      {availability.state === 'available' ? (
        <>
          <dl className={styles.settingsGrid}>
            {tronClassSubmissionAvailabilityFacts(availability).map(([label, value]) => (
              <div key={label}><dt>{label}</dt><dd>{value}</dd></div>
            ))}
          </dl>
          <p className={styles.muted}>{TRONCLASS_AVAILABILITY_DESCRIPTION}</p>
        </>
      ) : (
        <p role="status" className={styles.muted}>
          {availability.state === 'group-unsupported' ? TRONCLASS_AVAILABILITY_GROUP : TRONCLASS_AVAILABILITY_UNAVAILABLE}
        </p>
      )}
      {availability.state !== 'group-unsupported' && (
        <button className="btn" disabled={retryDisabled} onClick={onRetry}>重新讀取繳交狀態</button>
      )}
    </section>
  );
}
