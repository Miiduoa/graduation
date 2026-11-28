'use client';

import { usePwaInstallation } from '@/lib/pwaInstallation';

/** Capture browser install capability on every route, including the Today page. */
export function PWAInstallObserver() {
  usePwaInstallation();
  return null;
}
