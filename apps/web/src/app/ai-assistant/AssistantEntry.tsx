'use client';

import type { ReactNode } from 'react';
import { Assistant } from '@/features/nuni/Assistant';
import { useNuniSession } from '@/features/nuni/Session';
import { useAuth } from '@/components/AuthGuard';
import { areFunctionsConfigured } from '@/lib/functionsUrl';
import LegacyAssistant from './LegacyAssistant';

/** Resolve the account before choosing its data source; a feature flag is not an identity. */
export function AssistantEntry({ cloudEnabled, children }: { cloudEnabled: boolean; children?: ReactNode }) {
  const auth = useNuniSession();
  const school = useAuth();
  if (!auth.loading && !auth.error && !auth.pendingLogout) {
    if (!auth.session) return <LegacyAssistant>{children}</LegacyAssistant>;
    // Keep a configured school reader. A platform session can still read its
    // own data when neither cloud V2 nor school Functions are available.
    if (!cloudEnabled && areFunctionsConfigured()) {
      if (school.loading) return <p role="status">正在確認學校帳號…</p>;
      if (school.user || school.error) return <LegacyAssistant>{children}</LegacyAssistant>;
    }
  }
  return <Assistant
    key={JSON.stringify([auth.session?.context, auth.session?.platformAccountId, cloudEnabled])}
    cloudEnabled={cloudEnabled}
  >{children}</Assistant>;
}
