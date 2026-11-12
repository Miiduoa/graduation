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
  exceedsStudyBackupByteLimit,
  courseStudyProgressFilename,
  parseCourseStudyProgress,
  serializeCourseStudyProgress,
  type CourseStudyProgressData,
  type CourseStudyProgressScope,
} from './courseStudyProgress';
import styles from './CourseStudyPanel.module.css';

type Material = { id: string; title: string; body: string };
type Props = { courseTitle: string; scope: CourseStudyProgressScope; material?: Material; selectionSerial?: number; onClose: () => void };
type RestorePreview = { filename: string; progress: CourseStudyProgressData; round: StudyPracticeRound | null; origin: 'file' | 'paste' };
type PendingSource = { source: StudySource; clearPaste: boolean };
type ManualCopyKind = 'notes' | 'practice' | 'reading-progress' | 'practice-progress';

const MANUAL_COPY_LABELS: Record<ManualCopyKind, { region: string; field: string }> = {
  notes: { region: '手動複製本次筆記', field: '可選取的本次筆記文字' },
  practice: { region: '手動複製本輪紀錄', field: '可選取的本輪紀錄文字' },
  'reading-progress': { region: '手動複製閱讀進度 JSON', field: '可選取的閱讀進度 JSON' },
  'practice-progress': { region: '手動複製練習與閱讀進度 JSON', field: '可選取的練習與閱讀進度 JSON' },
};

// Mobile browsers and embedded WebViews may throw SecurityError merely when
// reading navigator.clipboard or clipboard.writeText. Fall back to a selectable
// local snapshot instead of losing the student's export before a write starts.
function studyClipboardWriter(): ((text: string) => Promise<void>) | null {
  try {
    const clipboard = navigator.clipboard;
    return typeof clipboard?.writeText === 'function'
      ? (text: string) => clipboard.writeText(text)
      : null;
  } catch {
    return null;
  }
}

// iOS/WebKit can ignore or reject textarea.select() on a readonly backup.
// Apply an explicit range as well; if either API fails, leave the original
// local text available for long-press selection rather than losing the backup.
function selectManualCopyText(input: HTMLTextAreaElement) {
  try { input.select(); } catch { /* Try a direct selection range below. */ }
  try { input.setSelectionRange(0, input.value.length); }
  catch { /* The student can still select the unchanged text manually. */ }
}

function initialMaterial(material?: Material): { source: StudySource | null; error: string } {
  if (!material?.body.trim()) return { source: null, error: '' };
  try {
    return { source: studySourceFromText({ id: material.id, title: material.title, text: material.body }), error: '' };
  } catch (error) {
    return { source: null, error: error instanceof Error ? error.message : '這份教材無法讀取。' };
  }
}

export function CourseStudyPanel(props: Props) {
  return <StudySessionPanel key={JSON.stringify([props.scope.platformAccountId, props.scope.workspaceId])} {...props} />;
}

function decodeStudyBackup(text: string, scope: CourseStudyProgressScope) {
  return isStudyPracticeCheckpoint(text)
    ? parseStudyPracticeCheckpoint(text, scope)
    : { progress: parseCourseStudyProgress(text, scope), round: null };
}

type StudyTextEncoding = 'utf-8' | 'big5';

// File.text() uses replacement decoding. Malformed UTF-8 could otherwise
// silently become U+FFFD inside a lesson or a personal progress backup.
// Recheck the original bytes only when the decoded text contains U+FFFD:
// a genuinely authored replacement glyph is still valid UTF-8 and must work.
async function readStudyUtf8File(file: File, purpose: '教材' | '進度備份'): Promise<string> {
  const text = await file.text();
  if (text.includes('\uFFFD')) {
    try {
      new TextDecoder('utf-8', { fatal: true }).decode(await file.arrayBuffer());
    } catch {
      throw new Error(`這份${purpose}含有無法解碼的 UTF-8 位元組，尚未載入。請確認文字編碼；原教材與筆記仍保留。`);
    }
  }
  return text;
}

// Legacy Taiwanese course notes may use Big5. Decode only when the student
// explicitly selects it; do not guess and silently replace invalid bytes.
async function readStudyTextFile(file: File, encoding: StudyTextEncoding): Promise<string> {
  if (encoding === 'utf-8') return readStudyUtf8File(file, '教材');
  try {
    return new TextDecoder('big5', { fatal: true }).decode(await file.arrayBuffer());
  } catch {
    throw new Error('無法以繁體中文 Big5 讀取此檔案；原教材與筆記仍保留。請確認檔案編碼，或轉成 UTF-8 後重試。');
  }
}

function StudySessionPanel({ courseTitle, scope, material, selectionSerial, onClose }: Props) {
  const [initial] = useState(() => initialMaterial(material));
  const previousAuthorizedMaterial = useRef({ material, selectionSerial });
  const [source, setSource] = useState<StudySource | null>(initial.source);
  const [sectionIndex, setSectionIndex] = useState(0);
  const [passageIndex, setPassageIndex] = useState(0);
  const [session, setSession] = useState<StudySessionMemory>({ revision: 0, passages: {} });
  const [practiceRound, setPracticeRound] = useState<StudyPracticeRound | null>(null);
  const [pausedRound, setPausedRound] = useState<StudyPracticeRound | null>(null);
  const [pendingPracticeAction, setPendingPracticeAction] = useState<'replace' | 'discard' | null>(null);
  const revision = useRef(0);
  const [mode, setMode] = useState<StudyMode>('understand');
  const [paste, setPaste] = useState('');
  const [textEncoding, setTextEncoding] = useState<StudyTextEncoding>('utf-8');
  const [progressPaste, setProgressPaste] = useState('');
  const [reading, setReading] = useState<'source' | 'progress' | null>(null);
  const [restorePreview, setRestorePreview] = useState<RestorePreview | null>(null);
  const [restoredFile, setRestoredFile] = useState<string | null>(null);
  const [error, setError] = useState(initial.error);
  const [downloadStatus, setDownloadStatus] = useState('');
  // Anchor.click() can return normally while a mobile WebView silently drops the file.
  // Keep the exact in-memory export available for an explicit manual rescue.
  const [downloadBackup, setDownloadBackup] = useState<{ text: string; kind: ManualCopyKind } | null>(null);
  const [downloadError, setDownloadError] = useState('');
  const [confirmClose, setConfirmClose] = useState(false);
  const [pendingSource, setPendingSource] = useState<PendingSource | null>(null);
  const [manualCopyText, setManualCopyText] = useState<string | null>(null);
  const [manualCopyKind, setManualCopyKind] = useState<ManualCopyKind>('notes');
  const downloadUrl = useRef<string | null>(null);
  const manualCopyInput = useRef<HTMLTextAreaElement>(null);
  const manualCopyReturnTarget = useRef<HTMLElement | null>(null);
  const restoreManualCopyFocus = useRef(false);
  const copyRequest = useRef(0);
  const heading = useRef<HTMLHeadingElement>(null);
  const closeButton = useRef<HTMLButtonElement>(null);
  const closeHeading = useRef<HTMLHeadingElement>(null);
  const replaceHeading = useRef<HTMLHeadingElement>(null);
  const replacementReturnTarget = useRef<HTMLElement | null>(null);
  const practiceConfirmHeading = useRef<HTMLHeadingElement>(null);
  const startPracticeButton = useRef<HTMLButtonElement>(null);
  const endPausedPracticeButton = useRef<HTMLButtonElement>(null);
  const sourceInput = useRef<HTMLInputElement>(null);
  const pasteStart = useRef<HTMLButtonElement>(null);
  const latestSourceState = useRef({ hasSource: false, hasStudyChanges: false, hasProgressPaste: false });
  const readingFocus = useRef<HTMLDivElement>(null);
  const focusReadingOnReturn = useRef(false);
  const restoreHeading = useRef<HTMLHeadingElement>(null);
  const progressInput = useRef<HTMLInputElement>(null);
  const progressSummary = useRef<HTMLElement>(null);
  const sourceSummary = useRef<HTMLElement>(null);
  const importReturnFocus = useRef<'source' | 'progress' | null>(null);
  const progressPastePreviewButton = useRef<HTMLButtonElement>(null);
  const read = useRef<AbortController | null>(null);
  const inputId = useId();
  const encodingId = useId();
  const progressInputId = useId();
  const progressPasteId = useId();
  const pasteId = useId();
  const manualCopyId = useId();
  const sectionId = useId();
  const modeId = useId();
  const headingId = useId();
  const closeHeadingId = useId();
  const replaceHeadingId = useId();
  const practiceConfirmHeadingId = useId();
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
  // Include unsent questions and active practice: importing a new source would otherwise erase them.
  // Even a changed reading position, mode, or whitespace-only draft is unsaved work.
  const hasStudyChanges = !!practiceRound || !!pausedRound ||
    (!!source && (sectionIndex !== 0 || passageIndex !== 0 || mode !== 'understand')) ||
    Object.values(session.passages).some((item) =>
      item.note.length > 0 || item.needsReview || Object.values(item.modes).some((value) =>
        value.question.length > 0 || value.lessons.length > 0));
  const hasWorkToKeep = paste.length > 0 || progressPaste.length > 0 || hasStudyChanges;
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
    invalidateCopyFeedback();
    focusReadingOnReturn.current = true;
    setSectionIndex(target.sectionNumber);
    setPassageIndex(target.partNumber);
  }

  function moveReview(direction: 'previous' | 'next') {
    const target = adjacentStudyReview(reviewPassages, { sectionNumber: sectionIndex, partNumber: passageIndex }, direction);
    if (!target) return;
    invalidateCopyFeedback();
    focusReadingOnReturn.current = true;
    setSectionIndex(target.sectionNumber);
    setPassageIndex(target.partNumber);
  }

  function beginPractice() {
    const round = startStudyPracticeRound(session.revision, mode, practiceDeck.cards);
    if (!round) return;
    setPracticeRound(round);
    setPausedRound(null);
    setPendingPracticeAction(null);
    clearDownload();
  }

  function startPractice() {
    // A paused round can still contain unexported answers even if another mode is selected.
    if (pausedRound?.revision === session.revision) {
      setPendingPracticeAction('replace');
      return;
    }
    beginPractice();
  }

  function changePractice(action: StudyPracticeAction) {
    // A copied snapshot must not linger after an answer, hint or question changes.
    invalidateCopyFeedback();
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
    setPausedRound(practiceRound);
    setPracticeRound(null);
    clearDownload();
  }

  function resumePractice() {
    if (!pausedRound || pausedRound.revision !== session.revision) return;
    setMode(pausedRound.mode);
    setPracticeRound(pausedRound);
    setPausedRound(null);
    setPendingPracticeAction(null);
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
    if (confirmClose) closeHeading.current?.focus();
  }, [confirmClose]);

  // Protect unsaved reading position, notes and practice on page reload/close.
  // Some mobile browsers suppress beforeunload prompts; this does not save anything.
  useEffect(() => {
    if (!hasWorkToKeep) return;
    const confirmLeaving = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', confirmLeaving);
    return () => window.removeEventListener('beforeunload', confirmLeaving);
  }, [hasWorkToKeep]);

  // File.text()/PDF parsing is async: read the latest committed study state, not a stale closure.
  // React refs must be updated in an effect, never during render.
  useEffect(() => {
    latestSourceState.current = { hasSource: !!source, hasStudyChanges, hasProgressPaste: progressPaste.length > 0 };
  }, [source, hasStudyChanges, progressPaste]);

  useEffect(() => {
    if (pendingSource) {
      replaceHeading.current?.focus();
      return;
    }
    // Restore focus after React removes the confirmation and its active element.
    const trigger = replacementReturnTarget.current;
    if (!trigger) return;
    replacementReturnTarget.current = null;
    if (trigger.isConnected && trigger.closest('details')?.hasAttribute('open')) trigger.focus();
    else sourceSummary.current?.focus();
  }, [pendingSource]);

  useEffect(() => {
    if (pendingPracticeAction) practiceConfirmHeading.current?.focus();
  }, [pendingPracticeAction]);

  // Restore focus only after the fallback has unmounted. Focusing its trigger
  // inside the close handler can be undone when React removes the active button.
  useEffect(() => {
    if (manualCopyText !== null) {
      // Select the snapshot once when the fallback first appears. Mobile
      // app switching, tapping controls or returning from screen-reader
      // navigation must not reset a manually selected excerpt.
      const input = manualCopyInput.current;
      if (input) {
        input.focus();
        selectManualCopyText(input);
      }
      return;
    }
    if (!restoreManualCopyFocus.current) return;
    restoreManualCopyFocus.current = false;
    const target = manualCopyReturnTarget.current;
    (target?.isConnected ? target : heading.current)?.focus();
    manualCopyReturnTarget.current = null;
  }, [manualCopyText]);

  // A cancelled/failed import removes its status button. Return focus to the
  // file picker if its details are open, otherwise to the visible summary.
  useEffect(() => {
    if (reading || !importReturnFocus.current) return;
    const from = importReturnFocus.current;
    importReturnFocus.current = null;
    const picker = from === 'progress' ? progressInput.current : sourceInput.current;
    const summary = from === 'progress' ? progressSummary.current : sourceSummary.current;
    if (picker?.closest('details')?.hasAttribute('open')) picker.focus();
    else summary?.focus();
  }, [reading]);

  // The practice action buttons disappear when returning to a passage. Move
  // keyboard/screen-reader focus to the newly visible source instead of body.
  // Ordinary select changes keep focus on their control for keyboard users.
  useEffect(() => {
    if (!focusReadingOnReturn.current || reading || practiceRound) return;
    focusReadingOnReturn.current = false;
    (readingFocus.current ?? heading.current)?.focus();
  }, [reading, practiceRound, source, sectionIndex, passageIndex]);

  // Invalidate an outstanding clipboard result whenever the source position or study state changes.
  function invalidateCopyFeedback() {
    copyRequest.current += 1;
    restoreManualCopyFocus.current = false;
    setManualCopyText(null);
    setDownloadBackup(null);
    setDownloadStatus('');
    setDownloadError('');
  }

  function clearDownload() {
    invalidateCopyFeedback();
    if (downloadUrl.current) URL.revokeObjectURL(downloadUrl.current);
    downloadUrl.current = null;
  }

  function replaceSource(value: StudySource) {
    focusReadingOnReturn.current = true;
    setSource(value);
    setSectionIndex(0);
    setPassageIndex(0);
    revision.current += 1;
    setSession({ revision: revision.current, passages: {} });
    setPracticeRound(null);
    setPausedRound(null);
    setRestorePreview(null);
    setRestoredFile(null);
    setProgressPaste('');
    setConfirmClose(false);
    setPendingSource(null);
    setPendingPracticeAction(null);
    clearDownload();
    setError('');
  }

  // Keep the current notes and practice until the learner explicitly accepts a replacement.
  function requestSourceReplacement(value: StudySource, clearPaste: boolean) {
    if ((latestSourceState.current.hasSource && latestSourceState.current.hasStudyChanges)
      || latestSourceState.current.hasProgressPaste) {
      setPendingSource({ source: value, clearPaste });
      return;
    }
    replaceSource(value);
    if (clearPaste) setPaste('');
  }

  // Course selection may change while this panel stays mounted under the same
  // account/course key. Never silently keep showing a previously selected lesson.
  // Compare actual content, not just id: the same material id may be updated.
  useEffect(() => {
    const previous = previousAuthorizedMaterial.current;
    previousAuthorizedMaterial.current = { material, selectionSerial };
    if (!material?.body.trim()) return;
    // An explicit new click reopens a cancelled replacement even for the same item.
    if (previous.selectionSerial === selectionSerial &&
      previous.material?.id === material.id && previous.material?.title === material.title &&
      previous.material?.body === material.body) return;

    // A newly selected authorized source supersedes a pending local file read.
    // A late file result must not overwrite the newer selection.
    read.current?.abort();
    read.current = null;
    setReading(null);
    importReturnFocus.current = null;
    const next = initialMaterial(material);
    if (next.source) requestSourceReplacement(next.source, false);
    else setError(next.error);
    // requestSourceReplacement has render-local closures; the content comparison
    // above makes effect reruns after state updates harmless.
  }, [material, selectionSerial, requestSourceReplacement]);

  function downloadFile(contents: () => { blob: Blob; text: string; kind: ManualCopyKind }, filename: string, label: string) {
    // A successful download supersedes an older clipboard fallback. If mobile
    // download is blocked, keep that already validated, manually selectable
    // snapshot instead of removing the student's only accessible backup.
    const previousManualCopy = manualCopyText;
    const previousManualKind = manualCopyKind;
    invalidateCopyFeedback();
    let url: string | null = null;
    let preparedFallback: { text: string; kind: ManualCopyKind } | null = null;
    const link = document.createElement('a');
    try {
      const prepared = contents();
      preparedFallback = { text: prepared.text, kind: prepared.kind };
      url = URL.createObjectURL(prepared.blob);
      link.href = url;
      link.download = filename;
      link.hidden = true;
      document.body.append(link);
      link.click();
      if (downloadUrl.current) URL.revokeObjectURL(downloadUrl.current);
      downloadUrl.current = url;
      setDownloadBackup(preparedFallback);
      setDownloadStatus(`已交給瀏覽器下載${label}；若沒有出現檔案，可改用下方手動備份。`);
    } catch {
      if (url) URL.revokeObjectURL(url);
      if (previousManualCopy !== null) {
        // A previously selected excerpt must remain mounted and retain the
        // learner's selection when a second download attempt fails.
        setManualCopyKind(previousManualKind);
        setManualCopyText(previousManualCopy);
      } else if (preparedFallback) {
        // A first-time blocked download still yields the exact TXT/JSON
        // export as selectable local text, without requiring another action.
        setManualCopyKind(preparedFallback.kind);
        setManualCopyText(preparedFallback.text);
      }
      setDownloadError(previousManualCopy !== null
        ? '目前無法下載；先前可手動選取的備份仍保留，可複製文字或重試下載。'
        : preparedFallback
          ? '目前無法下載；已在下方提供完整可選取的備份文字，請手動複製保存。'
          : '目前無法下載，筆記仍保留在白板中，可重試或先複製需要的文字。');
    } finally {
      link.remove();
    }
  }

  function downloadNotes() {
    if (!source || !hasNotes) return;
    downloadFile(() => {
      const text = buildCourseStudyNotes(courseTitle, source, session.passages);
      return { blob: new Blob(['\uFEFF', text], { type: 'text/plain;charset=utf-8' }), text, kind: 'notes' };
    }, courseStudyNotesFilename(source.title), '本次筆記');
  }

  async function copyNotes() {
    if (!source || !hasNotes) return;
    manualCopyReturnTarget.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const request = ++copyRequest.current;
    const text = buildCourseStudyNotes(courseTitle, source, session.passages);
    setDownloadBackup(null);
    setDownloadStatus('');
    setDownloadError('');
    setManualCopyText(null);
    const writeText = studyClipboardWriter();
    if (!writeText) {
      setManualCopyKind('notes');
      setManualCopyText(text);
      setDownloadError('這個瀏覽器無法直接複製筆記，請在下方選取文字手動複製，或下載 TXT。');
      return;
    }
    try {
      await writeText(text);
      if (copyRequest.current === request) {
        setDownloadStatus('已複製本次筆記到剪貼簿；內容含教材及個人筆記，請留意貼上位置。');
      }
    } catch {
      if (copyRequest.current === request) {
        setManualCopyKind('notes');
        setManualCopyText(text);
        setDownloadError('無法存取剪貼簿，已提供手動選取的筆記；內容仍保留在白板，也可下載 TXT。');
      }
    }
  }

  function downloadPractice() {
    if (!source || !practiceRound) return;
    downloadFile(() => {
      const text = buildCourseStudyPracticeNotes(courseTitle, source.title, practiceRound);
      return { blob: new Blob(['\uFEFF', text], { type: 'text/plain;charset=utf-8' }), text, kind: 'practice' };
    }, courseStudyPracticeFilename(source.title), '本輪練習紀錄');
  }

  async function copyPracticeNotes() {
    if (!source || !practiceRound || practiceRound.revision !== session.revision) return;
    manualCopyReturnTarget.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const request = ++copyRequest.current;
    // Snapshot exactly the current user-visible disclosures at the click.
    const text = buildCourseStudyPracticeNotes(courseTitle, source.title, practiceRound);
    setDownloadBackup(null);
    setDownloadStatus('');
    setDownloadError('');
    setManualCopyText(null);
    const writeText = studyClipboardWriter();
    if (!writeText) {
      setManualCopyKind('practice');
      setManualCopyText(text);
      setDownloadError('這個瀏覽器無法直接複製，請在下方選取文字手動複製，或下載 TXT／JSON。');
      return;
    }
    try {
      await writeText(text);
      if (copyRequest.current === request) {
        setDownloadStatus('已複製本輪練習紀錄到剪貼簿；內容含個人作答，請留意貼上位置。');
      }
    } catch {
      if (copyRequest.current === request) {
        setManualCopyKind('practice');
        setManualCopyText(text);
        setDownloadError('無法存取剪貼簿，已提供手動選取的文字；本輪試答仍保留，也可下載 TXT／JSON。');
      }
    }
  }

  // The JSON is the same validated payload as the download, never a reduced notes export.
  // A user gesture is required for clipboard access; failed writes keep a selectable local copy.
  async function copyProgressText(text: string, kind: 'reading-progress' | 'practice-progress') {
    manualCopyReturnTarget.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const request = ++copyRequest.current;
    setManualCopyText(null);
    setDownloadBackup(null);
    setDownloadStatus('');
    setDownloadError('');
    const fallback = () => {
      setManualCopyKind(kind);
      setManualCopyText(text);
      setDownloadError('無法直接複製進度 JSON。請選取下方文字，貼到純文字編輯器並儲存為 .json；原本學習內容仍保留。');
    };
    const writeText = studyClipboardWriter();
    if (!writeText) { fallback(); return; }
    try {
      await writeText(text);
      if (copyRequest.current === request) {
        setDownloadStatus('已複製完整進度 JSON；請貼入純文字檔並儲存為 .json。內容含教材、筆記與參考回答，請勿公開分享。');
      }
    } catch {
      if (copyRequest.current === request) fallback();
    }
  }

  // Some mobile browsers deny the first clipboard request until permissions or
  // app focus change. Retry only after another explicit tap, using the exact
  // previously validated backup without regenerating or replacing the lesson.
  async function retryManualCopy() {
    const text = manualCopyText;
    if (text === null) return;
    const request = ++copyRequest.current;
    const writeText = studyClipboardWriter();
    if (!writeText) {
      setDownloadError('這個瀏覽器仍無法直接複製；請全選下方文字後使用裝置的複製功能。');
      manualCopyInput.current?.focus();
      return;
    }
    try {
      await writeText(text);
      // Editing the lesson, closing the fallback or another copy request must
      // invalidate late permission responses, including a late success.
      if (copyRequest.current !== request) return;
      restoreManualCopyFocus.current = true;
      setManualCopyText(null);
      setDownloadError('');
      setDownloadStatus(manualCopyKind === 'notes'
        ? '已複製本次筆記到剪貼簿；內容含教材及個人筆記，請留意貼上位置。'
        : manualCopyKind === 'practice'
          ? '已複製本輪練習紀錄到剪貼簿；內容含個人作答，請留意貼上位置。'
          : '已複製完整進度 JSON；請貼入純文字檔並儲存為 .json。內容含教材、筆記與參考回答，請勿公開分享。');
      // The unmount effect restores focus after the retry controls disappear.
    } catch {
      if (copyRequest.current !== request) return;
      setDownloadError('仍無法直接複製。請全選下方文字並使用裝置的複製功能；目前備份內容沒有遺失。');
      manualCopyInput.current?.focus();
    }
  }

  function copyReadingProgress() {
    if (!source) return;
    try {
      const text = serializeCourseStudyProgress({
        scope, source, position: { sectionIndex, passageIndex, mode }, passages: session.passages,
      });
      void copyProgressText(text, 'reading-progress');
    } catch (failure) {
      setDownloadError(failure instanceof Error ? failure.message : '無法整理閱讀進度；原有內容仍保留。');
    }
  }

  function copyPracticeCheckpoint(round: StudyPracticeRound | null) {
    if (!source || !round || round.revision !== session.revision) return;
    try {
      const text = serializeStudyPracticeCheckpoint({
        progress: { scope, source, position: { sectionIndex, passageIndex, mode: round.mode }, passages: session.passages },
        round,
      });
      void copyProgressText(text, 'practice-progress');
    } catch (failure) {
      setDownloadError(failure instanceof Error ? failure.message : '無法整理練習進度；本輪回答仍保留。');
    }
  }

  function savePracticeCheckpoint(round: StudyPracticeRound | null) {
    if (!source || !round || round.revision !== session.revision) return;
    let saved: string;
    try {
      saved = serializeStudyPracticeCheckpoint({
        progress: { scope, source, position: { sectionIndex, passageIndex, mode: round.mode }, passages: session.passages },
        round,
      });
    } catch (failure) {
      setDownloadStatus('');
      setDownloadError(failure instanceof Error ? failure.message : '練習進度無法整理，本輪作答仍保留。');
      return;
    }
    downloadFile(() => ({ blob: new Blob([saved], { type: 'application/json;charset=utf-8' }),
      text: saved, kind: 'practice-progress' }), courseStudyPracticeCheckpointFilename(source.title), '練習與閱讀進度');
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
    downloadFile(() => ({ blob: new Blob([text], { type: 'application/json;charset=utf-8' }),
      text, kind: 'reading-progress' }), courseStudyProgressFilename(source.title), '閱讀進度');
  }

  async function chooseProgress(file: File) {
    importReturnFocus.current = null;
    read.current?.abort();
    const controller = new AbortController();
    read.current = controller;
    setReading('progress');
    setPendingPracticeAction(null);
    setRestorePreview(null);
    setPendingSource(null);
    setError('');
    try {
      if (!/\.json$/i.test(file.name)) throw new Error('請選擇之前儲存的 nuni 讀書白板進度檔（JSON）。');
      if (!file.size || file.size > COURSE_STUDY_PROGRESS_LIMITS.bytes)
        throw new Error('請選擇有內容且不超過 8 MiB 的閱讀進度檔。');
      const text = await readStudyUtf8File(file, '進度備份');
      if (read.current !== controller || controller.signal.aborted) return;
      const { progress, round } = decodeStudyBackup(text, scope);
      setRestorePreview({ filename: file.name, progress, round, origin: 'file' });
    } catch (failure) {
      if (read.current !== controller || controller.signal.aborted) return;
      importReturnFocus.current = 'progress';
      setError(failure instanceof Error ? failure.message : '閱讀進度無法載入，目前內容仍保留。');
    } finally {
      if (read.current === controller) { read.current = null; setReading(null); }
    }
  }

  // Reject an oversized pasted lesson before React stores it. A failed paste
  // must not erase a smaller draft, notes, or the currently authorized source.
  function updatePastedSource(value: string) {
    // Even a rejected edit invalidates an earlier source replacement preview.
    setPendingSource(null);
    if (value.length > STUDY_TUTOR_LIMITS.textCharacters) {
      setError(paste.length > 0
        ? '貼上的教材超過 60,000 字元；未採用新文字。輸入框仍保留先前的草稿，按「開始讀這份內容」會讀取原草稿。請分章後重試。'
        : '貼上的教材超過 60,000 字元；內容未加入白板。請分成較短的章節後重試。');
      return;
    }
    setPaste(value);
    setError('');
  }

  // Reject oversized clipboard content before storing it in React state.
  // Keep the previous paste intact, so a failed attempt cannot erase a backup.
  function updatePastedProgress(value: string) {
    // An earlier source-replacement confirmation cannot authorize discarding
    // a backup that the student has since edited (even if the edit is rejected).
    setPendingSource(null);
    setRestorePreview(null);
    if (exceedsStudyBackupByteLimit(value)) {
      setError('貼上的進度 JSON 超過 8 MiB；原本貼上的文字仍保留。請使用較小份的備份。');
      return;
    }
    setProgressPaste(value);
    setError('');
  }

  // A copied backup can be restored on mobile without first creating a .json file.
  // Reuse the same strict scope/format parser and preview gate as a selected file.
  function previewPastedProgress() {
    if (!progressPaste.trim() || reading) return;
    setRestorePreview(null);
    setPendingPracticeAction(null);
    setPendingSource(null);
    setError('');
    try {
      if (exceedsStudyBackupByteLimit(progressPaste))
        throw new Error('貼上的閱讀進度超過 8 MiB，請改用較小份的完整 JSON 備份。');
      const { progress, round } = decodeStudyBackup(progressPaste, scope);
      setRestorePreview({ filename: '貼上的進度 JSON', progress, round, origin: 'paste' });
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : '貼上的進度無法讀取，目前學習內容仍保留。');
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
    setPausedRound(null);
    setRestoredFile(filename);
    setRestorePreview(null);
    setConfirmClose(false);
    setPendingSource(null);
    setPendingPracticeAction(null);
    setPaste('');
    setProgressPaste('');
    clearDownload();
    setError('');
  }

  async function chooseFile(file: File) {
    importReturnFocus.current = null;
    read.current?.abort();
    const controller = new AbortController();
    read.current = controller;
    setReading('source');
    setPendingPracticeAction(null);
    setRestorePreview(null);
    setPendingSource(null);
    setError('');
    try {
      if (!/\.(pdf|txt|md)$/i.test(file.name)) throw new Error('請選擇 PDF、TXT 或 Markdown 文字檔。');
      if (!file.size || file.size > PERSONAL_IMPORT_DOCUMENT_LIMITS.bytes) throw new Error('請選擇有內容且不超過 8 MiB 的檔案。');
      // At most three UTF-8 bytes (or two Big5 bytes) per UTF-16 code unit, plus an optional BOM.
      // Reject text files that cannot possibly fit before decoding them on a phone.
      if (!/\.pdf$/i.test(file.name) && file.size > STUDY_TUTOR_LIMITS.textCharacters * 3 + 3)
        throw new Error('TXT／Markdown 檔案超過 60,000 字元的可讀取範圍，尚未載入內容。請分章後重試。');
      const value = /\.pdf$/i.test(file.name)
        ? studySourceFromDocument(await readPersonalImportDocumentFile(file, controller.signal))
        : studySourceFromText({ id: 'local-text', title: file.name, text: await readStudyTextFile(file, textEncoding) });
      if (read.current !== controller || controller.signal.aborted) return;
      requestSourceReplacement(value, false);
    } catch (failure) {
      if (read.current !== controller || controller.signal.aborted) return;
      importReturnFocus.current = 'source';
      setError(failure instanceof Error ? failure.message : '檔案未能讀取，請重試。');
    } finally {
      if (read.current === controller) { read.current = null; setReading(null); }
    }
  }

  function cancelRead() {
    importReturnFocus.current = reading;
    focusReadingOnReturn.current = false;
    read.current?.abort();
    read.current = null;
    setReading(null);
  }

  return (
    <section className={styles.root} aria-labelledby={headingId}>
      <header className={styles.heading}>
        <div><p className={styles.eyebrow}>{courseTitle}</p><h3 id={headingId} ref={heading} tabIndex={-1}>讀書白板</h3></div>
        <button ref={closeButton} type="button" className={styles.button}
          onClick={() => {
            if (!hasWorkToKeep) { onClose(); return; }
            setConfirmClose(true);
          }}>收起白板</button>
      </header>
      {pendingSource && <section className={styles.restorePreview} aria-labelledby={replaceHeadingId}>
        <h4 id={replaceHeadingId} ref={replaceHeading} tabIndex={-1}>要改讀另一份教材嗎？</h4>
        <p className={styles.note}>準備改讀「{pendingSource.source.title}」。確認後會取代目前教材、筆記、未送出的問題和逐題練習，且無法從這個分頁復原。需要保留請先取消並儲存閱讀或練習 JSON。</p>
        {progressPaste.length > 0 && <p className={styles.note}>尚未確認還原的進度 JSON 也會被清除。需要保留請先取消並複製這段 JSON；它不會自動儲存。</p>}
        <div className={styles.actions}>
          <button type="button" className={`${styles.button} ${styles.primary}`} onClick={() => {
            const next = pendingSource;
            replaceSource(next.source);
            if (next.clearPaste) setPaste('');
          }}>確認改讀新教材</button>
          <button type="button" className={styles.button} onClick={() => {
            replacementReturnTarget.current = pendingSource.clearPaste ? pasteStart.current : sourceInput.current;
            setPendingSource(null);
          }}>保留原本的學習內容</button>
        </div>
      </section>}
      {pendingPracticeAction && pausedRound?.revision === session.revision && <section className={styles.closeWarning}
        aria-labelledby={practiceConfirmHeadingId}>
        <h4 id={practiceConfirmHeadingId} ref={practiceConfirmHeading} tabIndex={-1}>
          {pendingPracticeAction === 'replace' ? '要取代暫停的練習嗎？' : '要結束暫停的練習嗎？'}
        </h4>
        <p className={styles.note}>這輪練習可能有尚未備份的草稿、提示、揭答與自評。
          {pendingPracticeAction === 'replace'
            ? ' 確認開始新一輪會清空原練習，並以目前讀法的題目從空白回答開始。'
            : ' 確認結束後會清除暫停的練習，但目前閱讀、筆記與待複習標記仍保留。'}
          想保留這輪作答，請先取消並儲存完整練習與閱讀進度。
        </p>
        <div className={styles.actions}>
          <button type="button" className={`${styles.button} ${styles.primary}`}
            onClick={() => {
              if (pendingPracticeAction === 'replace') beginPractice();
              else { setPausedRound(null); setPendingPracticeAction(null); clearDownload(); }
            }}>{pendingPracticeAction === 'replace' ? '確認開始新一輪' : '確認結束暫停練習'}</button>
          <button type="button" className={styles.button} onClick={() => {
            const trigger = pendingPracticeAction === 'replace' ? startPracticeButton.current : endPausedPracticeButton.current;
            setPendingPracticeAction(null);
            trigger?.focus();
          }}>取消，保留這輪練習</button>
        </div>
      </section>}
      {confirmClose && <section className={styles.closeWarning} aria-labelledby={closeHeadingId}>
        <h4 id={closeHeadingId} ref={closeHeading} tabIndex={-1}>要關閉讀書白板嗎？</h4>
        <p className={styles.note}>關閉會清除目前分頁的筆記、未送出問題與逐題練習。若要下次繼續，請先取消關閉並儲存閱讀或練習進度；下載檔案不會自動上傳。</p>
        {paste.length > 0 && <p className={styles.note}>尚未加入白板的貼上文字不包含在閱讀或練習進度備份中。若要保留，請先取消關閉並複製貼上文字；也可以先將它加入白板再另存進度，但加入新教材會取代目前的閱讀內容。</p>}
        {progressPaste.length > 0 && <p className={styles.note}>貼上的進度 JSON 尚未確認還原，關閉後會清除貼上的文字。若要保留，請先取消關閉。</p>}
        <div className={styles.actions}>
          <button type="button" className={`${styles.button} ${styles.primary}`}
            onClick={() => { setConfirmClose(false); closeButton.current?.focus(); }}>繼續讀書</button>
          <button type="button" className={styles.button} onClick={onClose}>確認關閉白板</button>
        </div>
      </section>}
      <p className={styles.intro}>{practiceRound ? '先試著回想，再核對答案與教材，找出還想加強的地方。' : '一次讀一段，對照原文，再試著用自己的話說明。'}</p>
      {!restoredFile && material && source?.id === material.id && <p className={styles.note}>已帶入「{material.title}」的教材文字。附件與外部連結的內容需另外選擇檔案或貼上文字。</p>}
      {restoredFile && <p className={styles.note} role="status">已從「{restoredFile}」還原閱讀進度。目前顯示的是進度檔中的教材副本，教材可能已更新，請對照課程內容。</p>}
      <details className={styles.import}>
        <summary ref={progressSummary}>接著上次的進度</summary>
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
          <label className={styles.field} htmlFor={progressPasteId}>貼上已備份的進度 JSON
            <textarea id={progressPasteId} rows={5} value={progressPaste} disabled={!!reading}
              onChange={(event) => updatePastedProgress(event.target.value)}
              placeholder="貼上先前複製的完整閱讀或練習進度 JSON…" />
          </label>
          <button ref={progressPastePreviewButton} type="button" className={styles.button} disabled={!!reading || !progressPaste.trim()}
            onClick={previewPastedProgress}>預覽貼上的進度</button>
          <p className={styles.note}>貼上的 JSON 只在此裝置解析，仍須通過格式、8 MiB、帳號與課程檢查，再由你確認還原。貼上不會直接覆寫目前內容，也不會傳送至伺服器。</p>
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
        <p className={styles.note}>還原會取代目前白板內容；需要保留時，可先{practiceRound || pausedRound?.revision === session.revision
          ? '儲存完整練習與閱讀進度' : '儲存目前的閱讀進度'}。檔案中的教材副本可能與最新課程不同。</p>
        <div className={styles.actions}>
          <button type="button" className={`${styles.button} ${styles.primary}`} onClick={restoreProgress}>還原這份進度</button>
          <button type="button" className={styles.button} onClick={() => {
            const trigger = restorePreview.origin === 'paste' ? progressPastePreviewButton : progressInput;
            setRestorePreview(null);
            trigger.current?.focus();
          }}>取消還原</button>
        </div>
      </section>}
      <details className={styles.import} open={!source || undefined}>
        <summary ref={sourceSummary}>{source ? '換一份講義或貼上內容' : '選擇要讀的內容'}</summary>
        <div className={styles.importBody}>
          <label className={styles.field} htmlFor={inputId}>選擇講義
            <input ref={sourceInput} id={inputId} type="file" accept=".pdf,.txt,.md,application/pdf,text/plain,text/markdown"
              disabled={!!reading} onChange={(event) => {
                const file = event.target.files?.[0];
                event.target.value = '';
                if (file) void chooseFile(file);
              }} />
          </label>
          <label className={styles.field} htmlFor={encodingId}>TXT／Markdown 文字編碼
            <select id={encodingId} value={textEncoding} disabled={!!reading}
              onChange={(event) => setTextEncoding(event.target.value as StudyTextEncoding)}>
              <option value="utf-8">UTF-8（預設）</option>
              <option value="big5">繁體中文 Big5（舊版講義）</option>
            </select>
          </label>
          <p className={styles.note}>PDF 最多 20 頁、8 MiB；文字最多 60,000 字元。舊版繁體中文文字檔若非 UTF-8，請先選 Big5 再選檔；無效 UTF-8 會拒絕載入，不以替代字元悄悄改寫教材；PDF 不受此選項影響。檔案在此裝置讀取，公式、圖表與掃描辨識結果請對照原檔。</p>
          <label className={styles.field} htmlFor={pasteId}>或貼上課文與筆記
            <textarea id={pasteId} rows={4} value={paste} disabled={!!reading}
              onChange={(event) => updatePastedSource(event.target.value)} placeholder="貼上想理解的段落…" />
          </label>
          <p className={paste.length > STUDY_TUTOR_LIMITS.textCharacters ? styles.error : styles.note}>
            {paste.length.toLocaleString('zh-TW')} / 60,000 字元{paste.length > STUDY_TUTOR_LIMITS.textCharacters ? '，請分成較短的章節；內容尚未加入白板。' : ''}
          </p>
          <button ref={pasteStart} type="button" className={styles.button} disabled={!!reading || !paste.trim() || paste.length > STUDY_TUTOR_LIMITS.textCharacters}
            onClick={() => {
              try { requestSourceReplacement(studySourceFromText({ id: 'pasted', title: '貼上的筆記', text: paste }), true); }
              catch (failure) { setError(failure instanceof Error ? failure.message : '文字無法讀取。'); }
            }}>開始讀這份內容</button>
        </div>
      </details>
      {reading && <div className={styles.actions}><p role="status">{reading === 'progress' ? '正在讀取閱讀進度…' : '正在讀取講義…'}</p><button type="button" className={styles.button} onClick={cancelRead}>取消讀取</button></div>}
      {error && <p className={styles.error} role="alert">{error}</p>}
      {!reading && source && passage && <>
        <div className={styles.sourceMeta}>
          <strong>{source.title}</strong><span>{practiceRound ? '本輪回答只在目前分頁；重新整理前請先儲存練習與閱讀進度 JSON' : '進度只在目前分頁；重新整理或關閉前請先儲存進度 JSON'}</span>
        </div>
        {!practiceRound && pausedRound?.revision === session.revision && <section className={styles.reviewList} aria-label="暫停的逐題複習">
          <h4>這輪練習已暫停</h4>
          <p className={styles.note}>可以先核對教材，再回到原本的題號、草稿和自評。此狀態只保留在目前分頁；一般閱讀進度檔不包含這輪練習。若開始另一輪練習將取代這輪草稿；關閉、更換教材或重新開始前，請先儲存完整練習備份。</p>
          <div className={styles.actions}>
            <button type="button" className={`${styles.button} ${styles.primary}`} onClick={resumePractice}>繼續這輪練習</button>
            <button type="button" className={styles.button} onClick={() => savePracticeCheckpoint(pausedRound)}>儲存暫停的練習與閱讀進度</button>
            <button type="button" className={styles.button} onClick={() => copyPracticeCheckpoint(pausedRound)}>複製暫停的練習與閱讀進度 JSON</button>
            <button ref={endPausedPracticeButton} type="button" className={styles.button}
              onClick={() => setPendingPracticeAction('discard')}>結束暫停的練習</button>
          </div>
        </section>}
        {!practiceRound && <div className={styles.actions}>
          {pausedRound?.revision !== session.revision && <>
            <button type="button" className={styles.button} onClick={saveProgress}>儲存閱讀進度</button>
            <button type="button" className={styles.button} onClick={copyReadingProgress}>複製閱讀進度 JSON</button>
          </>}
          <button type="button" className={styles.button} disabled={!hasNotes} onClick={downloadNotes}>下載本次筆記</button>
          <button type="button" className={styles.button} disabled={!hasNotes} onClick={() => { void copyNotes(); }}>複製本次筆記</button>
        </div>}
        {!practiceRound && <p className={styles.note}>進度檔可還原閱讀位置、筆記、講解、試答與問題草稿，也含練習參考回答；文字筆記方便直接閱讀。檔案未加密，請自行保管。</p>}
        {downloadStatus && <p className={styles.note} role="status">{downloadStatus}</p>}
        {downloadBackup && <button type="button" className={styles.button} onClick={() => {
          manualCopyReturnTarget.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
          setManualCopyKind(downloadBackup.kind);
          setManualCopyText(downloadBackup.text);
          setDownloadStatus('已顯示同一份下載內容的完整手動備份，可全選後自行儲存。');
        }}>沒有下載到檔案？顯示完整手動備份</button>}
        {downloadError && <p className={styles.error} role="alert">{downloadError}</p>}
        {manualCopyText !== null && <section className={styles.manualCopy}
          aria-label={MANUAL_COPY_LABELS[manualCopyKind].region}>
          <label className={styles.field} htmlFor={manualCopyId}>{MANUAL_COPY_LABELS[manualCopyKind].field}
            <textarea ref={manualCopyInput} id={manualCopyId} readOnly rows={6} value={manualCopyText} />
          </label>
          <button type="button" className={styles.button}
            onClick={() => { void retryManualCopy(); }}>再次嘗試複製到剪貼簿</button>
          <button type="button" className={styles.button} onClick={() => {
            manualCopyInput.current?.focus();
            if (manualCopyInput.current) selectManualCopyText(manualCopyInput.current);
          }}>全選上方文字</button>
          <p className={styles.note}>可長按選取文字或按「全選上方文字」，再用手機的「複製」功能。這是本機顯示，不會自動傳送或保存；
            內容可能含教材與個人試答，請注意貼上位置。</p>
          <button type="button" className={styles.button} onClick={() => {
            copyRequest.current += 1;
            restoreManualCopyFocus.current = true;
            setManualCopyText(null);
          }}>收起手動複製文字</button>
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
            onClick={() => { invalidateCopyFeedback(); focusReadingOnReturn.current = true; setSectionIndex(item.sectionNumber); setPassageIndex(item.partNumber); }}>{item.label}</button>)}</div>
          <div className={styles.actions}>
            <button ref={startPracticeButton} type="button" className={`${styles.button} ${styles.primary}`} disabled={!practiceDeck.cards.length}
              onClick={startPractice}>開始逐題複習</button>
            <span className={styles.note}>目前讀法有 {practiceDeck.cards.length} 題可練習</span>
          </div>
          {practiceDeck.missingCount > 0 && <p className={styles.note}>另有 {practiceDeck.missingCount} 段在目前讀法還沒有自我檢查題，可回到段落啟用講解後再練習。</p>}
        </section>}
        {practiceRound ? <CourseStudyPractice round={practiceRound} onAction={changePractice}
          onExit={() => readPracticeSource()} onReadSource={readPracticeSource}
          onDownload={downloadPractice} onCopy={copyPracticeNotes} onSave={() => savePracticeCheckpoint(practiceRound)}
          onCopyCheckpoint={() => copyPracticeCheckpoint(practiceRound)} /> : <>
        <div className={styles.selectors}>
          <label className={styles.field} htmlFor={sectionId}>閱讀範圍
            <select id={sectionId} value={sectionIndex} onChange={(event) => { invalidateCopyFeedback(); setSectionIndex(Number(event.target.value)); setPassageIndex(0); }}>
              {source.sections.map((item, index) => <option value={index} key={item.id}>{item.label}</option>)}
            </select>
          </label>
          <label className={styles.field} htmlFor={modeId}>這次怎麼讀
            <select id={modeId} value={mode} onChange={(event) => { invalidateCopyFeedback(); setMode(event.target.value as StudyMode); }}>
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
            onChange={(update) => {
              invalidateCopyFeedback();
              setSession((previous) => previous.revision !== session.revision ? previous : {
                ...previous,
                passages: { ...previous.passages, [passageKey]: update(previous.passages[passageKey] ?? emptyStudyPassage()) },
              });
            }} />
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
