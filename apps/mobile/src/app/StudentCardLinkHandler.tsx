import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';
import * as Linking from 'expo-linking';
import { STUDENT_CARD_TTL_MS } from '@campus/shared/src/studentCard';
import { StudentCardReader } from '../components/StudentCardNfc';
import { useAuth } from '../state/auth';
import { useNuniSession } from '../state/nuniSession';
import { parseStudentCardDeepLink } from './studentCardDeepLink';

type CardLink = {
  id: number;
  token?: string;
  expiresAt: number;
  onClose: () => void;
};

/** Keep one-time credentials outside navigation state and its persistence. */
export function StudentCardLinkHandler() {
  const auth = useAuth();
  const platform = useNuniSession();
  const schoolUid = auth.user?.uid ?? null;
  const platformId = platform.session?.platformAccountId ?? null;
  const account = useRef({
    schoolUid,
    schoolReady: !auth.loading || schoolUid !== null,
    platformId,
    platformReady: !platform.loading || platformId !== null,
  });
  const revision = useRef(0);
  const current = useRef<CardLink | null>(null);
  const [cardLink, setCardLink] = useState<CardLink | null>(null);
  const [foreground, setForeground] = useState(AppState.currentState === 'active');
  const foregroundRef = useRef(foreground);

  const close = useCallback((expectedId?: number) => {
    if (expectedId !== undefined && current.current?.id !== expectedId) return;
    revision.current += 1;
    current.current = null;
    setCardLink(null);
  }, []);

  useLayoutEffect(() => {
    const previous = account.current;
    const changed =
      (previous.schoolReady && previous.schoolUid !== schoolUid) ||
      (previous.platformReady && previous.platformId !== platformId);
    account.current = {
      schoolUid,
      schoolReady: previous.schoolReady || !auth.loading || schoolUid !== null,
      platformId,
      platformReady: previous.platformReady || !platform.loading || platformId !== null,
    };
    // Initial session restoration can finish after a public verification link arrives.
    if (changed) close();
  }, [schoolUid, auth.loading, platformId, platform.loading, close]);

  useEffect(() => {
    let mounted = true;
    const open = (url: string | null) => {
      if (!mounted) return;
      const token = parseStudentCardDeepLink(url);
      if (!token) {
        close();
        return;
      }
      const id = ++revision.current;
      if (current.current?.token === token) return;
      const next = {
        id,
        token,
        expiresAt: Date.now() + STUDENT_CARD_TTL_MS,
        onClose: () => close(id),
      };
      current.current = next;
      setCardLink(next);
    };
    const initialRevision = revision.current;
    const links = Linking.addEventListener('url', ({ url }) => open(url));
    void Linking.getInitialURL()
      .then((url) => {
        if (mounted && revision.current === initialRevision) open(url);
      })
      .catch(() => undefined);
    const appState = AppState.addEventListener('change', (next) => {
      if (!mounted) return;
      if (next === 'background') {
        foregroundRef.current = false;
        close();
        setForeground(false);
      } else if (next === 'active') {
        if (!foregroundRef.current && current.current && current.current.expiresAt <= Date.now())
          close();
        foregroundRef.current = true;
        setForeground(true);
      }
    });
    return () => {
      mounted = false;
      revision.current += 1;
      current.current = null;
      links.remove();
      appState.remove();
    };
  }, [close]);

  useEffect(() => {
    if (!cardLink?.token) return;
    const timer = setTimeout(
      () => {
        if (current.current?.id !== cardLink.id) return;
        if (!foreground) {
          cardLink.onClose();
          return;
        }
        const cleared = { ...current.current, token: undefined };
        current.current = cleared;
        setCardLink(cleared);
      },
      Math.max(0, cardLink.expiresAt - Date.now()),
    );
    return () => clearTimeout(timer);
  }, [cardLink, foreground]);

  if (!cardLink || !foreground) return null;
  return (
    <StudentCardReader
      key={cardLink.id}
      initialToken={cardLink.token}
      initialExpiresAt={cardLink.expiresAt}
      onClose={cardLink.onClose}
    />
  );
}
