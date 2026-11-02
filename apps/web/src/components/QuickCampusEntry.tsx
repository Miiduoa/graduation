'use client';

import { useSchoolLmsReadonlyEnabled } from '@/components/SchoolLmsReadonlyProvider';

import Link from 'next/link';
import { useState } from 'react';
import type { CampusSemanticResult } from '@campus/shared/src/campusSemantic';
import { useAuth } from './AuthGuard';
import { buildCampusNavigationSearch, campusServiceHref } from '@/lib/campusNavigation';
import { useOptionalSelectedSchool } from './SelectedSchoolProvider';
import { VoiceDictationButton } from './VoiceDictationButton';
import { CampusIcon } from './CampusIcon';
import { getQuickCampusActions, QUICK_CAMPUS_EXAMPLES } from '@/lib/quickCampusActions';
import { visibleCampusServices } from '@/lib/campusServices';
import { CampusIntentControl, useCampusIntentCooldown, type CampusIntentCooldown } from './CampusIntentControl';
import styles from './QuickCampusEntry.module.css';

export function QuickCampusEntry() {
  const schoolLmsEnabled = useSchoolLmsReadonlyEnabled();
  const selection = useOptionalSelectedSchool();
  const { user } = useAuth();
  const selected = selection?.selectedSchool;
  const uid = user?.uid || '';
  const cooldown = useCampusIntentCooldown(JSON.stringify([uid, selected?.id || '']));
  const selectionReady = Boolean(
    selection && !selection.loading && selection.catalogStatus === 'ready',
  );
  const selectedSchoolId = selectionReady ? selected?.id || '' : '';
  const scope = JSON.stringify([uid, selectedSchoolId, selectionReady]);
  const campusSearch = buildCampusNavigationSearch(
    null,
    selected ? { id: selected.id, code: selected.code } : null,
    Boolean(selection && !selection.loading && selection.catalogStatus === 'ready'),
  );
  return (
    <QuickCampusEntrySession
      key={scope}
      uid={uid}
      schoolId={selectedSchoolId}
      campusSearch={campusSearch}
      schoolLmsEnabled={schoolLmsEnabled}
      cooldown={cooldown}
    />
  );
}

function QuickCampusEntrySession({
  uid,
  schoolId,
  campusSearch,
  schoolLmsEnabled,
  cooldown,
}: {
  uid: string;
  schoolId: string;
  campusSearch: string;
  schoolLmsEnabled: boolean;
  cooldown: CampusIntentCooldown;
}) {
  const [query, setQuery] = useState('');
  const [aiResult, setAiResult] = useState<CampusSemanticResult | null>(null);
  const [voiceSession, setVoiceSession] = useState(0);

  const phrase = query.trim();
  const semanticActions =
    aiResult?.status === 'understood'
      ? aiResult.destinations.flatMap((href) => {
          const service = visibleCampusServices(schoolLmsEnabled).find((row) => row.href === href);
          return service ? [service] : [];
        })
      : null;
  const actions = semanticActions || getQuickCampusActions(phrase, schoolLmsEnabled);
  const route = (href: string) => campusServiceHref(href, campusSearch);
  const searchHref = route(
    '/search' + (phrase ? '?q=' + encodeURIComponent(phrase.slice(0, 100)) : ''),
  );
  const assistantHref = route('/ai-assistant?q=' + encodeURIComponent(phrase.slice(0, 4000)));

  function resetAnalysis() {
    setAiResult(null);
    setVoiceSession((value) => value + 1);
  }

  function updateQuery(value: string) {
    resetAnalysis();
    setQuery(value.slice(0, 160));
  }

  return (
    <section className={styles.entry} aria-labelledby="quick-entry-title">
      <div className={styles.heading}>
        <div>
          <p className={styles.eyebrow}>快速開始</p>
          <h2 id="quick-entry-title">說出想做的事，直接找到入口。</h2>
          <p className={styles.subtitle}>
            輸入或說出需求，先看基本捷徑；需要雲端協助時，再核對本次傳送內容。
          </p>
        </div>
        <Link className={styles.allServices} href={route('/search')}>
          所有服務 <CampusIcon name="arrow" size={16} />
        </Link>
      </div>
      <div className={styles.inputRow}>
        <label className={styles.srOnly} htmlFor="quick-campus-input">
          想做什麼？
        </label>
        <CampusIcon name="search" size={20} />
        <input
          id="quick-campus-input"
          type="search"
          autoComplete="off"
          maxLength={160}
          value={query}
          onChange={(event) => updateQuery(event.target.value)}
          placeholder="例如：明天沒課，想讀書再吃飯"
        />
        <VoiceDictationButton key={voiceSession} onTranscript={updateQuery} />
      </div>
      {phrase && uid ? (
        <CampusIntentControl
          key={query}
          uid={uid}
          schoolId={schoolId}
          utterance={query}
          cooldown={cooldown}
          onResult={setAiResult}
          onReset={resetAnalysis}
          onReview={resetAnalysis}
        />
      ) : null}
      {!phrase ? (
        <div className={styles.examples} aria-label="常用需求">
          {QUICK_CAMPUS_EXAMPLES.map((example) => (
            <button key={example} type="button" onClick={() => updateQuery(example)}>
              {example}
            </button>
          ))}
        </div>
      ) : (
        <div className={styles.results} aria-live="polite">
          {aiResult?.source === 'model' && (
            <div className={styles.understanding}>
              <strong>{aiResult.status === 'clarify' ? '需要再確認一下' : 'AI 理解的需求'}</strong>
              <p>{aiResult.summary}</p>
              {aiResult.clarifyingQuestion && <p>{aiResult.clarifyingQuestion}</p>}
            </div>
          )}
          {!uid && (
            <p className={styles.hint}>
              目前為基本捷徑。登入並選擇學校後，可核對資料再請雲端協助找入口。
            </p>
          )}
          {actions.length ? (
            <>
              <p className={styles.resultHeading}>
                {semanticActions ? 'AI 建議先開啟' : '基本快速入口'}
              </p>
              <div className={styles.actionGrid}>
                {actions.map((action) => (
                  <Link key={action.href} href={route(action.href)} className={styles.action}>
                    <span>
                      <strong>{action.name}</strong>
                      <small>{action.text}</small>
                      {aiResult?.previews
                        ?.filter((preview) => preview.destination === action.href)
                        .map((preview) => (
                          <span key={preview.destination} className={styles.serviceSnapshot}>
                            <span>
                              {preview.source === 'campus-platform'
                                ? 'nuni 資料'
                                : '接通狀態'}
                              ：{preview.message}
                            </span>
                            {preview.items.map((item, index) => (
                              <span key={index} className={styles.snapshotItem}>
                                {item.title}
                                {item.detail ? ' · ' + item.detail : ''}
                              </span>
                            ))}
                          </span>
                        ))}
                    </span>
                    <CampusIcon name="arrow" size={18} />
                  </Link>
                ))}
              </div>
            </>
          ) : aiResult?.status !== 'clarify' ? (
            <p className={styles.noMatch}>沒有找到明確入口，可以補充需求或詢問校園助理。</p>
          ) : null}
          <div className={styles.footerLinks}>
            <Link href={searchHref}>搜尋更多服務</Link>
            <Link href={assistantHref}>詢問校園助理</Link>
            <button type="button" onClick={() => updateQuery('')}>
              重新輸入
            </button>
          </div>
        </div>
      )}
      <p className={styles.privacy}>
        語音只填入可修改的文字，不會自動交給雲端助理。語音辨識本身可能由瀏覽器供應商處理；nuni
        不會另行上傳錄音檔。服務入口仍由你開啟，不會自行繳交、付款或更改資料。
      </p>
    </section>
  );
}
