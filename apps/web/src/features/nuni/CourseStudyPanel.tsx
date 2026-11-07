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
import { emptyStudyPassage, type StudySessionMemory } from './courseStudySession';
import { buildCourseStudyNotes, courseStudyNotesFilename } from './courseStudyNotes';
import styles from './CourseStudyPanel.module.css';

type Material = { id: string; title: string; body: string };
type Props = { courseTitle: string; material?: Material; onClose: () => void };

function initialMaterial(material?: Material): { source: StudySource | null; error: string } {
  if (!material?.body.trim()) return { source: null, error: '' };
  try {
    return { source: studySourceFromText({ id: material.id, title: material.title, text: material.body }), error: '' };
  } catch (error) {
    return { source: null, error: error instanceof Error ? error.message : '這份教材無法讀取。' };
  }
}

export function CourseStudyPanel({ courseTitle, material, onClose }: Props) {
  const [initial] = useState(() => initialMaterial(material));
  const [source, setSource] = useState<StudySource | null>(initial.source);
  const [sectionIndex, setSectionIndex] = useState(0);
  const [passageIndex, setPassageIndex] = useState(0);
  const [session, setSession] = useState<StudySessionMemory>({ revision: 0, passages: {} });
  const revision = useRef(0);
  const [mode, setMode] = useState<StudyMode>('understand');
  const [paste, setPaste] = useState('');
  const [reading, setReading] = useState(false);
  const [error, setError] = useState(initial.error);
  const [downloadStatus, setDownloadStatus] = useState('');
  const [downloadError, setDownloadError] = useState('');
  const downloadUrl = useRef<string | null>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const read = useRef<AbortController | null>(null);
  const inputId = useId();
  const pasteId = useId();
  const sectionId = useId();
  const modeId = useId();
  const headingId = useId();
  const sectionPassages = useMemo(() => source?.sections.map(splitStudySection) ?? [], [source]);
  const section = source?.sections[sectionIndex];
  const passages = sectionPassages[sectionIndex] ?? [];
  const passage = passages[passageIndex];
  const passageKey = `${sectionIndex}:${passageIndex}`;
  const memory = session.passages[passageKey] ?? emptyStudyPassage();
  const hasNotes = Object.values(session.passages).some((item) =>
    item.note.trim() || item.needsReview || Object.values(item.modes).some((value) => value.lessons.length));
  const reviewPassages = sectionPassages.flatMap((parts, sectionNumber) =>
    parts.flatMap((part, partNumber) =>
      session.passages[`${sectionNumber}:${partNumber}`]?.needsReview
        ? [{ label: part.label, sectionNumber, partNumber }] : []));

  useEffect(() => {
    heading.current?.focus();
    return () => {
      read.current?.abort();
      read.current = null;
      if (downloadUrl.current) URL.revokeObjectURL(downloadUrl.current);
      downloadUrl.current = null;
    };
  }, []);

  function replaceSource(value: StudySource) {
    setSource(value);
    setSectionIndex(0);
    setPassageIndex(0);
    revision.current += 1;
    setSession({ revision: revision.current, passages: {} });
    if (downloadUrl.current) URL.revokeObjectURL(downloadUrl.current);
    downloadUrl.current = null;
    setDownloadStatus('');
    setDownloadError('');
    setError('');
  }

  function downloadNotes() {
    if (!source || !hasNotes) return;
    setDownloadStatus('');
    setDownloadError('');
    let url: string | null = null;
    const link = document.createElement('a');
    try {
      const text = buildCourseStudyNotes(courseTitle, source, session.passages);
      url = URL.createObjectURL(new Blob(['\uFEFF', text], { type: 'text/plain;charset=utf-8' }));
      link.href = url;
      link.download = courseStudyNotesFilename(source.title);
      link.hidden = true;
      document.body.append(link);
      link.click();
      if (downloadUrl.current) URL.revokeObjectURL(downloadUrl.current);
      downloadUrl.current = url;
      setDownloadStatus('已交給瀏覽器下載本次筆記；若沒有出現檔案，請確認瀏覽器的下載設定。');
    } catch {
      if (url) URL.revokeObjectURL(url);
      setDownloadError('目前無法下載，筆記仍保留在白板中，可重試或先複製需要的文字。');
    } finally {
      link.remove();
    }
  }

  async function chooseFile(file: File) {
    read.current?.abort();
    const controller = new AbortController();
    read.current = controller;
    setReading(true);
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
      if (read.current === controller) { read.current = null; setReading(false); }
    }
  }

  function cancelRead() {
    read.current?.abort();
    read.current = null;
    setReading(false);
  }

  return (
    <section className={styles.root} aria-labelledby={headingId}>
      <header className={styles.heading}>
        <div><p className={styles.eyebrow}>{courseTitle}</p><h3 id={headingId} ref={heading} tabIndex={-1}>讀書白板</h3></div>
        <button type="button" className={styles.button} onClick={onClose}>收起白板</button>
      </header>
      <p className={styles.intro}>一次讀一段，對照原文，再試著用自己的話說明。</p>
      {material && source?.id === material.id && <p className={styles.note}>已帶入「{material.title}」的教材文字。附件與外部連結的內容需另外選擇檔案或貼上文字。</p>}
      <details className={styles.import} open={!source || undefined}>
        <summary>{source ? '換一份講義或貼上內容' : '選擇要讀的內容'}</summary>
        <div className={styles.importBody}>
          <label className={styles.field} htmlFor={inputId}>選擇講義
            <input id={inputId} type="file" accept=".pdf,.txt,.md,application/pdf,text/plain,text/markdown"
              disabled={reading} onChange={(event) => {
                const file = event.target.files?.[0];
                event.target.value = '';
                if (file) void chooseFile(file);
              }} />
          </label>
          <p className={styles.note}>PDF 最多 20 頁、8 MiB；文字最多 60,000 字元。檔案在此裝置讀取，公式、圖表與掃描辨識結果請對照原檔。</p>
          <label className={styles.field} htmlFor={pasteId}>或貼上課文與筆記
            <textarea id={pasteId} rows={4} value={paste} disabled={reading}
              onChange={(event) => setPaste(event.target.value)} placeholder="貼上想理解的段落…" />
          </label>
          <p className={paste.length > STUDY_TUTOR_LIMITS.textCharacters ? styles.error : styles.note}>
            {paste.length.toLocaleString('zh-TW')} / 60,000 字元{paste.length > STUDY_TUTOR_LIMITS.textCharacters ? '，請分成較短的章節；內容尚未加入白板。' : ''}
          </p>
          <button type="button" className={styles.button} disabled={reading || !paste.trim() || paste.length > STUDY_TUTOR_LIMITS.textCharacters}
            onClick={() => {
              try { replaceSource(studySourceFromText({ id: 'pasted', title: '貼上的筆記', text: paste })); setPaste(''); }
              catch (failure) { setError(failure instanceof Error ? failure.message : '文字無法讀取。'); }
            }}>開始讀這份內容</button>
        </div>
      </details>
      {reading && <div className={styles.actions}><p role="status">正在讀取講義…</p><button type="button" className={styles.button} onClick={cancelRead}>取消讀取</button></div>}
      {error && <p className={styles.error} role="alert">{error}</p>}
      {!reading && source && passage && <>
        <div className={styles.sourceMeta}>
          <strong>{source.title}</strong><span>僅保留本次閱讀；換教材、關閉或離開白板即清除</span>
        </div>
        <div className={styles.actions}>
          <button type="button" className={styles.button} disabled={!hasNotes} onClick={downloadNotes}>下載本次筆記</button>
          <p className={styles.note}>想下次接著看，可下載文字檔；包含你的筆記、講解與試答。</p>
        </div>
        {downloadStatus && <p className={styles.note} role="status">{downloadStatus}</p>}
        {downloadError && <p className={styles.error} role="alert">{downloadError}</p>}
        {source.warnings.length > 0 && <details className={styles.reference}>
          <summary>來源注意事項（{source.warnings.length}）</summary>
          {source.warnings.map((warning, index) => <p key={index} className={styles.note}>{warning}</p>)}
        </details>}
        {reviewPassages.length > 0 && <section className={styles.reviewList} aria-label="待複習段落">
          <h4>待複習 · {reviewPassages.length} 段</h4>
          <p className={styles.note}>這是你標記的重點，點選即可回到原段落。</p>
          <div className={styles.actions}>{reviewPassages.map((item) => <button type="button" className={styles.button}
            key={`${item.sectionNumber}:${item.partNumber}`}
            aria-current={sectionIndex === item.sectionNumber && passageIndex === item.partNumber ? 'location' : undefined}
            onClick={() => { setSectionIndex(item.sectionNumber); setPassageIndex(item.partNumber); }}>{item.label}</button>)}</div>
        </section>}
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
          <div className={styles.stepHeading}>
            <span>第 {passageIndex + 1} 段，共 {passages.length} 段</span><span>{section?.label}</span>
          </div>
          <CourseStudyPassage key={`${session.revision}:${passageKey}:${mode}`} passage={passage} mode={mode} memory={memory}
            onChange={(update) => setSession((previous) => previous.revision !== session.revision ? previous : {
              ...previous,
              passages: { ...previous.passages, [passageKey]: update(previous.passages[passageKey] ?? emptyStudyPassage()) },
            })} />
          <nav className={styles.stepNavigation} aria-label="白板段落導覽">
            <button type="button" className={styles.button} disabled={passageIndex === 0}
              onClick={() => setPassageIndex((previous) => previous - 1)}>上一段</button>
            <span>{passageIndex + 1} / {passages.length}</span>
            <button type="button" className={styles.button} disabled={passageIndex >= passages.length - 1}
              onClick={() => setPassageIndex((previous) => previous + 1)}>下一段</button>
          </nav>
        </div>
      </>}
    </section>
  );
}
