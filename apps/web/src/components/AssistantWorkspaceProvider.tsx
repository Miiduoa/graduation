'use client';

import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type Dispatch,
  type ReactNode,
  type SetStateAction,
} from 'react';
import { usePathname, useSearchParams } from 'next/navigation';
import type { AssistantWorkContext } from '@campus/shared/src/assistantRoleWorkflows';
import { useNuniSession } from '@/features/nuni/Session';
import { useCampusBrowseContext } from '@/lib/useCampusBrowseContext';
import { useLocationHash } from '@/lib/useLocationHash';
import { useAuth } from './AuthGuard';
import { useAssistantEnabled } from './AssistantEnabledProvider';
import {
  ASSISTANT_WORKSPACE_ID,
  AssistantWorkspaceContext,
  type AssistantWorkspace,
} from './AssistantWorkspaceContext';
import { CampusIcon } from './CampusIcon';
import styles from './AssistantWorkspace.module.css';

const TodayCampusEntry = lazy(async () => ({
  default: (await import('./TodayCampusEntry')).TodayCampusEntry,
}));

type WorkspaceState = {
  ownerKey: string;
  identityKey: string;
  schoolId: string | null;
  schoolName: string;
  generation: number;
  open: boolean;
  hasStarted: boolean;
  draft: string;
  focusRequest: number;
  workContext?: AssistantWorkContext;
};

function emptyWorkspace(
  ownerKey: string,
  identityKey: string,
  schoolId: string | null,
  schoolName: string,
  generation = 0,
): WorkspaceState {
  return {
    ownerKey,
    identityKey,
    schoolId,
    schoolName,
    generation,
    open: false,
    hasStarted: false,
    draft: '',
    focusRequest: 0,
  };
}

function isAssistantAnchor(hash: string): boolean {
  return hash === '#campus-assistant-entry' || hash === '#today-voice-entry';
}

function clearAssistantAnchor() {
  if (!isAssistantAnchor(window.location.hash)) return;
  try {
    window.history.replaceState(
      window.history.state,
      '',
      window.location.pathname + window.location.search,
    );
    window.dispatchEvent(new HashChangeEvent('hashchange'));
  } catch {
    // Restricted History access must not prevent closing the workspace.
  }
}

function stopAssistantVoice(panel: HTMLElement | null) {
  panel
    ?.querySelectorAll<HTMLButtonElement>(
      '[data-voice-input][aria-pressed="true"], [data-voice-playback][aria-pressed="true"]',
    )
    .forEach((button) => button.click());
}

/** One in-memory conversation follows navigation within the same verified identity.
 * Only the assistant is replaced on a scope change; page editors stay mounted. */
export function AssistantWorkspaceProvider({ children }: { children: ReactNode }) {
  const auth = useAuth();
  const nuni = useNuniSession();
  const campus = useCampusBrowseContext();
  const enabled = useAssistantEnabled();
  const pathname = usePathname();
  const params = useSearchParams();
  const hash = useLocationHash();
  // Routes and filters never own a conversation. A refresh that retains the
  // exact identity pauses it; a different or failed identity discards it.
  const identityKey = JSON.stringify([
    auth.user?.uid ?? null,
    nuni.session?.context ?? null,
    nuni.session?.platformAccountId ?? null,
    enabled,
  ]);
  const failureKey = JSON.stringify([
    Boolean(auth.error),
    Boolean(nuni.error),
    nuni.pendingLogout,
    campus.status === 'error',
  ]);
  const failed = Boolean(
    auth.error || nuni.error || nuni.pendingLogout || campus.status === 'error',
  );
  const paused = auth.loading || nuni.loading || campus.status === 'loading';
  const initialOwnerKey = JSON.stringify([identityKey, campus.schoolId, failureKey]);
  const [saved, setSaved] = useState(() =>
    emptyWorkspace(initialOwnerKey, identityKey, campus.schoolId, campus.schoolName),
  );
  // CampusProviders temporarily hides the selected school during a same-user
  // pageshow/visibility refresh. Reuse only this exact identity's known school.
  const schoolId =
    campus.status === 'loading' && !failed && saved.identityKey === identityKey
      ? saved.schoolId
      : campus.schoolId;
  const schoolName =
    campus.status === 'loading' && !failed && saved.identityKey === identityKey
      ? saved.schoolName
      : campus.schoolName;
  const ownerKey = JSON.stringify([identityKey, schoolId, failureKey]);
  // Reset before committing children. An effect-only reset could briefly show
  // another account's draft or allow an old async callback to restore it.
  if (saved.ownerKey !== ownerKey) {
    setSaved(emptyWorkspace(ownerKey, identityKey, schoolId, schoolName, saved.generation + 1));
  }
  const state =
    saved.ownerKey === ownerKey
      ? saved
      : emptyWorkspace(ownerKey, identityKey, schoolId, schoolName, saved.generation + 1);
  const generation = state.generation;
  // The epoch prevents Alice → Bob → Alice from reviving a callback belonging
  // to the first Alice session, even if all supplied identity strings repeat.
  const scopeKey = JSON.stringify([ownerKey, generation]);
  const panel = useRef<HTMLElement>(null);
  const openingTrigger = useRef<HTMLElement | null>(null);
  const activeScope = useRef({ ownerKey, generation, paused });
  useLayoutEffect(() => {
    activeScope.current = { ownerKey, generation, paused };
    if (paused) stopAssistantVoice(panel.current);
  }, [ownerKey, generation, paused]);
  useLayoutEffect(() => {
    openingTrigger.current = null;
  }, [scopeKey]);

  const setDraft: Dispatch<SetStateAction<string>> = useCallback(
    (update) => {
      if (
        activeScope.current.ownerKey !== ownerKey ||
        activeScope.current.generation !== generation ||
        activeScope.current.paused
      )
        return;
      setSaved((previous) =>
        previous.ownerKey === ownerKey && previous.generation === generation
          ? {
              ...previous,
              draft: typeof update === 'function' ? update(previous.draft) : update,
            }
          : previous,
      );
    },
    [ownerKey, generation, setSaved],
  );

  const openWorkspace = useCallback(
    (options?: { workContext?: AssistantWorkContext }) => {
      if (
        activeScope.current.ownerKey !== ownerKey ||
        activeScope.current.generation !== generation ||
        activeScope.current.paused
      )
        return;
      const focused = document.activeElement;
      if (
        focused instanceof HTMLElement &&
        focused !== document.body &&
        !panel.current?.contains(focused)
      ) {
        openingTrigger.current = focused;
      }
      setSaved((previous) =>
        previous.ownerKey === ownerKey && previous.generation === generation
          ? {
              ...previous,
              open: true,
              hasStarted: true,
              focusRequest: previous.focusRequest + 1,
              ...(options?.workContext ? { workContext: options.workContext } : {}),
            }
          : previous,
      );
    },
    [ownerKey, generation, setSaved],
  );

  const minimize = useCallback(
    (restoreFocus = true) => {
      if (
        activeScope.current.ownerKey !== ownerKey ||
        activeScope.current.generation !== generation
      )
        return;
      stopAssistantVoice(panel.current);
      setSaved((previous) =>
        previous.ownerKey === ownerKey && previous.generation === generation
          ? { ...previous, open: false }
          : previous,
      );
      clearAssistantAnchor();
      if (restoreFocus) {
        const trigger = openingTrigger.current;
        const fallback = document.querySelector<HTMLElement>('[data-assistant-workspace-trigger]');
        (trigger?.isConnected ? trigger : fallback)?.focus({ preventScroll: true });
      }
    },
    [ownerKey, generation, setSaved],
  );

  const focusedRequest = useRef('');
  useLayoutEffect(() => {
    const request = `${scopeKey}:${state.focusRequest}`;
    if (!state.open || paused || focusedRequest.current === request) return;
    focusedRequest.current = request;
    panel.current?.focus({ preventScroll: true });
  }, [scopeKey, state.open, state.focusRequest, paused]);

  const routeKey = `${pathname ?? ''}?${params?.toString() ?? ''}`;
  const lastLocation = useRef<{ routeKey: string; hash: string; scopeKey: string } | null>(null);
  useEffect(() => {
    // App Router may commit pushState after this render's hash snapshot. Read
    // the committed destination before deciding to collapse, or a login-return
    // anchor can be mistaken for a normal route change and cleared by minimize.
    const committedHash = window.location.hash;
    const previous = lastLocation.current;
    lastLocation.current = { routeKey, hash: committedHash, scopeKey };
    const changed =
      !previous ||
      previous.routeKey !== routeKey ||
      previous.hash !== committedHash ||
      previous.scopeKey !== scopeKey;
    if (isAssistantAnchor(committedHash)) {
      // Returning from login only opens the composer. It never submits a draft.
      if (!paused && (changed || !state.hasStarted)) openWorkspace();
    } else if (changed && previous && previous.routeKey !== routeKey) {
      minimize(false);
    }
  }, [routeKey, hash, scopeKey, paused, state.hasStarted, openWorkspace, minimize]);

  const value = useMemo<AssistantWorkspace>(
    () => ({
      open: state.open,
      hasStarted: state.hasStarted,
      paused,
      draft: paused ? '' : state.draft,
      setDraft,
      openWorkspace,
      minimize,
      scopeKey,
    }),
    [
      state.open,
      state.hasStarted,
      state.draft,
      paused,
      setDraft,
      openWorkspace,
      minimize,
      scopeKey,
    ],
  );

  return (
    <AssistantWorkspaceContext.Provider value={value}>
      {children}
      {state.hasStarted && (
        <section
          ref={panel}
          id={ASSISTANT_WORKSPACE_ID}
          className={styles.wsPanel}
          hidden={!state.open}
          role="region"
          aria-labelledby="campus-assistant-workspace-title"
          tabIndex={-1}
          onKeyDown={(event) => {
            if (
              event.key !== 'Escape' ||
              event.defaultPrevented ||
              event.nativeEvent.isComposing ||
              event.nativeEvent.keyCode === 229
            )
              return;
            event.preventDefault();
            event.stopPropagation();
            minimize();
          }}
        >
          <header className={styles.wsHeader}>
            <div className={styles.wsHeading}>
              <span className={styles.wsEyebrow}>{schoolName || 'nuni'}</span>
              <h2 id="campus-assistant-workspace-title">校園助理</h2>
            </div>
            <button type="button" className={styles.wsClose} onClick={() => minimize()}>
              <svg
                viewBox="0 0 24 24"
                width="20"
                height="20"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.7"
                aria-hidden="true"
              >
                <path d="M6 12h12" strokeLinecap="round" />
              </svg>
              <span>收合</span>
            </button>
          </header>
          <div className={styles.wsBody}>
            {paused && (
              <p className={styles.wsLoading} role="status">
                正在確認登入與校園狀態，完成後會接續原本的任務。
              </p>
            )}
            <div hidden={paused} inert={paused}>
              <Suspense
                fallback={
                  <p className={styles.wsLoading} role="status">
                    正在開啟校園助理…
                  </p>
                }
              >
                <TodayCampusEntry
                  key={scopeKey}
                  active={state.open}
                  paused={paused}
                  focusRequest={state.focusRequest}
                  returnAnchor="campus-assistant-entry"
                  preferredWorkContext={state.workContext}
                  inlineDraft={{ text: state.draft, setText: setDraft }}
                  onNavigate={() => minimize(false)}
                />
              </Suspense>
            </div>
          </div>
        </section>
      )}
      {state.hasStarted && !state.open && (
        <button
          type="button"
          className={styles.wsResume}
          data-assistant-workspace-trigger
          aria-controls={ASSISTANT_WORKSPACE_ID}
          aria-expanded={false}
          disabled={paused}
          onClick={() => openWorkspace()}
        >
          <CampusIcon name="social" size={20} />
          <span>接續任務</span>
        </button>
      )}
    </AssistantWorkspaceContext.Provider>
  );
}
