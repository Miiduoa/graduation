'use client';

import { useState } from 'react';
import type { NuniStudyTask } from '@campus/shared/src/nuniStudyAgenda';
import {
  buildStudyCalendar,
  studyCalendarCandidates,
  studyCalendarKey,
  studyCalendarNotice,
  studyCalendarPartial,
} from '@campus/shared/src/studyAgendaCalendar';
import { formatTaipeiDateTime } from '@campus/shared/src/taipeiTime';
import styles from './StudyDeadlineExport.module.css';

export function downloadStudyCalendar(content: string) {
  const url = URL.createObjectURL(new Blob([content], { type: 'text/calendar;charset=utf-8' }));
  const link = document.createElement('a');
  try {
    link.href = url;
    link.download = 'nuni-study-deadlines.ics';
    document.body.appendChild(link);
    link.click();
  } finally {
    link.remove();
    // Give the browser time to start the user-requested download before releasing the blob.
    window.setTimeout(() => URL.revokeObjectURL(url), 1_000);
  }
}

export function StudyDeadlineExport({
  tasks,
  partial,
  retry,
}: {
  tasks: NuniStudyTask[];
  partial: boolean;
  retry(): void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [selected, setSelected] = useState<string[]>([]);
  const [preview, setPreview] = useState(false);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const candidates = studyCalendarCandidates(tasks);
  const chosen = candidates.filter((task) => selected.includes(studyCalendarKey(task)));
  return (
    <section className={styles.panel} aria-label="未繳期限 ICS">
      <button type="button" aria-expanded={expanded} onClick={() => setExpanded(!expanded)}>
        匯出未繳期限 ICS
      </button>
      {expanded && (
        <>
          <p>
            從目前課程範圍勾選作業或測驗，再預覽匯出。時間皆為台灣時間，已繳、停止收件或缺少明確期限的項目已略過。
          </p>
          <p>{studyCalendarNotice}</p>
          {partial && <p role="status">{studyCalendarPartial}</p>}
          {!candidates.length && (
            <p>目前沒有可匯出的未繳期限。請更新待辦，或進入課程確認老師是否設定時間。</p>
          )}
          {candidates.map((task) => (
            <label key={studyCalendarKey(task)} className={styles.choice}>
              <input
                type="checkbox"
                checked={selected.includes(studyCalendarKey(task))}
                disabled={busy}
                onChange={(event) => {
                  const key = studyCalendarKey(task);
                  setSelected(
                    event.target.checked
                      ? [...selected, key]
                      : selected.filter((item) => item !== key),
                  );
                  setPreview(false);
                  setMessage('');
                }}
              />
              <span>
                {task.courseTitle} · {task.kind === 'assignment' ? '作業' : '測驗'} · {task.title}
                <br />
                {formatTaipeiDateTime(task.dueAt!, { seconds: false })}
              </span>
            </label>
          ))}
          <button type="button" disabled={busy} onClick={retry}>
            更新待辦資料
          </button>
          <button
            type="button"
            disabled={!chosen.length || busy}
            onClick={() => {
              setPreview(true);
              setMessage('');
            }}
          >
            預覽已選 {chosen.length} 項
          </button>
          {preview && chosen.length > 0 && (
            <div aria-label="期限匯出預覽">
              <p>將匯出 {chosen.length} 項參考期限（台灣時間）：</p>
              {chosen.map((task) => (
                <p key={studyCalendarKey(task)}>
                  {task.courseTitle} · {task.title} ·{' '}
                  {formatTaipeiDateTime(task.dueAt!, { seconds: false })}
                </p>
              ))}
              <button
                type="button"
                disabled={busy}
                onClick={() => {
                  if (busy) return;
                  setBusy(true);
                  setMessage('');
                  try {
                    downloadStudyCalendar(buildStudyCalendar(tasks, selected));
                    setMessage('已交給瀏覽器下載；請在下載項目中確認 ICS，再匯入行事曆。');
                  } catch {
                    setMessage('下載未能開始，已保留勾選項目，請再按一次下載 ICS。');
                  } finally {
                    window.setTimeout(() => setBusy(false), 1_000);
                  }
                }}
              >
                {busy ? '正在下載…' : '下載 ICS'}
              </button>
            </div>
          )}
          {message && <p role="status">{message}</p>}
        </>
      )}
    </section>
  );
}
