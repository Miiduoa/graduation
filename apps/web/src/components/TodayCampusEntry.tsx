'use client';

import { lazy, Suspense, useId, useLayoutEffect, useRef, useState } from 'react';
import { useNuniSession } from '@/features/nuni/Session';
import { useClientHydrated } from '@/lib/useClientHydrated';
import { areFunctionsConfigured } from '@/lib/functionsUrl';
import { useCampusBrowseContext } from '@/lib/useCampusBrowseContext';
import { useAssistantEnabled } from './AssistantEnabledProvider';
import { useAuth } from './AuthGuard';
import { LoginLink } from './LoginLink';
import { CampusIcon } from './CampusIcon';
import { QuickCampusEntry } from './QuickCampusEntry';
import styles from './QuickCampusEntry.module.css';

const NuniConversation = lazy(async () => ({
  default: (await import('@/features/nuni/Assistant')).Conversation,
}));
const SchoolConversation = lazy(async () => ({
  default: (await import('@/app/ai-assistant/LegacyAssistant')).AssistantConversation,
}));

type Account = { kind: 'nuni'; context: string } | { kind: 'school'; uid: string };

function TodayConversation({ account, schoolId }: { account: Account; schoolId: string }) {
  const [text, setText] = useState('');
  const [nuniFreeform, setNuniFreeform] = useState(false);
  const canAsk = account.kind === 'school' ? areFunctionsConfigured() : nuniFreeform;
  const [searchOpen, setSearchOpen] = useState(false);
  const conversation = useRef<HTMLDivElement>(null);
  const searchId = useId();
  const draft = { text, setText };

  return (
    <section className={styles.entry} aria-label="今天的校園助理">
      <div>
        <div className={styles.todayHeading}>
          <h2>問校園助理</h2>
          <button
            type="button"
            className={styles.serviceToggle}
            aria-expanded={searchOpen}
            aria-controls={searchId}
            onClick={() => setSearchOpen(!searchOpen)}
          >
            <CampusIcon name="search" size={16} />找校園服務
          </button>
        </div>
        {canAsk && (
          <p className={styles.subtitle}>可以打字或開啟麥克風聽寫。聽寫時，瀏覽器可能會使用語音服務。</p>
        )}
      </div>
      <div id={searchId} hidden={!searchOpen}>
        {searchOpen && (
          <QuickCampusEntry
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
              schoolId={schoolId}
              inlineDraft={draft}
              onFreeformReady={setNuniFreeform}
            />
          ) : (
            <SchoolConversation
              userId={account.uid}
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
      ? { kind: 'nuni', context: session.context }
      : uid && !auth.error
        ? { kind: 'school', uid }
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
