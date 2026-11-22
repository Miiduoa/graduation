'use client';

import { useEffect, useId, useMemo, useRef, useState } from 'react';
import type { StudyMode } from '@/lib/studyTutor';
import { STUDY_SESSION_LIMITS, hasVisibleStudyContent } from './courseStudySession';
import {
  getStudyPracticeSummary,
  hasVisibleStudyAttempt,
  nextUnassessedDraftStudyPracticeIndex,
  nextUnreviewedStudyPracticeIndex,
  previousUnassessedDraftStudyPracticeIndex,
  previousUnreviewedStudyPracticeIndex,
  type StudyPracticeAction,
  type StudyPracticeCard,
  type StudyPracticeResponse,
  type StudyPracticeRound,
} from './courseStudyPractice';
import { locateStudyEvidence } from './studyEvidence';
import styles from './CourseStudyPractice.module.css';

type Props = {
  round: StudyPracticeRound;
  onAction: (action: StudyPracticeAction) => void;
  onExit: () => void;
  onReadSource: (card: StudyPracticeCard) => void;
  onDownload: (trigger: HTMLElement) => void;
  onCopy?: (trigger: HTMLElement) => void;
  onSave?: (trigger: HTMLElement) => void;
  onCopyCheckpoint?: (trigger: HTMLElement) => void;
};

const modeLabels: Record<StudyMode, string> = {
  understand: '理解概念', exam: '考前複習', practice: '練習思路',
};

function outcomeLabel(response: StudyPracticeResponse | undefined): string {
  if (response?.outcome === 'understood') return '自評理解';
  if (response?.outcome === 'again') return '還要加強';
  if (response?.outcome === 'skipped') return '略過';
  // A saved draft is still unassessed, but should be findable before the summary.
  if (response?.outcome === null && hasVisibleStudyAttempt(response.attempt)) return '草稿待自評';
  return '未完成';
}

/**
 * A retry replaces the active round, including responses on cards that the
 * pending subset will not contain. Require an explicit second action before
 * discarding any draft, revealed answer state or self-rating.
 *
 * Kept inside the finished summary so leaving the summary also cancels a
 * pending confirmation without changing the persisted checkpoint shape.
 */
function PracticeRestartControls({ pending, onAction }: {
  pending: number;
  onAction: (action: StudyPracticeAction) => void;
}) {
  const [scope, setScope] = useState<'pending' | 'all' | null>(null);
  const pendingButton = useRef<HTMLButtonElement>(null);
  const allButton = useRef<HTMLButtonElement>(null);
  const confirmButton = useRef<HTMLButtonElement>(null);
  const warningId = useId();

  useEffect(() => {
    if (scope) confirmButton.current?.focus();
  }, [scope]);

  function cancel() {
    const returnTo = scope === 'pending' ? pendingButton.current : allButton.current;
    setScope(null);
    returnTo?.focus();
  }

  return <>
    <button ref={pendingButton} type="button" className={`${styles.button} ${styles.primary}`}
      disabled={pending === 0} onClick={() => setScope('pending')}>重練待加強題（{pending} 題）</button>
    <button ref={allButton} type="button" className={styles.button}
      onClick={() => setScope('all')}>重練本輪全部</button>
    {scope && <div className={styles.note} role="group" aria-label="確認重練">
      <p id={warningId} role="status">
        {scope === 'pending' ? '重練待加強題只會選取尚未理解的題目，' : '重練本輪全部題目，'}
        但都會取代目前整輪的草稿、已揭答狀態與自評，包括未被選入待加強題的紀錄。要保留內容，請先儲存練習進度或下載本輪紀錄。
      </p>
      <button ref={confirmButton} type="button" className={`${styles.button} ${styles.primary}`}
        aria-describedby={warningId} onClick={() => {
          const selected = scope;
          if (!selected) return;
          setScope(null);
          onAction({ type: 'restart', scope: selected });
        }}>確認重練{scope === 'pending' ? '待加強題' : '本輪全部'}</button>
      <button type="button" className={styles.button} onClick={cancel}>取消，保留本輪</button>
    </div>}
  </>;
}

export function CourseStudyPractice({ round, onAction, onExit, onReadSource, onDownload, onCopy, onSave, onCopyCheckpoint }: Props) {
  const heading = useRef<HTMLHeadingElement>(null);
  const evidenceMark = useRef<HTMLElement>(null);
  const [evidencePosition, setEvidencePosition] = useState<{ key: string; occurrence: number } | null>(null);
  const headingId = useId();
  const attemptId = useId();
  const attemptHelpId = useId();
  const hintId = useId();
  const answerId = useId();
  const card = round.cards[round.index];
  const response = card ? round.responses[card.id] : undefined;
  const summary = getStudyPracticeSummary(round);
  // Unassessed drafts are worth finishing before starting blank questions.
  // This is derived display state, never a saved self-rating or checkpoint.
  const unfinishedDraftIndices = round.cards.flatMap((item, index) => {
    const saved = round.responses[item.id];
    return saved?.outcome === null && hasVisibleStudyAttempt(saved.attempt) ? [index] : [];
  });
  const nextUnreviewedIndex = round.finished ? null : nextUnreviewedStudyPracticeIndex(round);
  const nextDraftIndex = round.finished ? null : nextUnassessedDraftStudyPracticeIndex(round);
  const previousDraftIndex = round.finished ? null : previousUnassessedDraftStudyPracticeIndex(round);
  const previousUnreviewedIndex = round.finished ? null : previousUnreviewedStudyPracticeIndex(round);
  const canRevealAnswer = !!response && hasVisibleStudyAttempt(response.attempt);
  const answerVisible = !!response?.answerVisible && canRevealAnswer;
  // A position belongs to this exact question within this practice round, not
  // to another card that happens to quote the same text.
  const evidenceKey = `${round.revision}:${round.index}:${card?.id ?? ''}`;
  const evidenceOccurrence = evidencePosition?.key === evidenceKey ? evidencePosition.occurrence : 0;
  const evidence = useMemo(() => card && response?.hintVisible
    ? locateStudyEvidence(card.sourceText, card.sourceQuote, evidenceOccurrence) : null,
  [card?.sourceText, card?.sourceQuote, response?.hintVisible, evidenceOccurrence]);

  useEffect(() => { setEvidencePosition(null); }, [evidenceKey, response?.hintVisible]);

  // Move the highlight into view without taking focus from the navigation
  // button. Editing an answer does not re-scan or scroll the source.
  useEffect(() => {
    if (!evidence || evidencePosition?.key !== evidenceKey) return;
    evidenceMark.current?.scrollIntoView?.({ block: 'nearest' });
  }, [evidence, evidenceKey, evidencePosition]);

  useEffect(() => {
    heading.current?.focus();
  }, [round.revision, round.index, round.finished, card?.id]);

  return (
    <section className={styles.root} aria-label="逐題複習">
      <div className={styles.toolbar}>
        <p className={styles.eyebrow}>逐題複習 · {modeLabels[round.mode]}</p>
        <div className={styles.actions}>
          {onSave && <button type="button" className={styles.button} onClick={(event) => onSave(event.currentTarget)}>儲存練習與閱讀進度</button>}
          {onCopyCheckpoint && <button type="button" className={styles.button} onClick={(event) => onCopyCheckpoint(event.currentTarget)}>複製練習與閱讀進度 JSON</button>}
          <button type="button" className={styles.button} onClick={(event) => onDownload(event.currentTarget)}>下載本輪練習</button>
          {onCopy && <button type="button" className={styles.button} onClick={(event) => onCopy(event.currentTarget)}>複製本輪紀錄</button>}
          <button type="button" className={styles.button} onClick={onExit}>回到閱讀</button>
        </div>
      </div>
      <p className={styles.note}>{onSave
        ? '本輪回答獨立於原本試答，可將練習與閱讀一起儲存供下次還原，也可下載純文字紀錄。進度檔未加密。'
        : '本輪回答獨立於原本試答，離開前可下載紀錄；閱讀進度檔不含本輪練習。'}</p>
      {onCopy && <p className={styles.note}>複製功能只在按下按鈕後寫入系統剪貼簿；紀錄可能含個人試答，請留意其他 App 的貼上權限。</p>}
      <p className={styles.position} role="status" aria-live="polite" aria-atomic="true">
        {round.finished ? `本輪結束，共 ${summary.total} 題` : card ? `第 ${round.index + 1} 題／共 ${summary.total} 題` : '目前沒有可練習的題目'}
      </p>

      {round.finished ? <section className={styles.summary} aria-labelledby={headingId}>
        <h4 ref={heading} id={headingId} tabIndex={-1}>本輪練習摘要</h4>
        <p className={styles.note}>以下是你的自評紀錄，不是答題正確率；未完成的題目仍可從下方回看。</p>
        <dl className={styles.facts}>
          <div><dt>自評理解</dt><dd>{summary.understood} 題</dd></div>
          <div><dt>還要加強</dt><dd>{summary.again} 題</dd></div>
          <div><dt>略過</dt><dd>{summary.skipped} 題</dd></div>
          <div><dt>未完成</dt><dd>{summary.unreviewed} 題</dd></div>
        </dl>
        {unfinishedDraftIndices.length > 0 && <p className={styles.note}>
          尚有 {unfinishedDraftIndices.length} 題已寫草稿但尚未自評；草稿不代表完成，回到題目後仍需自行對照教材。
        </p>}
        <div className={styles.actions}>
          {unfinishedDraftIndices.length > 0 && <button type="button" className={`${styles.button} ${styles.primary}`}
            onClick={() => onAction({ type: 'go', index: unfinishedDraftIndices[0] })}>
            先完成已寫草稿（{unfinishedDraftIndices.length} 題）
          </button>}
          {summary.unreviewed > 0 && <button type="button" className={`${styles.button} ${styles.primary}`}
            onClick={() => {
              const index = round.cards.findIndex((item) => round.responses[item.id]?.outcome == null);
              if (index >= 0) onAction({ type: 'go', index });
            }}>接續未自評題（{summary.unreviewed} 題）</button>}
          <PracticeRestartControls pending={summary.pending} onAction={onAction} />
        </div>
        <p className={styles.note}>
          {summary.pending > 0 ? '待加強題包含還要加強、略過與未完成的題目。' : '所有題目都已由你標記理解，仍可重練本輪全部。'}
          重練會以空白回答開始；想保留這輪內容，可先下載紀錄。
        </p>
      </section> : card && response ? <section key={`${round.revision}:${card.id}`} className={styles.card} aria-labelledby={headingId}>
        <div className={styles.questionHeading}>
          <h4 ref={heading} id={headingId} tabIndex={-1}>第 {round.index + 1} 題</h4>
          <span>{card.label} · 第 {card.lessonId} 次講解</span>
        </div>
        <p className={styles.question}>{hasVisibleStudyContent(card.question)
          ? card.question : 'AI 未提供可讀題目，請對照本段原文自行練習；也可以略過這題。'}</p>

        <button type="button" className={styles.button} aria-expanded={response.hintVisible} aria-controls={response.hintVisible ? hintId : undefined}
          onClick={() => onAction({ type: 'toggle_hint' })}>{response.hintVisible ? '收起原文提示' : '查看原文提示'}</button>
        {response.hintVisible && <section id={hintId} className={styles.hint} aria-label="本題原文提示">
          <h5>原文提示</h5>
          <blockquote className={styles.source}>
            {evidence ? <>{evidence.before}<mark ref={evidenceMark} tabIndex={-1} className={styles.highlight}>{evidence.quote}</mark>{evidence.after}</> : card.sourceText}
          </blockquote>
          {evidence && <button type="button" className={styles.button}
            onClick={() => evidenceMark.current?.focus()}>定位本題原文引句</button>}
          {evidence && evidence.occurrences > 1 && <>
            <p className={styles.note} role="status" aria-live="polite">
              相同引句在本段出現 {evidence.occurrences} 處，目前標示第 {evidenceOccurrence + 1} 處。
            </p>
            <div className={styles.actions}>
              <button type="button" className={styles.button}
                onClick={() => setEvidencePosition({ key: evidenceKey,
                  occurrence: (evidenceOccurrence + evidence.occurrences - 1) % evidence.occurrences })}>上一處相同引句</button>
              <button type="button" className={styles.button}
                onClick={() => setEvidencePosition({ key: evidenceKey,
                  occurrence: (evidenceOccurrence + 1) % evidence.occurrences })}>下一處相同引句</button>
            </div>
          </>}
          {!evidence && <p className={styles.note}>這句引文目前無法在原文定位，請回白板核對。</p>}
        </section>}

        <label className={styles.field} htmlFor={attemptId}>這一題，我的回答
          <textarea id={attemptId} rows={5} maxLength={STUDY_SESSION_LIMITS.attemptCharacters} value={response.attempt}
            aria-describedby={attemptHelpId}
            onChange={(event) => onAction({ type: 'attempt', value: event.target.value })}
            placeholder="先憑記憶回答，不確定的地方也可以寫下來。" />
        </label>
        <p id={attemptHelpId} className={styles.note}>先寫下自己的回答，再對照參考回答；修改回答會清除原自評，單純收起參考回答不會。</p>
        <button type="button" className={styles.button} disabled={!canRevealAnswer} aria-expanded={answerVisible} aria-controls={answerVisible ? answerId : undefined}
          onClick={() => onAction({ type: 'toggle_answer' })}>{answerVisible ? '收起參考回答' : '對照參考回答'}</button>
        {answerVisible && <section id={answerId} className={styles.answer} aria-label="本題參考回答">
          <h5>參考回答</h5>
          <p className={styles.answerText}>{hasVisibleStudyContent(card.answer)
             ? card.answer : 'AI 未提供可讀參考回答，請對照本段原文自行核對。'}</p>
          <p className={styles.note}>參考回答來自既有講解，可能有誤，請對照教材。由你判斷是否理解，不會自動判分。</p>
          <div className={styles.actions} role="group" aria-label="本題自評">
            <button type="button" className={styles.button}
              onClick={() => onAction({ type: 'decide', outcome: 'again' })}>還要加強</button>
            <button type="button" className={`${styles.button} ${styles.primary}`}
              onClick={() => onAction({ type: 'decide', outcome: 'understood' })}>這題已理解</button>
          </div>
        </section>}

        <nav className={styles.navigation} aria-label="練習題目導覽">
          <button type="button" className={styles.button} disabled={round.index === 0}
            onClick={() => onAction({ type: 'go', index: round.index - 1 })}>上一題</button>
          <button type="button" className={styles.button} disabled={round.index >= round.cards.length - 1}
            onClick={() => onAction({ type: 'go', index: round.index + 1 })}>下一題</button>
          <button type="button" className={styles.button} disabled={previousUnreviewedIndex === null}
            onClick={() => { if (previousUnreviewedIndex !== null) onAction({ type: 'go', index: previousUnreviewedIndex }); }}>上一題未自評</button>
          <button type="button" className={styles.button} disabled={nextUnreviewedIndex === null}
            onClick={() => { if (nextUnreviewedIndex !== null) onAction({ type: 'go', index: nextUnreviewedIndex }); }}>下一題未自評</button>
          {previousDraftIndex !== null && <button type="button" className={styles.button}
            onClick={() => onAction({ type: 'go', index: previousDraftIndex })}>上一題草稿待自評</button>}
          {nextDraftIndex !== null && <button type="button" className={styles.button}
            onClick={() => onAction({ type: 'go', index: nextDraftIndex })}>下一題草稿待自評</button>}
          <button type="button" className={styles.button} onClick={() => onReadSource(card)}>回白板看這段</button>
          {response.outcome === 'skipped'
            ? <button type="button" className={styles.button}
              onClick={() => onAction({ type: 'undo_skip' })}>取消略過，繼續作答</button>
            : <button type="button" className={styles.button} disabled={response.outcome !== null}
              onClick={() => onAction({ type: 'skip' })}>略過這題</button>}
        </nav>
        <p className={styles.note}>上一題／下一題只移動閱讀位置；「上一題未自評／下一題未自評」會依方向循環尋找其他尚未自評的題目（包含已寫草稿的題目），不會自動評分；有其他已寫但尚未自評的草稿時，可按「上一題草稿待自評／下一題草稿待自評」依方向尋找，不會跳到空白題。只有按「略過這題」才會標記略過；回到已略過的題目，可按「取消略過，繼續作答」保留草稿與原文提示。已自評的題目不會被略過覆蓋，若要重評可修改試答或重新選擇自評。</p>
      </section> : <p className={styles.note}>請回到閱讀，選擇有講解記錄的待複習段落再開始。</p>}

      <nav className={styles.overview} aria-label="本輪題目">
        <h5>本輪題目</h5>
        <ol className={styles.cardList}>
          {round.cards.map((item, index) => {
            const outcome = outcomeLabel(round.responses[item.id]);
            return <li key={item.id}>
              <button type="button" className={styles.cardButton} aria-current={!round.finished && index === round.index ? 'step' : undefined}
                aria-label={`第 ${index + 1} 題：${item.label}，${outcome}`} onClick={() => onAction({ type: 'go', index })}>
                <span className={styles.cardNumber}>第 {index + 1} 題</span>
                <span className={styles.cardLabel}>{item.label}</span>
                <span className={styles.cardOutcome}>{outcome}</span>
              </button>
            </li>;
          })}
        </ol>
      </nav>
    </section>
  );
}
