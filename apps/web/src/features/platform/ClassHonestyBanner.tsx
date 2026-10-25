'use client';

import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/Button';
import { CLASS_HONESTY_STORAGE_KEY, CLASS_HONESTY_TEXT } from './constants';
import styles from './Platform.module.css';

export function ClassHonestyBanner() {
  const [dismissed, setDismissed] = useState(true);
  useEffect(() => {
    try {
      setDismissed(window.sessionStorage.getItem(CLASS_HONESTY_STORAGE_KEY) === '1');
    } catch {
      setDismissed(false);
    }
  }, []);
  if (dismissed) return null;
  return (
    <p className={styles.honesty} role="note">
      <span>{CLASS_HONESTY_TEXT}</span>
      <Button
        type="button"
        size="sm"
        onClick={() => {
          try {
            window.sessionStorage.setItem(CLASS_HONESTY_STORAGE_KEY, '1');
          } catch {
            /* keep the banner dismissible for this visit */
          }
          setDismissed(true);
        }}
      >
        知道了
      </Button>
    </p>
  );
}
