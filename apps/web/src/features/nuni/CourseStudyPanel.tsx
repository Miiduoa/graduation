'use client';

import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { PERSONAL_IMPORT_DOCUMENT_LIMITS } from '@campus/shared/src/imports/documents';
import { readPersonalImportDocumentFile } from '@/lib/personalImportDocuments';
import {
  splitStudySection,
  studySourceFromDocument,
  studySourceFromText,
  STUDY_TUTOR_LIMITS,
  type StudyMode,
  type StudySource,
} from '@/lib/studyTutor';
import { CourseStudyPassage } from './CourseStudyPassage';
import { CourseStudyPractice } from './CourseStudyPractice';
import { emptyStudyPassage, type StudySessionMemory } from './courseStudySession';
import { adjacentStudyReview } from './courseStudyReview';
import { adjacentStudyPassage } from './courseStudyNavigation';
import {
  buildCourseStudyPracticeNotes,
  buildStudyPracticeDeck,
  courseStudyPracticeFilename,
  startStudyPracticeRound,
  updateStudyPracticeRound,
  type StudyPracticeAction,
  type StudyPracticeCard,
  type StudyPracticeRound,
} from './courseStudyPractice';
import {
  courseStudyPracticeCheckpointFilename,
  isStudyPracticeCheckpoint,
  parseStudyPracticeCheckpoint,
  serializeStudyPracticeCheckpoint,
} from './courseStudyPracticeCheckpoint';
import { buildCourseStudyNotes, courseStudyNotesFilename } from './courseStudyNotes';
import {
  COURSE_STUDY_PROGRESS_LIMITS,
  courseStudyProgressFilename,
  parseCourseStudyProgress,
  serializeCourseStudyProgress,
  type CourseStudyProgressData,
  type CourseStudyProgressScope,
} from './courseStudyProgress';
import styles from './CourseStudyPanel.module.css';

type Material = { id: string; title: string; body: string };
type Props = { courseTitle: string; scope: CourseStudyProgressScope; material?: Material; onClose: () => void };
type RestorePreview = { filename: string; progress: CourseStudyProgressData; round: StudyPracticeRound | null };

function initialMaterial(material?: Material): { source: StudySource | null; error: string } {
  if (!material?.body.trim()) return { source: null, error: '' };
  try {
    return { source: studySourceFromText({ id: material.id, title: material.title, text: material.body }), error: '' };
  } catch (error) {
    return { source: null, error: error instanceof Error ? error.message : '這份教材無法讀取。' };
  }
}

export function CourseStudyPanel(props: Props) {
  return <StudySessionPanel key={`${props.scope.platformAccountId}:${props.scope.workspaceId}`} {...props} />;
}

function StudySessionPanel({ courseTitle, scope, material, onClose }: Props) {
  const [initial] = useState(() => initialMaterial(material));
  const [source, setSource] = useState<StudySource | null>(initial.source);
  const [sectionIndex, setSectionIndex] = useState(0);
  const [passageIndex, setPassageIndex] = useState(0);
  const [session, setSession] = useState<StudySessionMemory>({ revision: 0, passages: {} });
  const [practiceRound, setPracticeRound] = useState<StudyPracticeRound | null>(null);
  const revision = useRef(0);
  const [mode, setMode] = useState<StudyMode>('understand');
  const [paste, setPaste] = useState('');
  const [reading, setReading] = useState<'source' | 'progress' | null>(null);
  const [restorePreview, setRestorePreview] = useState<RestorePreview | null>(null);
  const [restoredFile, setRestoredFile] = useState<string | null>(null);
  const [error, setError] = useState(initial.error);
  const [downloadStatus, setDownloadStatus] = useState('');
  const [downloadError, setDownloadError] = useState('');
  const [manualCopyText, setManualCopyText] = useState<string | null>(null);
  const downloadUrl = useRef<string | null>(null);
  const manualCopyInput = useRef<HTMLTextAreaElement>(null);
  const copyRequest = useRef(0);
  const heading = useRef<HTMLHeadingElement>(null);
  const readingFocus = useRef<HTMLDivElement>(null);
  const focusReadingOnReturn = useRef(false);
  const restoreHeading = useRef<HTMLHeadingElement>(null);
  const progressInput = useRef<HTMLInputElement>(null);
  const read = useRef<AbortController | null>(null);
  const inputId = useId();
  const progressInputId = useId();
  const pasteId = useId();
  const manualCopyId = useId();
  const sectionId = useId();
  const modeId = useId();
  const headingId = useId();
  const sectionPassages = useMemo(() => source?.sections.map(splitStudySection) ?? [], [source]);
  const section = source?.sections[sectionIndex];
  const passages = sectionPassages[sectionIndex] ?? [];
  const passage = passages[passageIndex];
  const passageKey = `${sectionIndex}:${passageIndex}`;
  const currentLocation = { sectionNumber: sectionIndex, partNumber: passageIndex };
  const previousPassage = adjacentStudyPassage(sectionPassages, currentLocation, 'previous');
  const nextPassage = adjacentStudyPassage(sectionPassages, currentLocation, 'next');
  const memory = session.passages[passageKey] ?? emptyStudyPassage();
  const hasNotes = Object.values(session.passages).some((item) =>
    item.note.trim() || item.needsReview || Object.values(item.modes).some((value) => value.lessons.length));
  const reviewPassages = sectionPassages.flatMap((parts, sectionNumber) =>
    parts.flatMap((part, partNumber) =>
      session.passages[`${sectionNumber}:${partNumber}`]?.needsReview
        ? [{ label: part.label, sectionNumber, partNumber }] : []));
  const currentReviewIndex = reviewPassages.findIndex((item) =>
    item.sectionNumber === sectionIndex && item.partNumber === passageIndex);
  const practiceDeck = useMemo(() => buildStudyPracticeDeck(sectionPassages, session.passages, mode),
    [sectionPassages, session.passages, mode]);

  function movePassage(target: { sectionNumber: number; partNumber: number } | null) {
    if (!target) return;
    focusReadingOnReturn.current = true;
    setSectionIndex(target.sectionNumber);
    setPassageIndex(target.partNumber);
  }

  function moveReview(direction: 'previous' | 'next') {
    const target = adjacentStudyReview(reviewPassages, { sectionNumber: sectionIndex, partNumber: passageIndex }, direction);
    if (!target) return;
    focusReadingOnReturn.current = true;
    setSectionIndex(target.sectionNumber);
    setPassageIndex(target.partNumber);
  }

  function startPractice() {
    const round = startStudyPracticeRound(session.revision, mode, practiceDeck.cards);
    if (!round) return;
    setPracticeRound(round);
    clearDownload();
  }

  function changePractice(action: StudyPracticeAction) {
    // A copied snapshot must not linger after an answer, hint or question changes.
    copyRequest.current += 1;
    setManualCopyText(null);
    setDownloadStatus('');
    setDownloadError('');
    setPracticeRound((previous) => !previous || previous.revision !== session.revision
      ? previous : updateStudyPracticeRound(previous, action));
  }

  function readPracticeSource(card?: StudyPracticeCard) {
    if (!practiceRound || practiceRound.revision !== session.revision) return;
    focusReadingOnReturn.current = true;
    const target = card ?? practiceRound.cards[practiceRound.index];
    if (target && practiceRound.cards.some((item) => item.id === target.id)) {
      setSectionIndex(target.sectionNumber);
      setPassageIndex(target.partNumber);
      setMode(practiceRound.mode);
    }
    setPracticeRound(null);
    clearDownload();
  }

  useEffect(() => {
    heading.current?.focus();
    return () => {
      read.current?.abort();
      read.current = null;
      if (downloadUrl.current) URL.revokeObjectURL(downloadUrl.current);
      downloadUrl.current = null;
    };
  }, []);

  useEffect(() => {
    if (restorePreview) restoreHeading.current?.focus();
  }, [restorePreview]);

  useEffect(() => {
    if (manualCopyText !== null) manualCopyInput.current?.focus();
  }, [manualCopyText]);

  // The practice action buttons disappear when returning to a passage. Move
  // keyboard/screen-reader focus to the newly visible source instead of body.
  // Ordinary select changes keep focus on their control for keyboard users.
  useEffect(() => {
    if (!focusReadingOnReturn.current || reading || practiceRound) return;
    focusReadingOnReturn.current = false;
    (readingFocus.current ?? heading.current)?.focus();
  }, [reading, practiceRound, source, sectionIndex, passageIndex]);

  function clearDownload() {
    copyRequest.current += 1;
    setManualCopyText(null);
    if (downloadUrl.current) URL.revokeObjectURL(downloadUrl.current);
    downloadUrl.current = null;
    setDownloadStatus('');
    setDownloadError('');
  }

  function replaceSource(value: StudySource) {
    focusReadingOnReturn.current = true;
    setSource(value);
    setSectionIndex(0);
    setPassageIndex(0);
    revision.current += 1;
    setSession({ revision: revision.current, passages: {} });
    setPracticeRound(null);
    setRestorePreview(null);
    setRestoredFile(null);
    clearDownload();
    setError('');
  }

  function downloadFile(contents: () => Blob, filename: string, label: string) {
    copyRequest.current += 1;
    setDownloadStatus('');
    setDownloadError('');
    let url: string | null = null;
    const link = document.createElement('a');
    try {
      url = URL.createObjectURL(contents());
      link.href = url;
      link.download = filename;
      link.hidden = true;
      document.body.append(link);
      link.click();
      if (downloadUrl.current) URL.revokeObjectURL(downloadUrl.current);
      downloadUrl.current = url;
      setDownloadStatus(`已交給瀏覽器下載${label}；若沒有出現檔案，請確認瀏覽器的下載設定。`);
    } catch {
      if (url) URL.revokeObjectURL(url);
      setDownloadError('目前無法下載，筆記仍保留在白板中，可重試或先複製需要的文字。');
    } finally {
      link.remove();
    }
  }

  function downloadNotes() {
    if (!source || !hasNotes) return;
    downloadFile(() => new Blob(['\uFEFF', buildCourseStudyNotes(courseTitle, source, session.passages)],
      { type: 'text/plain;charset=utf-8' }), courseStudyNotesFilename(source.title), '本次筆記');
  }

  function downloadPractice() {
    if (!source || !practiceRound) return;
    downloadFile(() => new Blob(['\uFEFF', buildCourseStudyPracticeNotes(courseTitle, source.title, practiceRound)],
      { type: 'text/plain;charset=utf-8' }), courseStudyPracticeFilename(source.title), '本輪練習紀錄');
  }

  async function copyPracticeNotes() {
    if (!source || !practiceRound || practiceRound.revision !== session.revision) return;
    const request = ++copyRequest.current;
    // Snapshot exactly the current user-visible disclosures at the click.
    const text = buildCourseStudyPracticeNotes(courseTitle, source.title, practiceRound);
    setDownloadStatus('');
    setDownloadError('');
    setManualCopyText(null);
    if (!navigator.clipboard?.writeText) {
      setManualCopyText(text);
      setDownloadError('這個瀏覽器無法直接複製，請在下方選取文字手動複製，或下載 TXT／JSON。');
      return;
    }
    try {
      await navigator.clipboard.writeText(text);
      if (copyRequest.current === request) {
        setDownloadStatus('已複製本輪練習紀錄到剪貼簿；內容含個人作答，請留意貼上位置。');
      }
    } catch {
      if (copyRequest.current === request) {
        setManualCopyText(text);
        setDownloadError('無法存取剪貼簿，已提供手動選取的文字；本輪試答仍保留，也可下載 TXT／JSON。');
      }
    }
  }

  function savePracticeCheckpoint() {
    if (!source || !practiceRound || practiceRound.revision !== session.revision) return;
    let saved: string;
    try {
      saved = serializeStudyPracticeCheckpoint({
        progress: { scope, source, position: { sectionIndex, passageIndex, mode }, passages: session.passages },
        round: practiceRound,
      });
    } catch (failure) {
      setDownloadStatus('');
      setDownloadError(failure instanceof Error ? failure.message : '練習進度無法整理，本輪作答仍保留。');
      return;
    }
    downloadFile(() => new Blob([saved], { type: 'application/json;charset=utf-8' }),
      courseStudyPracticeCheckpointFilename(source.title), '練習與閱讀進度');
  }

  function saveProgress() {
    if (!source) return;
    let text: string;
    try {
      text = serializeCourseStudyProgress({ scope, source, position: { sectionIndex, passageIndex, mode }, passages: session.passages });
    } catch (failure) {
      setDownloadStatus('');
      setDownloadError(failure instanceof Error ? failure.message : '目前無法整理閱讀進度，原本內容仍保留。');
      return;
    }
    downloadFile(() => new Blob([text], { type: 'application/json;charset=utf-8' }), courseStudyProgressFilename(source.title), '閱讀進度');
  }

  async function chooseProgress(file: File) {
    read.current?.abort();
    const controller = new AbortController();
    read.current = controller;
    setReading('progress');
    setRestorePreview(null);
    setError('');
    try {
      if (!/\.json$/i.test(file.name)) throw new Error('請選擇之前儲存的 Campus One 閱讀進度檔（JSON）。');
      if (!file.size || file.size > COURSE_STUDY_PROGRESS_LIMITS.bytes)
        throw new Error('請選擇有內容且不超過 8 MiB 的閱讀進度檔。');
      const text = await file.text();
      if (read.current !== controller || controller.signal.aborted) return;
      const { progress, round } = isStudyPracticeCheckpoint(text)
        ? parseStudyPracticeCheckpoint(text, scope)
        : { progress: parseCourseStudyProgress(text, scope), round: null };
      setRestorePreview({ filename: file.name, progress, round });
    } catch (failure) {
      if (read.current !== controller || controller.signal.aborted) return;
      setError(failure instanceof Error ? failure.message : '閱讀進度無法載入，目前內容仍保留。');
    } finally {
      if (read.current === controller) { read.current = null; setReading(null); }
    }
  }

  function restoreProgress() {
    if (!restorePreview) return;
    const { progress, filename, round } = restorePreview;
    focusReadingOnReturn.current = !round;
    read.current?.abort();
    read.current = null;
    setReading(null);
    setSource(progress.source);
    setSectionIndex(progress.position.sectionIndex);
    setPassageIndex(progress.position.passageIndex);
    setMode(progress.position.mode);
    revision.current += 1;
    setSession({ revision: revision.current, passages: progress.passages });
    setPracticeRound(round ? { ...round, revision: revision.current } : null);
    setRestoredFile(filename);
    setRestorePreview(null);
    setPaste('');
    clearDownload();
    setError('');
  }

  async function chooseFile(file: File) {
    read.current?.abort();
    const controller = new AbortController();
    read.current = controller;
    setReading('source');
    setRestorePreview(null);
    setError('');
    try {
      if (!/\.(pdf|txt|md)$/i.test(file.name)) throw new Error('請選擇 PDF、TXT 或 Markdown 文字檔。');
      if (!file.size || file.size > PERSONAL_IMPORT_DOCUMENT_LIMITS.bytes) throw new Error('請選擇有內容且不超過 8 MiB 的檔案。');
      const value = /\.pdf$/i.test(file.name)
        ? studySourceFromDocument(await readPersonalImportDocumentFile(file, controller.signal))
        : studySourceFromText({ id: 'local-text', title: file.name, text: await file.text() });
      if (read.current !== controller || controller.signal.aborted) return;
      replaceSource(value);
    } catch (failure) {
      if (read.current !== controller || controller.signal.aborted) return;
      setError(failure instanceof Error ? failure.message : '檔案未能讀取，請重試。');
    } finally {
      if (read.current === controller) { read.current = null; setReading(null); }
    }
  }

  function cancelRead() {
    focusReadingOnReturn.current = true;
    read.current?.abort();
    read.current = null;
    setReading(null);
  }

  return (
    <section className={styles.root} aria-labelledby={headingId}>
      <header className={styles.heading}>
        <div><p className={styles.eyebrow}>{courseTitle}</p><h3 id={headingId} ref={heading} tabIndex={-1}>讀書白板</h3></div>
        <button type="button" className={styles.button} onClick={onClose}>收起白板</button>
      </header>
      <p className={styles.intro}>{practiceRound ? '先試著回想，再核對答案與教材，找出還想加強的地方。' : '一次讀一段，對照原文，再試著用自己的話說明。'}</p>
      {!restoredFile && material && source?.id === material.id && <p className={styles.note}>已帶入「{material.title}」的教材文字。附件與外部連結的內容需另外選擇檔案或貼上文字。</p>}
      {restoredFile && <p className={styles.note} role="status">已從「{restoredFile}」還原閱讀進度。目前顯示的是進度檔中的教材副本，教材可能已更新，請對照課程內容。</p>}
      <details className={styles.import}>
        <summary>接著上次的進度</summary>
        <div className={styles.importBody}>
          <label className={styles.field} htmlFor={progressInputId}>載入閱讀進度檔
            <input ref={progressInput} id={progressInputId} type="file" accept=".campus-study.json,.campus-practice.json,.json,application/json" disabled={!!reading}
              onChange={(event) => {
                const file = event.target.files?.[0];
                event.target.value = '';
                if (file) void chooseProgress(file);
              }} />
          </label>
          <p className={styles.note}>可載入閱讀進度或逐題練習進度 JSON，先核對帳號與課程，再預覽確認。檔案未加密，含教材、筆記、講解與完整參考回答，請自行保管。</p>
        </div>
      </details>
      {restorePreview && <section className={styles.restorePreview} aria-label="閱讀進度預覽">
        <h4 ref={restoreHeading} tabIndex={-1}>{restorePreview.round ? '接著練習' : '接著讀'}「{restorePreview.progress.source.title}」</h4>
        <p className={styles.note}>{restorePreview.filename}</p>
        <dl className={styles.progressFacts}>
          <div><dt>閱讀位置</dt><dd>{restorePreview.progress.source.sections[restorePreview.progress.position.sectionIndex].label} · 第 {restorePreview.progress.position.passageIndex + 1} 段</dd></div>
          <div><dt>閱讀方式</dt><dd>{{ understand: '理解概念', exam: '考前複習', practice: '練習思路' }[restorePreview.progress.position.mode]}</dd></div>
          <div><dt>個人筆記</dt><dd>{Object.values(restorePreview.progress.passages).filter((item) => item.note.trim()).length} 段</dd></div>
          <div><dt>待複習</dt><dd>{Object.values(restorePreview.progress.passages).filter((item) => item.needsReview).length} 段</dd></div>
          {restorePreview.round && <div><dt>逐題練習</dt><dd>{restorePreview.round.finished ? '已完成' : '第 ' + (restorePreview.round.index + 1) + ' 題'}，共 {restorePreview.round.cards.length} 題</dd></div>}
        </dl>
        <p className={styles.note}>還原會取代目前白板內容；需要保留時，可先{practiceRound ? '儲存本輪練習與閱讀進度' : '儲存目前的閱讀進度'}。檔案中的教材副本可能與最新課程不同。</p>
        <div className={styles.actions}>
          <button type="button" className={`${styles.button} ${styles.primary}`} onClick={restoreProgress}>還原這份進度</button>
          <button type="button" className={styles.button} onClick={() => { setRestorePreview(null); progressInput.current?.focus(); }}>取消還原</button>
        </div>
      </section>}
      <details className={styles.import} open={!source || undefined}>
        <summary>{source ? '換一份講義或貼上內容' : '選擇要讀的內容'}</summary>
        <div className={styles.importBody}>
          <label className={styles.field} htmlFor={inputId}>選擇講義
            <input id={inputId} type="file" accept=".pdf,.txt,.md,application/pdf,text/plain,text/markdown"
              disabled={!!reading} onChange={(event) => {
                const file = event.target.files?.[0];
                event.target.value = '';
                if (file) void chooseFile(file);
              }} />
          </label>
          <p className={styles.note}>PDF 最多 20 頁、8 MiB；文字最多 60,000 字元。檔案在此裝置讀取，公式、圖表與掃描辨識結果請對照原檔。</p>
          <label className={styles.field} htmlFor={pasteId}>或貼上課文與筆記
            <textarea id={pasteId} rows={4} value={paste} disabled={!!reading}
              onChange={(event) => setPaste(event.target.value)} placeholder="貼上想理解的段落…" />
          </label>
          <p className={paste.length > STUDY_TUTOR_LIMITS.textCharacters ? styles.error : styles.note}>
            {paste.length.toLocaleString('zh-TW')} / 60,000 字元{paste.length > STUDY_TUTOR_LIMITS.textCharacters ? '，請分成較短的章節；內容尚未加入白板。' : ''}
          </p>
          <button type="button" className={styles.button} disabled={!!reading || !paste.trim() || paste.length > STUDY_TUTOR_LIMITS.textCharacters}
            onClick={() => {
              try { replaceSource(studySourceFromText({ id: 'pasted', title: '貼上的筆記', text: paste })); setPaste(''); }
              catch (failure) { setError(failure instanceof Error ? failure.message : '文字無法讀取。'); }
            }}>開始讀這份內容</button>
        </div>
      </details>
      {reading && <div className={styles.actions}><p role="status">{reading === 'progress' ? '正在讀取閱讀進度…' : '正在讀取講義…'}</p><button type="button" className={styles.button} onClick={cancelRead}>取消讀取</button></div>}
      {error && <p className={styles.error} role="alert">{error}</p>}
      {!reading && source && passage && <>
        <div className={styles.sourceMeta}>
          <strong>{source.title}</strong><span>{practiceRound ? '本輪回答獨立保留，離開前可下載練習紀錄' : '關閉後會清除，想下次繼續可先儲存閱讀進度'}</span>
        </div>
        {!practiceRound && <div className={styles.actions}>
          <button type="button" className={styles.button} onClick={saveProgress}>儲存閱讀進度</button>
          <button type="button" className={styles.button} disabled={!hasNotes} onClick={downloadNotes}>下載本次筆記</button>
        </div>}
        {!practiceRound && <p className={styles.note}>進度檔可還原閱讀位置、筆記、講解、試答與問題草稿，也含練習參考回答；文字筆記方便直接閱讀。檔案未加密，請自行保管。</p>}
        {downloadStatus && <p className={styles.note} role="status">{downloadStatus}</p>}
        {downloadError && <p className={styles.error} role="alert">{downloadError}</p>}
        {practiceRound && manualCopyText !== null && <section className={styles.manualCopy} aria-label="手動複製本輪紀錄">
          <label className={styles.field} htmlFor={manualCopyId}>手動複製本輪紀錄
            <textarea ref={manualCopyInput} id={manualCopyId} readOnly rows={6} value={manualCopyText}
              onFocus={(event) => event.currentTarget.select()}
              onClick={(event) => event.currentTarget.select()} />
          </label>
          <p className={styles.note}>可長按選取文字，再用手機的「複製」功能。這是本機顯示，不會自動傳送或保存；
            內容可能含教材與個人試答，請注意貼上位置。</p>
          <button type="button" className={styles.button} onClick={() => setManualCopyText(null)}>收起手動複製文字</button>
        </section>}
        {source.warnings.length > 0 && <details className={styles.reference}>
          <summary>來源注意事項（{source.warnings.length}）</summary>
          {source.warnings.map((warning, index) => <p key={index} className={styles.note}>{warning}</p>)}
        </details>}
        {!practiceRound && reviewPassages.length > 0 && <section className={styles.reviewList} aria-label="待複習段落">
          <h4>待複習 · {reviewPassages.length} 段</h4>
          <p className={styles.note}>依教材頁碼與段落順序循環複習；不會自動取消標記、評分或改動你的筆記。</p>
          <div className={styles.actions}>
            <button type="button" className={styles.button}
              disabled={reviewPassages.length === 1 && currentReviewIndex === 0}
              onClick={() => moveReview('previous')}>上一個待複習</button>
            <span role="status" aria-live="polite" className={styles.note}>
              {currentReviewIndex >= 0 ? `目前第 ${currentReviewIndex + 1} / ${reviewPassages.length} 段` : '目前不在待複習段落'}
            </span>
            <button type="button" className={styles.button}
              disabled={reviewPassages.length === 1 && currentReviewIndex === 0}
              onClick={() => moveReview('next')}>下一個待複習</button>
          </div>
          <div className={styles.actions}>{reviewPassages.map((item) => <button type="button" className={styles.button}
            key={`${item.sectionNumber}:${item.partNumber}`}
            aria-current={sectionIndex === item.sectionNumber && passageIndex === item.partNumber ? 'location' : undefined}
            onClick={() => { focusReadingOnReturn.current = true; setSectionIndex(item.sectionNumber); setPassageIndex(item.partNumber); }}>{item.label}</button>)}</div>
          <div className={styles.actions}>
            <button type="button" className={`${styles.button} ${styles.primary}`} disabled={!practiceDeck.cards.length}
              onClick={startPractice}>開始逐題複習</button>
            <span className={styles.note}>目前讀法有 {practiceDeck.cards.length} 題可練習</span>
          </div>
          {practiceDeck.missingCount > 0 && <p className={styles.note}>另有 {practiceDeck.missingCount} 段在目前讀法還沒有自我檢查題，可回到段落啟用講解後再練習。</p>}
        </section>}
        {practiceRound ? <CourseStudyPractice round={practiceRound} onAction={changePractice}
          onExit={() => readPracticeSource()} onReadSource={readPracticeSource}
          onDownload={downloadPractice} onCopy={copyPracticeNotes} onSave={savePracticeCheckpoint} /> : <>
        <div className={styles.selectors}>
          <label className={styles.field} htmlFor={sectionId}>閱讀範圍
            <select id={sectionId} value={sectionIndex} onChange={(event) => { setSectionIndex(Number(event.target.value)); setPassageIndex(0); }}>
              {source.sections.map((item, index) => <option value={index} key={item.id}>{item.label}</option>)}
            </select>
          </label>
          <label className={styles.field} htmlFor={modeId}>這次怎麼讀
            <select id={modeId} value={mode} onChange={(event) => setMode(event.target.value as StudyMode)}>
              <option value="understand">理解概念</option><option value="exam">考前複習</option><option value="practice">練習思路</option>
            </select>
          </label>
        </div>
        <div className={styles.board}>
          <div className={styles.stepHeading} ref={readingFocus} tabIndex={-1} role="group"
            aria-label={`目前閱讀段落：${passage.label}`}>
            <span>第 {passageIndex + 1} 段，共 {passages.length} 段</span><span>{section?.label}</span>
          </div>
          <CourseStudyPassage key={`${session.revision}:${passageKey}:${mode}`} passage={passage} mode={mode} memory={memory}
            onChange={(update) => setSession((previous) => previous.revision !== session.revision ? previous : {
              ...previous,
              passages: { ...previous.passages, [passageKey]: update(previous.passages[passageKey] ?? emptyStudyPassage()) },
            })} />
          <nav className={styles.stepNavigation} aria-label="白板段落導覽">
            <button type="button" className={styles.button} disabled={!previousPassage}
              onClick={() => movePassage(previousPassage)}>上一段</button>
            <span>{passageIndex + 1} / {passages.length}</span>
            <button type="button" className={styles.button} disabled={!nextPassage}
              onClick={() => movePassage(nextPassage)}>下一段</button>
          </nav>
        </div>
        </>}
      </>}
    </section>
  );
}
