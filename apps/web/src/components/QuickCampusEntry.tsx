'use client';

import { useSchoolLmsReadonlyEnabled } from '@/components/SchoolLmsReadonlyProvider';

import Link from 'next/link';
import { useLayoutEffect, useRef, useState } from 'react';
import type { CampusSemanticResult } from '@campus/shared/src/campusSemantic';
import { useAuth } from './AuthGuard';
import { buildCampusNavigationSearch, campusServiceHref } from '@/lib/campusNavigation';
import { useOptionalSelectedSchool } from './SelectedSchoolProvider';
import { VoiceDictationButton } from './VoiceDictationButton';
import { CampusIcon } from './CampusIcon';
import { getQuickCampusActions, QUICK_CAMPUS_EXAMPLES } from '@/lib/quickCampusActions';
import { visibleCampusServices } from '@/lib/campusServices';
import { interpretCampusRequest } from '@/lib/campusIntentClient';
import { resolvePublicCourseAssistantIntent } from '@campus/shared/src/publicCourseAssistant';
import { answerPublicCourseQuestion, type PublicCourseAssistantAnswer } from '@campus/shared/src/publicCourseAssistantClient';
import { PublicCourseAssistantResult } from './PublicCourseAssistantResult';
import styles from './QuickCampusEntry.module.css';

type Analysis = {
  scope: string;
  phrase: string;
  state: 'loading' | 'ready' | 'error';
  result?: CampusSemanticResult;
  publicAnswer?: PublicCourseAssistantAnswer;
  message?: string;
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
  const controller = useRef<AbortController | null>(null);
  const currentScope = useRef(scope);
  useLayoutEffect(() => {
    currentScope.current = scope;
    return () => {
      sequence.current += 1;
      controller.current?.abort();
    };
  }, [scope]);

  const phrase = query.trim();
  const active = analysis?.phrase === phrase && analysis.scope === scope ? analysis : null;
  const aiResult = active?.state === 'ready' ? active.result : null;
  const publicIntent = resolvePublicCourseAssistantIntent(phrase, selectedSchoolId);
  const publicAnswer = active?.state === 'ready' ? active.publicAnswer : null;
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
    controller.current?.abort();
    setAnalysis(null);
    setQuery(value.slice(0, 320));
  }

  async function analyze(input: string) {
    const text = input.trim();
    const publicRequest = resolvePublicCourseAssistantIntent(text, selectedSchoolId);
    if (!text || (!uid && !publicRequest)) return;
    controller.current?.abort();
    const activeController = new AbortController();
    controller.current = activeController;
    const request = ++sequence.current;
    const requestScope = scope;
    setAnalysis({ phrase: text, scope: requestScope, state: 'loading' });
    try {
      if (publicRequest) {
        const lookup = await answerPublicCourseQuestion({ question: text, schoolId: selectedSchoolId,
          origin: 'web', signal: activeController.signal,
          isCurrent: () => request === sequence.current && currentScope.current === requestScope });
        if (lookup) {
          if (request === sequence.current && currentScope.current === requestScope && !activeController.signal.aborted) {
            setAnalysis({ phrase: text, scope: requestScope, state: 'ready', publicAnswer: lookup });
          }
          return;
        }
      }
      if (text.length > 160) {
        setAnalysis({ phrase: text, scope: requestScope, state: 'error', message: '一般需求請縮短至 160 字以內，再送出分析。' });
        return;
      }
      const result = await interpretCampusRequest({ uid, schoolId: selectedSchoolId, utterance: text });
      if (request === sequence.current && currentScope.current === requestScope && !activeController.signal.aborted) {
        setAnalysis({ phrase: text, scope: requestScope, state: 'ready', result });
      }
    } catch {
      if (request === sequence.current && currentScope.current === requestScope && !activeController.signal.aborted) {
        setAnalysis({ phrase: text, scope: requestScope, state: 'error' });
      }
    }
  }

  function onVoiceTranscript(text: string) {
    const transcript = text.slice(0, 320);
    updateQuery(transcript);
    // Starting a speech capture is an explicit interaction; only the transcript is sent to AI.
    if (uid || resolvePublicCourseAssistantIntent(transcript, selectedSchoolId)) void analyze(transcript);
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
          maxLength={320}
          value={query}
          onChange={(event) => updateQuery(event.target.value)}
          placeholder="例如：明天沒課，想讀書再吃飯"
        />
        <VoiceDictationButton onTranscript={onVoiceTranscript} />
      </div>
      {phrase && (uid || publicIntent) ? (
        <div className={styles.aiRow}>
          <button
            type="button"
            className={styles.analyzeButton}
            disabled={active?.state === 'loading'}
            onClick={() => void analyze(phrase)}
          >
            {active?.state === 'loading' ? (publicIntent ? '正在查詢課程…' : 'AI 正在理解…') : publicIntent ? '查詢公開課程' : '用 AI 理解這句話'}
          </button>
          <span className={styles.hint}>{publicIntent ? '從校方公開資料找課，可接著查看完整課程。' : '語音完成後會自動分析轉寫文字；打字則由你決定是否送出。'}</span>
        </div>
      ) : null}
      {!phrase ? (
        <div className={styles.examples} aria-label="常用需求">
          {[...QUICK_CAMPUS_EXAMPLES, '查清大資料庫課程'].map((example) => (
            <button key={example} type="button" onClick={() => updateQuery(example)}>
              {example}
            </button>
          ))}
        </div>
      ) : (
        <div className={styles.results} aria-live="polite">
          {active?.state === 'loading' && (
            <p role="status" className={styles.hint}>{publicIntent ? '正在讀取校方公開課程…' : 'AI 正在理解你想完成的事情，不會直接執行操作。'}</p>
          )}
          {publicAnswer?.read ? <PublicCourseAssistantResult read={publicAnswer.read} /> : publicAnswer ? <p role="status">{publicAnswer.content}</p> : null}
          {aiResult?.source === 'model' && (
            <div className={styles.understanding}>
              <strong>{aiResult.status === 'clarify' ? '需要再確認一下' : 'AI 理解的需求'}</strong>
              <p>{aiResult.summary}</p>
              {aiResult.clarifyingQuestion && <p>{aiResult.clarifyingQuestion}</p>}
            </div>
          )}
          {(active?.state === 'error' || aiResult?.status === 'unavailable') && (
            <p role="status" className={styles.hint}>
              {active?.message || 'AI 暫時無法使用。以下是基本關鍵字捷徑，並非 AI 理解結果。'}
            </p>
          )}
          {!uid && !publicIntent && (
            <p className={styles.hint}>目前為基本捷徑。登入學校帳號後，可使用 AI 理解較複雜的需求。</p>
          )}
          {!publicAnswer && actions.length ? (
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
                          <span>{preview.source === 'campus-platform' ? 'nuni 資料' : '接通狀態'}：{preview.message}</span>
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
          ) : !publicAnswer && !publicIntent && aiResult?.status !== 'clarify' ? (
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
        轉寫結果可修改。語音辨識可能由瀏覽器供應商處理；公開查課只傳送校別與搜尋條件，其他 AI 分析會將轉寫文字傳給雲端模型，不會上傳本功能的錄音檔。此入口不會自行繳交、付款或更改資料。
      </p>
    </section>
  );
}
