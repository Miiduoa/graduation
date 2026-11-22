'use client';

import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useId,
  useImperativeHandle,
  useRef,
  useState,
  type Ref,
} from 'react';
import { usePathname, useSearchParams } from 'next/navigation';
import { useNuniSession } from '@/features/nuni/Session';
import { useClientHydrated } from '@/lib/useClientHydrated';
import { areFunctionsConfigured } from '@/lib/functionsUrl';
import { useCampusBrowseContext } from '@/lib/useCampusBrowseContext';
import { useCampusNavigationSearch } from '@/lib/campusNavigation';
import { currentReturnPath } from '@/lib/navigation';
import { AssistantLinkNavigation } from './AssistantReplyLink';
import { useLocationHash } from '@/lib/useLocationHash';
import { useAssistantEnabled } from './AssistantEnabledProvider';
import { useAuth } from './AuthGuard';
import { LoginLink } from './LoginLink';
import { CampusIcon } from './CampusIcon';
import { QuickCampusEntry } from './QuickCampusEntry';
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

function TodayConversation({
  account,
  schoolId,
  cloudEnabled,
  preferredWorkContext,
  onNavigate,
}: {
  account: Account;
  schoolId: string;
  cloudEnabled: boolean;
  preferredWorkContext?: AssistantWorkContext;
  onNavigate?: (href: string) => void;
}) {
  const [text, setText] = useState('');
  const [nuniFreeform, setNuniFreeform] = useState(false);
  const canAsk =
    account.kind === 'school' ? areFunctionsConfigured() : !cloudEnabled || nuniFreeform;
  const [searchOpen, setSearchOpen] = useState(false);
  const conversation = useRef<HTMLDivElement>(null);
  const searchId = useId();
  const draft = { text, setText };

  return (
    <section className={styles.conversation} aria-label="校園助理對話入口">
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
        <AssistantLinkNavigation.Provider value={onNavigate}>
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
        </AssistantLinkNavigation.Provider>
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
}: {
  preferredWorkContext?: AssistantWorkContext;
  onNavigate?: (href: string) => void;
  active?: boolean;
  focusRequest?: number;
  returnAnchor?: 'today-voice-entry' | 'campus-assistant-entry';
} = {}) {
  const entry = useRef<HTMLDivElement>(null);
  const pathname = usePathname();
  const params = useSearchParams();
  const campusSearch = useCampusNavigationSearch(params);
  const returnSearch = new URLSearchParams(params?.toString());
  for (const key of ['school', 'schoolId', 'campus']) returnSearch.delete(key);
  new URLSearchParams(campusSearch).forEach((value, key) => returnSearch.set(key, value));
  const returnPath = currentReturnPath(pathname, returnSearch.toString(), `#${returnAnchor}`);
  useEffect(() => {
    const root = entry.current;
    if (!active || !focusRequest || !root) return;
    const initialFocus = document.activeElement;
    function focusInput() {
      // A delayed capability response must not take focus after the user has
      // already moved to another control or returned to the underlying page.
      if (
        document.activeElement !== initialFocus &&
        document.activeElement !== document.body &&
        initialFocus?.isConnected
      ) {
        observer.disconnect();
        return;
      }
      const field = root?.querySelector<HTMLElement>(
        'form[aria-label="傳送問題"] textarea:not(:disabled), input[type="search"]:not(:disabled)',
      );
      if (!field) return;
      field.focus({ preventScroll: true });
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
  }, [active, focusRequest]);
  return (
    <div ref={entry}>
      <CampusEntryContent
        returnPath={returnPath}
        preferredWorkContext={preferredWorkContext}
        onNavigate={onNavigate}
      />
    </div>
  );
}

function CampusEntryContent({
  returnPath,
  preferredWorkContext,
  onNavigate,
}: {
  returnPath: string;
  preferredWorkContext?: AssistantWorkContext;
  onNavigate?: (href: string) => void;
}) {
  const hydrated = useClientHydrated();
  const auth = useAuth();
  const nuni = useNuniSession();
  const enabled = useAssistantEnabled();
  const campus = useCampusBrowseContext();
  const session = nuni.session;
  const uid = auth.user?.uid;
  const functionsConfigured = areFunctionsConfigured();
  const platformAvailable = !!session && !nuni.error;
  if (
    !hydrated ||
    nuni.loading ||
    (auth.loading && !(platformAvailable && (enabled || !functionsConfigured)))
  )
    return <p role="status">正在確認登入狀態…</p>;
  if (nuni.pendingLogout) return <p role="status">正在確認登出狀態…</p>;
  if (campus.status === 'loading') return <p role="status">正在確認瀏覽校園…</p>;
  const preferSchoolEngine = !enabled && functionsConfigured && !!uid && !auth.error;
  const account: Account | null =
    session && !nuni.error && !preferSchoolEngine
      ? { kind: 'nuni', context: session.context, accountId: session.platformAccountId }
      : uid && !auth.error
        ? {
            kind: 'school',
            uid,
            localOwner: session ? 'platform:' + session.platformAccountId : 'school:' + uid,
          }
        : null;
  if (!account || campus.status !== 'ready' || !campus.schoolId) {
    return (
      <>
        {!uid && !session ? (
          <p className={styles.hint}>
            <LoginLink returnPath={returnPath}>登入後，接著詢問校園助理</LoginLink>
          </p>
        ) : account && campus.status === 'unselected' ? (
          <p className={styles.hint}>請先從頁首選擇學校，就能在這裡詢問校園助理。</p>
        ) : null}
        <QuickCampusEntry
          compact
          key={JSON.stringify([uid, session?.context, campus.schoolId])}
          onAsk={null}
          onNavigate={onNavigate}
        />
      </>
    );
  }
  return (
    <TodayConversation
      preferredWorkContext={preferredWorkContext}
      onNavigate={onNavigate}
      key={JSON.stringify([
        uid,
        session?.context,
        session?.platformAccountId,
        account.kind,
        campus.schoolId,
        enabled,
        functionsConfigured,
      ])}
      account={account}
      schoolId={campus.schoolId}
      cloudEnabled={enabled}
    />
  );
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
        {hasOpened && (
          <TodayCampusEntry
            active={opened}
            focusRequest={focusRequest}
            preferredWorkContext={preferredWorkContext}
          />
        )}
      </div>
    </details>
  );
}
