'use client';

import { useSchoolLmsReadonlyEnabled } from '@/components/SchoolLmsReadonlyProvider';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import type { CampusSemanticResult } from '@campus/shared/src/campusSemantic';
import { useAuth } from './AuthGuard';
import { buildCampusNavigationSearch, campusServiceHref } from '@/lib/campusNavigation';
import { useOptionalSelectedSchool } from './SelectedSchoolProvider';
import { VoiceDictationButton } from './VoiceDictationButton';
import { CampusIcon } from './CampusIcon';
import { getQuickCampusActions, QUICK_CAMPUS_EXAMPLES } from '@/lib/quickCampusActions';
import { visibleCampusServices } from '@/lib/campusServices';
import { interpretCampusRequest } from '@/lib/campusIntentClient';
import styles from './QuickCampusEntry.module.css';

type Analysis = {
  scope: string;
  phrase: string;
  state: 'loading' | 'ready' | 'error';
  result?: CampusSemanticResult;
};

export function QuickCampusEntry() {
  const schoolLmsEnabled = useSchoolLmsReadonlyEnabled();
  const selection = useOptionalSelectedSchool();
  const { user } = useAuth();
  const selected = selection?.selectedSchool;
  const uid = user?.uid || '';
  const selectedSchoolId = selected?.id || '';
  const scope = JSON.stringify([uid, selectedSchoolId]);
  const campusSearch = buildCampusNavigationSearch(
    null,
    selected ? { id: selected.id, code: selected.code } : null,
    Boolean(selection && !selection.loading && selection.catalogStatus === 'ready'),
  );
  const [query, setQuery] = useState('');
  const [analysis, setAnalysis] = useState<Analysis | null>(null);
  const sequence = useRef(0);
  useEffect(() => () => {
    sequence.current += 1;
  }, []);

  const phrase = query.trim();
  const active = analysis?.phrase === phrase && analysis.scope === scope ? analysis : null;
  const aiResult = active?.state === 'ready' ? active.result : null;
  const semanticActions = aiResult?.status === 'understood'
    ? aiResult.destinations.flatMap((href) => {
        const service = visibleCampusServices(schoolLmsEnabled).find((row) => row.href === href);
        return service ? [service] : [];
      })
    : null;
  const actions = semanticActions || getQuickCampusActions(phrase, schoolLmsEnabled);
  const route = (href: string) => campusServiceHref(href, campusSearch);
  const searchHref = route('/search' + (phrase ? '?q=' + encodeURIComponent(phrase.slice(0, 100)) : ''));
  const assistantHref = route('/ai-assistant?q=' + encodeURIComponent(phrase.slice(0, 4000)));

  function updateQuery(value: string) {
    sequence.current += 1;
    setAnalysis(null);
    setQuery(value.slice(0, 160));
  }

  async function analyze(input: string) {
    const text = input.trim().slice(0, 160);
    if (!text || !uid) return;
    const request = ++sequence.current;
    const requestScope = scope;
    setAnalysis({ phrase: text, scope: requestScope, state: 'loading' });
    try {
      const result = await interpretCampusRequest({ uid, schoolId: selectedSchoolId, utterance: text });
      if (request === sequence.current) {
        setAnalysis({ phrase: text, scope: requestScope, state: 'ready', result });
      }
    } catch {
      if (request === sequence.current) {
        setAnalysis({ phrase: text, scope: requestScope, state: 'error' });
      }
    }
  }

  function onVoiceTranscript(text: string) {
    const transcript = text.slice(0, 160);
    updateQuery(transcript);
    // Starting a speech capture is an explicit interaction; only the transcript is sent to AI.
    if (uid) void analyze(transcript);
  }

  return (
    <section className={styles.entry} aria-labelledby="quick-entry-title">
      <div className={styles.heading}>
        <div>
          <p className={styles.eyebrow}>快速開始</p>
          <h2 id="quick-entry-title">說出想做的事，直接找到入口。</h2>
          <p className={styles.subtitle}>
            說一句話，AI 可以理解複合需求；需要修改資料時仍由你確認。
          </p>
        </div>
        <Link className={styles.allServices} href={route('/search')}>
          所有服務 <CampusIcon name="arrow" size={16} />
        </Link>
      </div>
      <div className={styles.inputRow}>
        <label className={styles.srOnly} htmlFor="quick-campus-input">想做什麼？</label>
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
        <VoiceDictationButton onTranscript={onVoiceTranscript} />
      </div>
      {phrase && uid ? (
        <div className={styles.aiRow}>
          <button
            type="button"
            className={styles.analyzeButton}
            disabled={active?.state === 'loading'}
            onClick={() => void analyze(phrase)}
          >
            {active?.state === 'loading' ? 'AI 正在理解…' : '用 AI 理解這句話'}
          </button>
          <span className={styles.hint}>語音完成後會自動分析轉寫文字；打字則由你決定是否送出。</span>
        </div>
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
          {active?.state === 'loading' && (
            <p role="status" className={styles.hint}>AI 正在理解你想完成的事情，不會直接執行操作。</p>
          )}
          {aiResult?.source === 'model' && (
            <div className={styles.understanding}>
              <strong>{aiResult.status === 'clarify' ? '需要再確認一下' : 'AI 理解的需求'}</strong>
              <p>{aiResult.summary}</p>
              {aiResult.clarifyingQuestion && <p>{aiResult.clarifyingQuestion}</p>}
            </div>
          )}
          {(active?.state === 'error' || aiResult?.status === 'unavailable') && (
            <p role="status" className={styles.hint}>
              AI 暫時無法使用。以下是基本關鍵字捷徑，並非 AI 理解結果。
            </p>
          )}
          {!uid && (
            <p className={styles.hint}>目前為基本捷徑。登入學校帳號後，可使用 AI 理解較複雜的需求。</p>
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
                      {aiResult?.previews?.filter((preview) => preview.destination === action.href).map((preview) => (
                        <span key={preview.destination} className={styles.serviceSnapshot}>
                          <span>{preview.source === 'campus-platform' ? 'Campus One 資料' : '接通狀態'}：{preview.message}</span>
                          {preview.items.map((item, index) => (
                            <span key={index} className={styles.snapshotItem}>
                              {item.title}{item.detail ? ' · ' + item.detail : ''}
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
            <button type="button" onClick={() => updateQuery('')}>重新輸入</button>
          </div>
        </div>
      )}
      <p className={styles.privacy}>
        轉寫結果可修改。語音辨識可能由瀏覽器供應商處理；使用 AI 時會將轉寫文字傳給雲端模型，不會上傳本功能的錄音檔。此入口不會自行繳交、付款或更改資料。
      </p>
    </section>
  );
}
