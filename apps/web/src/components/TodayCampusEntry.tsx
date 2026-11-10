'use client';

import {
  lazy,
  Suspense,
  useId,
  useImperativeHandle,
  useLayoutEffect,
  useRef,
  useState,
  type Ref,
} from 'react';
import { useNuniSession } from '@/features/nuni/Session';
import { useClientHydrated } from '@/lib/useClientHydrated';
import { areFunctionsConfigured } from '@/lib/functionsUrl';
import { useCampusBrowseContext } from '@/lib/useCampusBrowseContext';
import { useAssistantEnabled } from './AssistantEnabledProvider';
import { useAuth } from './AuthGuard';
import { LoginLink } from './LoginLink';
import { CampusIcon } from './CampusIcon';
import { QuickCampusEntry } from './QuickCampusEntry';
import styles from './TodayCampusEntry.module.css';

const NuniConversation = lazy(async () => ({
  default: (await import('@/features/nuni/Assistant')).Conversation,
}));
const SchoolConversation = lazy(async () => ({
  default: (await import('@/app/ai-assistant/LegacyAssistant')).AssistantConversation,
}));

type Account = { kind: 'nuni'; context: string; accountId: string } | { kind: 'school'; uid: string; localOwner: string };

function TodayConversation({ account, schoolId }: { account: Account; schoolId: string }) {
  const [text, setText] = useState('');
  const [nuniFreeform, setNuniFreeform] = useState(false);
  const canAsk = account.kind === 'school' ? areFunctionsConfigured() : nuniFreeform;
  const [searchOpen, setSearchOpen] = useState(false);
  const conversation = useRef<HTMLDivElement>(null);
  const searchId = useId();
  const draft = { text, setText };

  return (
    <section className={styles.conversation} aria-label="今天的校園助理">
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
              context={account.context}
              accountId={account.accountId}
              schoolId={schoolId}
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

export function TodayCampusEntry() {
  useLayoutEffect(() => {
    // A client-side visit keeps the previous document's microphone policy.
    // Load Today's headers before the first draft, only for a blocked soft navigation.
    type Policy = { allowsFeature(feature: string): boolean };
    const doc = document as Document & { permissionsPolicy?: Policy; featurePolicy?: Policy };
    const policy = doc.permissionsPolicy ?? doc.featurePolicy;
    if (
      window.top !== window ||
      !('SpeechRecognition' in window || 'webkitSpeechRecognition' in window) ||
      policy?.allowsFeature('microphone') !== false
    )
      return;
    const navigation = performance.getEntriesByType?.('navigation')[0];
    if (navigation && new URL(navigation.name).pathname !== window.location.pathname) {
      window.location.reload();
    }
  }, []);
  const hydrated = useClientHydrated();
  const auth = useAuth();
  const nuni = useNuniSession();
  const enabled = useAssistantEnabled();
  const campus = useCampusBrowseContext();
  const session = nuni.session;
  const uid = auth.user?.uid;
  if (!hydrated || auth.loading || nuni.loading) return <p role="status">正在確認登入狀態…</p>;
  if (nuni.pendingLogout) return <p role="status">正在確認登出狀態…</p>;
  const account: Account | null =
    enabled && session && !nuni.error
      ? { kind: 'nuni', context: session.context, accountId: session.platformAccountId }
      : uid && !auth.error
        ? { kind: 'school', uid, localOwner: session ? 'platform:' + session.platformAccountId : 'school:' + uid }
        : null;
  if (!account || campus.status !== 'ready' || !campus.schoolId) {
    return (
      <>
        {!uid && !session ? (
          <p className={styles.hint}>
            <LoginLink returnPath="/">登入後，在今天頁詢問校園助理</LoginLink>
          </p>
        ) : account && campus.status === 'unselected' ? (
          <p className={styles.hint}>請先從頁首選擇學校，就能在這裡詢問校園助理。</p>
        ) : null}
        <QuickCampusEntry
          compact
          key={JSON.stringify([uid, session?.context, campus.schoolId])}
          onAsk={null}
        />
      </>
    );
  }
  return (
    <TodayConversation
      key={JSON.stringify([
        uid,
        session?.context,
        session?.platformAccountId,
        account.kind,
        campus.schoolId,
      ])}
      account={account}
      schoolId={campus.schoolId}
    />
  );
}

export type TodayVoiceHandle = { openVoice(): void };

export function TodayAssistantDisclosure({
  ref,
  onOpenChange,
}: {
  ref: Ref<TodayVoiceHandle>;
  onOpenChange: (open: boolean) => void;
}) {
  const disclosure = useRef<HTMLDetailsElement>(null);

  useImperativeHandle(
    ref,
    () => ({
      openVoice() {
        const panel = disclosure.current;
        if (!panel) return;
        panel.open = true;
        onOpenChange(true);
        const composer = panel.querySelector('form[aria-label="傳送問題"]') ?? panel;
        const microphone = composer.querySelector<HTMLButtonElement>(
          '[data-voice-input]:not(:disabled)',
        );
        if (microphone) {
          microphone.focus();
          if (microphone.getAttribute('aria-pressed') === 'false') microphone.click();
          return;
        }
        const field = composer.querySelector<HTMLElement>(
          'textarea:not(:disabled), input[type="search"]',
        );
        (field ?? panel.querySelector('summary'))?.focus();
      },
    }),
    [onOpenChange],
  );

  return (
    <details
      ref={disclosure}
      id="today-voice-entry"
      className={styles.disclosure}
      onToggle={({ currentTarget: panel, target }) => {
        if (target !== panel) return;
        onOpenChange(panel.open);
        if (panel.open) return;
        panel
          .querySelectorAll<HTMLButtonElement>(
            '[data-voice-input][aria-pressed="true"], [data-voice-playback][aria-pressed="true"]',
          )
          .forEach((button) => button.click());
      }}
    >
      <summary className={styles.trigger}>
        <CampusIcon name="social" size={20} />
        <strong>校園助理</strong>
        <span className={styles.triggerHint}>打字或語音詢問</span>
      </summary>
      <div className={styles.body}>
        <TodayCampusEntry />
      </div>
    </details>
  );
}
