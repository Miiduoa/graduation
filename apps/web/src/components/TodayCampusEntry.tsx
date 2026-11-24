'use client';

import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useId,
  useImperativeHandle,
  useLayoutEffect,
  useRef,
  useState,
  type Ref,
  type Dispatch,
  type SetStateAction,
} from 'react';
import { usePathname, useSearchParams } from 'next/navigation';
import { useNuniSession } from '@/features/nuni/Session';
import { useClientHydrated } from '@/lib/useClientHydrated';
import { areFunctionsConfigured } from '@/lib/functionsUrl';
import { useCampusBrowseContext } from '@/lib/useCampusBrowseContext';
import { useCampusNavigationSearch } from '@/lib/campusNavigation';
import { currentReturnPath } from '@/lib/navigation';
import { AssistantLinkNavigation, useAssistantLinkNavigation } from './AssistantReplyLink';
import { useLocationHash } from '@/lib/useLocationHash';
import { useAssistantEnabled } from './AssistantEnabledProvider';
import { useAuth } from './AuthGuard';
import { LoginLink } from './LoginLink';
import { CampusIcon } from './CampusIcon';
import { QuickCampusEntry } from './QuickCampusEntry';
import { useOptionalAssistantWorkspace } from './AssistantWorkspaceContext';
import { AssistantWorkspaceEntry } from './AssistantWorkspaceEntry';
import styles from './TodayCampusEntry.module.css';
import type { AssistantWorkContext } from '@campus/shared/src/assistantRoleWorkflows';

const NuniConversation = lazy(async () => ({
  default: (await import('@/features/nuni/Assistant')).Conversation,
}));
const SchoolConversation = lazy(async () => ({
  default: (await import('@/app/ai-assistant/LegacyAssistant')).AssistantConversation,
}));

type Account =
  | { kind: 'nuni'; context: string; accountId: string }
  | { kind: 'school'; uid: string; localOwner: string };

type InlineDraft = { text: string; setText: Dispatch<SetStateAction<string>> };

function TodayConversation({
  account,
  schoolId,
  cloudEnabled,
  preferredWorkContext,
  onNavigate,
  inlineDraft,
  paused = false,
}: {
  account: Account;
  schoolId: string;
  cloudEnabled: boolean;
  preferredWorkContext?: AssistantWorkContext;
  onNavigate?: (href: string) => void;
  inlineDraft?: InlineDraft;
  paused?: boolean;
}) {
  const [localText, setLocalText] = useState('');
  const text = inlineDraft?.text ?? localText;
  const setText = inlineDraft?.setText ?? setLocalText;
  const [nuniFreeform, setNuniFreeform] = useState(false);
  const canAsk =
    account.kind === 'school' ? areFunctionsConfigured() : !cloudEnabled || nuniFreeform;
  const [searchOpen, setSearchOpen] = useState(false);
  const conversation = useRef<HTMLDivElement>(null);
  const searchId = useId();
  const draft = { text, setText };
  useLayoutEffect(() => {
    if (!paused) return;
    // Read requests can be stopped; an already-confirmed mutation keeps its
    // journal so its outcome can be checked after the identity is verified.
    const root = conversation.current;
    stopAssistantVoice(root);
    root?.querySelectorAll<HTMLButtonElement>('[data-assistant-stop-read]')
      .forEach((button) => button.click());
  }, [paused]);

  return (
    <section className={styles.conversation} aria-label="校園助理對話入口" hidden={paused} inert={paused}>
      <div className={styles.tools}>
        {canAsk && <p className={styles.hint}>語音聽寫可能由瀏覽器的語音服務處理。</p>}
        <button
          type="button"
          className={styles.serviceToggle}
          aria-expanded={searchOpen}
          aria-controls={searchId}
          onClick={() => setSearchOpen(!searchOpen)}
        >
          <CampusIcon name="search" size={16} />
          找校園服務
        </button>
      </div>
      <div id={searchId} hidden={!searchOpen}>
        {searchOpen && (
          <QuickCampusEntry
            compact
            onNavigate={onNavigate}
            onAsk={
              canAsk
                ? (phrase) => {
                    setText(phrase);
                    setSearchOpen(false);
                    conversation.current?.querySelector('textarea')?.focus();
                  }
                : null
            }
          />
        )}
      </div>
      <div ref={conversation}>
        <Suspense fallback={<p role="status">正在開啟校園助理…</p>}>
          {account.kind === 'nuni' ? (
            <NuniConversation
              preferredWorkContext={preferredWorkContext}
              context={account.context}
              accountId={account.accountId}
              schoolId={schoolId}
              cloudEnabled={cloudEnabled}
              inlineDraft={draft}
              onFreeformReady={setNuniFreeform}
            />
          ) : (
            <SchoolConversation
              userId={account.uid}
              localOwner={account.localOwner}
              groupId=""
              initialDraft=""
              schoolId={schoolId}
              inline
              inlineDraft={draft}
            />
          )}
        </Suspense>
      </div>
    </section>
  );
}

export function TodayCampusEntry({
  active = true,
  focusRequest = 0,
  returnAnchor = 'today-voice-entry',
  preferredWorkContext,
  onNavigate,
  inlineDraft,
  paused = false,
}: {
  preferredWorkContext?: AssistantWorkContext;
  onNavigate?: (href: string) => void;
  inlineDraft?: InlineDraft;
  paused?: boolean;
  active?: boolean;
  focusRequest?: number;
  returnAnchor?: 'today-voice-entry' | 'campus-assistant-entry';
} = {}) {
  const entry = useRef<HTMLDivElement>(null);
  const completedFocusRequest = useRef(0);
  const pathname = usePathname();
  const params = useSearchParams();
  const campusSearch = useCampusNavigationSearch(params);
  const returnSearch = new URLSearchParams(params?.toString());
  for (const key of ['school', 'schoolId', 'campus']) returnSearch.delete(key);
  new URLSearchParams(campusSearch).forEach((value, key) => returnSearch.set(key, value));
  const returnPath = currentReturnPath(pathname, returnSearch.toString(), `#${returnAnchor}`);
  useEffect(() => {
    const root = entry.current;
    if (paused) {
      // Rechecking a session must never reclaim focus when it settles. Only a
      // subsequent explicit open produces another focus request.
      completedFocusRequest.current = focusRequest;
      return;
    }
    if (!active || !focusRequest || completedFocusRequest.current === focusRequest || !root) return;
    const initialFocus = document.activeElement;
    function focusInput() {
      // A delayed capability response must not take focus after the user has
      // already moved to another control or returned to the underlying page.
      if (
        document.activeElement !== initialFocus &&
        document.activeElement !== document.body &&
        initialFocus?.isConnected
      ) {
        completedFocusRequest.current = focusRequest;
        observer.disconnect();
        return;
      }
      const field = root?.querySelector<HTMLElement>(
        'form[aria-label="傳送問題"] textarea:not(:disabled), input[type="search"]:not(:disabled)',
      );
      if (!field) return;
      field.focus({ preventScroll: true });
      completedFocusRequest.current = focusRequest;
      field.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
      observer.disconnect();
    }
    const observer = new MutationObserver(focusInput);
    observer.observe(root, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['disabled'],
    });
    focusInput();
    return () => observer.disconnect();
  }, [active, paused, focusRequest]);
  return (
    <div ref={entry}>
      <AssistantLinkNavigation.Provider value={onNavigate}>
        <CampusEntryContent
          returnPath={returnPath}
          preferredWorkContext={preferredWorkContext}
          onNavigate={onNavigate}
          inlineDraft={inlineDraft}
          paused={paused}
        />
      </AssistantLinkNavigation.Provider>
    </div>
  );
}

function CampusEntryContent({
  returnPath,
  preferredWorkContext,
  onNavigate,
  inlineDraft,
  paused = false,
}: {
  returnPath: string;
  preferredWorkContext?: AssistantWorkContext;
  onNavigate?: (href: string) => void;
  inlineDraft?: InlineDraft;
  paused?: boolean;
}) {
  const hydrated = useClientHydrated();
  const navigateLink = useAssistantLinkNavigation();
  const auth = useAuth();
  const nuni = useNuniSession();
  const enabled = useAssistantEnabled();
  const campus = useCampusBrowseContext();
  const session = nuni.session;
  const uid = auth.user?.uid;
  const functionsConfigured = areFunctionsConfigured();
  const platformAvailable = !!session && !nuni.error;
  const identity = JSON.stringify([
    uid, session?.context, session?.platformAccountId, enabled, functionsConfigured,
    Boolean(auth.error), Boolean(nuni.error), nuni.pendingLogout,
  ]);
  const [retained, setRetained] = useState<{
    identity: string; account: Account; schoolId: string;
  } | null>(null);
  if (retained && retained.identity !== identity) setRetained(null);
  const preferSchoolEngine = !enabled && functionsConfigured && !!uid && !auth.error;
  const account: Account | null =
    session && !nuni.error && !preferSchoolEngine
      ? { kind: 'nuni', context: session.context, accountId: session.platformAccountId }
      : uid && !auth.error
        ? { kind: 'school', uid, localOwner: session ? 'platform:' + session.platformAccountId : 'school:' + uid }
        : null;
  const checking = !hydrated || nuni.loading ||
    (auth.loading && !(platformAvailable && (enabled || !functionsConfigured))) || campus.status === 'loading';
  const confirmed = !checking && !paused && !nuni.pendingLogout && account &&
    campus.status === 'ready' && campus.schoolId
    ? { identity, account, schoolId: campus.schoolId } : null;
  if (confirmed && (retained?.identity !== identity || retained.schoolId !== confirmed.schoolId))
    setRetained(confirmed);
  const conversationScope = confirmed ?? (paused && retained?.identity === identity ? retained : null);
  if (conversationScope) return (
    <TodayConversation
      preferredWorkContext={preferredWorkContext}
      onNavigate={onNavigate}
      inlineDraft={inlineDraft}
      paused={paused}
      key={JSON.stringify([identity, conversationScope.account.kind, conversationScope.schoolId])}
      account={conversationScope.account}
      schoolId={conversationScope.schoolId}
      cloudEnabled={enabled}
    />
  );
  if (
    !hydrated ||
    nuni.loading ||
    (auth.loading && !(platformAvailable && (enabled || !functionsConfigured)))
  )
    return <p role="status">正在確認登入狀態…</p>;
  if (nuni.pendingLogout) return <p role="status">正在確認登出狀態…</p>;
  if (campus.status === 'loading') return <p role="status">正在確認瀏覽校園…</p>;
  if (!account || campus.status !== 'ready' || !campus.schoolId) {
    return (
      <>
        {!uid && !session ? (
          <p className={styles.hint}>
            <LoginLink returnPath={returnPath} onNavigateClick={navigateLink}>
              登入後，接著詢問校園助理
            </LoginLink>
          </p>
        ) : account && campus.status === 'unselected' ? (
          <p className={styles.hint}>請先從頁首選擇學校，就能在這裡詢問校園助理。</p>
        ) : null}
        <QuickCampusEntry
          compact
          key={JSON.stringify([uid, session?.context, campus.schoolId])}
          onAsk={null}
          onNavigate={onNavigate}
          inlineDraft={inlineDraft}
        />
      </>
    );
  }
  return <p role="status">正在確認登入與校園…</p>;
}

export type TodayAssistantHandle = { openAssistant(): void };

function stopAssistantVoice(panel: HTMLElement | null) {
  panel
    ?.querySelectorAll<HTMLButtonElement>(
      '[data-voice-input][aria-pressed="true"], [data-voice-playback][aria-pressed="true"]',
    )
    .forEach((button) => button.click());
}

function clearAssistantAnchor(anchor: string) {
  if (window.location.hash !== `#${anchor}`) return;
  try {
    window.history.replaceState(
      window.history.state,
      '',
      `${window.location.pathname}${window.location.search}`,
    );
    window.dispatchEvent(new HashChangeEvent('hashchange'));
  } catch {
    // Closing the assistant remains possible when History access is unavailable.
  }
}

export function TodayAssistantDisclosure({
  ref,
  onOpenChange,
  preferredWorkContext,
}: {
  preferredWorkContext?: AssistantWorkContext;
  ref: Ref<TodayAssistantHandle>;
  onOpenChange: (open: boolean) => void;
}) {
  const workspace = useOptionalAssistantWorkspace();
  return workspace ? (
    <AssistantWorkspaceEntry
      workspace={workspace}
      ref={ref}
      onOpenChange={onOpenChange}
      preferredWorkContext={preferredWorkContext}
    />
  ) : (
    <LocalAssistantDisclosure
      ref={ref}
      onOpenChange={onOpenChange}
      preferredWorkContext={preferredWorkContext}
    />
  );
}

function LocalAssistantDisclosure({
  ref,
  onOpenChange,
  preferredWorkContext,
}: {
  preferredWorkContext?: AssistantWorkContext;
  ref: Ref<TodayAssistantHandle>;
  onOpenChange: (open: boolean) => void;
}) {
  const disclosure = useRef<HTMLDetailsElement>(null);
  const openingTrigger = useRef<HTMLElement | null>(null);
  const hash = useLocationHash();
  const [opened, setOpened] = useState(false);
  const [hasOpened, setHasOpened] = useState(false);
  const [focusRequest, setFocusRequest] = useState(0);

  const openAssistant = useCallback(() => {
    const panel = disclosure.current;
    if (!panel) return;
    openingTrigger.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    panel.open = true;
    setOpened(true);
    setHasOpened(true);
    setFocusRequest((request) => request + 1);
    onOpenChange(true);
  }, [onOpenChange]);

  useEffect(() => {
    if (hash !== '#today-voice-entry') return;
    openAssistant();
    // A login-return fragment opens once; conversation updates must not refocus it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hash]);

  useImperativeHandle(
    ref,
    () => ({
      openAssistant,
    }),
    [openAssistant],
  );

  return (
    <details
      ref={disclosure}
      id="today-voice-entry"
      className={styles.disclosure}
      onKeyDown={(event) => {
        if (event.key !== 'Escape' || event.nativeEvent.isComposing || !event.currentTarget.open)
          return;
        event.preventDefault();
        event.stopPropagation();
        event.currentTarget.open = false;
        setOpened(false);
        onOpenChange(false);
        stopAssistantVoice(event.currentTarget);
        clearAssistantAnchor('today-voice-entry');
        const trigger = openingTrigger.current;
        (trigger?.isConnected ? trigger : event.currentTarget.querySelector('summary'))?.focus();
      }}
      onToggle={({ currentTarget: panel, target }) => {
        if (target !== panel) return;
        setOpened(panel.open);
        onOpenChange(panel.open);
        if (panel.open) {
          setHasOpened(true);
          return;
        }
        stopAssistantVoice(panel);
        clearAssistantAnchor('today-voice-entry');
      }}
    >
      <summary className={styles.trigger}>
        <CampusIcon name="social" size={20} />
        <strong>校園助理</strong>
        <span className={styles.triggerHint}>打字或語音詢問</span>
      </summary>
      <div className={styles.body}>
        {hasOpened && <TodayCampusEntry active={opened} focusRequest={focusRequest} preferredWorkContext={preferredWorkContext} />}
      </div>
    </details>
  );
}
