'use client';

import type { ReactNode } from 'react';
import { Assistant } from '@/features/nuni/Assistant';
import { useNuniSession } from '@/features/nuni/Session';
import { useAuth } from '@/components/AuthGuard';
import LegacyAssistant from './LegacyAssistant';

/** Resolve the account before choosing its data source; a feature flag is not an identity. */
export function AssistantEntry({ cloudEnabled, children }: { cloudEnabled: boolean; children?: ReactNode }) {
  const auth = useNuniSession();
  const school = useAuth();
  if (!auth.loading && !auth.error && !auth.pendingLogout) {
    if (!auth.session) return <LegacyAssistant>{children}</LegacyAssistant>;
    // Preserve the existing school data engine when cloud V2 is disabled,
    // including accounts that are also signed into the platform.
    if (!cloudEnabled) {
      if (school.loading) return <p role="status">正在確認學校帳號…</p>;
      if (school.user || school.error) return <LegacyAssistant>{children}</LegacyAssistant>;
    }
  }
  return <Assistant cloudEnabled={cloudEnabled}>{children}</Assistant>;
}
