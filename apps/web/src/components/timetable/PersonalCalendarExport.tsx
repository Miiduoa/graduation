'use client';
import { useState, useMemo } from 'react';
import { classDate, type PersonalImportRecord } from '@campus/shared';
import {
  calendarRangeEnd,
  personalCalendarEventLabel,
  personalCalendarSnapshotCopy,
  previewPersonalCalendar,
  serializePersonalCalendar,
} from '@campus/shared/src/timetable/personalCalendarExport';

export function PersonalCalendarExport({
  records,
  schoolId,
  termKey,
  disabled,
}: {
  records: PersonalImportRecord[];
  schoolId: string;
  termKey: string;
  disabled?: boolean;
}) {
  const [start, setStart] = useState(() => classDate(new Date()));
  const [end, setEnd] = useState(() => calendarRangeEnd(classDate(new Date())));
  const [showDetails, setShowDetails] = useState(false);
  const { preview, error } = useMemo(() => {
    try {
      return {
        preview: previewPersonalCalendar(records, { schoolId, termKey, start, end }),
        error: '',
      };
    } catch (cause) {
      return { preview: undefined, error: (cause as Error).message };
    }
  }, [records, schoolId, termKey, start, end]);
  return (
    <section aria-label="匯出課表快照">
      <h2>帶到我的行事曆</h2>
      <p>{personalCalendarSnapshotCopy}</p>
      <p>
        依目前選取的學期匯出，最多八週；日期與時間皆以台灣時間為準。未登記的放假或停課仍會照每週課表匯出，請先核對。
      </p>
      <label>
        匯出開始日期
        <input type="date" value={start} onChange={(e) => setStart(e.target.value)} />
      </label>
      <label>
        匯出結束日期
        <input
          type="date"
          value={end}
          min={start}
          max={calendarRangeEnd(start, 56)}
          onChange={(e) => setEnd(e.target.value)}
        />
      </label>
      {disabled ? (
        <p role="status">課表尚未完整讀取，暫時無法匯出。</p>
      ) : error ? (
        <p role="alert">{error}</p>
      ) : (
        preview && (
          <div aria-live="polite">
            <p>
              將匯出 {preview.events.length} 堂課；略過 {preview.skipped.length}{' '}
              門時間未確認的課程。
            </p>
            <button
              type="button"
              aria-expanded={showDetails}
              onClick={() => setShowDetails(!showDetails)}
            >
              {showDetails ? '收起逐堂明細' : '查看逐堂明細'}
            </button>
            {showDetails && (
              <ul>
                {preview.events.map((event) => (
                  <li key={event.uid}>{personalCalendarEventLabel(event)}</li>
                ))}
              </ul>
            )}
            <ul>
              {preview.skipped.map((row) => (
                <li key={row.id}>{row.title}：星期或時間未確認</li>
              ))}
            </ul>
          </div>
        )
      )}
      <button
        className="btn"
        disabled={disabled || !preview?.events.length}
        onClick={() => {
          if (!preview || disabled) return;
          const url = URL.createObjectURL(
            new Blob([serializePersonalCalendar(preview)], { type: 'text/calendar;charset=utf-8' }),
          );
          const link = document.createElement('a');
          link.href = url;
          link.download = `nuni-timetable-${start}-${end}.ics`;
          document.body.appendChild(link);
          link.click();
          link.remove();
          setTimeout(() => URL.revokeObjectURL(url), 1000);
        }}
      >
        下載課表 ICS
      </button>
    </section>
  );
}
