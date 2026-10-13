import { createPersonalImportId } from './records';
import { isPersonalImportDate, isPersonalImportTime } from './validation';
import type { ImportIssue, PersonalImportOptions, PersonalImportRow } from './types';

type CalendarProperty = { name: string; parameters: string; value: string };
const unescapeText = (value: string) =>
  value.replace(/\\([nN,;\\])/g, (_, character: string) =>
    /[nN]/.test(character) ? '\n' : character,
  );
const property = (line: string): CalendarProperty | undefined => {
  const match = /^([A-Z0-9-]+)((?:;[^:]*)?):(.*)$/i.exec(line);
  return match
    ? { name: match[1].toUpperCase(), parameters: match[2], value: match[3] }
    : undefined;
};

/** Parses calendar evidence only. Recurrences and unknown timezone rules must be resolved by the user. */
export function parsePersonalImportCalendar(
  text: string,
  options: PersonalImportOptions,
): { rows: PersonalImportRow[]; issues: ImportIssue[] } {
  const issues: ImportIssue[] = [];
  const rows: PersonalImportRow[] = [];
  const lines: { text: string; line: number }[] = [];
  for (const [index, line] of text.split('\n').entries()) {
    if (/^[ \t]/.test(line) && lines.length) lines[lines.length - 1].text += line.slice(1);
    else if (line.trim()) lines.push({ text: line, line: index + 1 });
  }
  if (
    lines[0]?.text.toUpperCase() !== 'BEGIN:VCALENDAR' ||
    lines.at(-1)?.text.toUpperCase() !== 'END:VCALENDAR'
  )
    issues.push({
      code: 'malformed-calendar',
      severity: 'error',
      message: '行事曆檔案缺少完整的開頭或結尾，請重新匯出。',
    });
  const calendarTimezone = lines
    .map((line) => property(line.text))
    .find((item) => item?.name === 'X-WR-TIMEZONE')?.value;
  let current: PersonalImportRow | undefined;
  let properties: CalendarProperty[] = [];
  let nested = 0;
  const addIssue = (code: string, message: string, severity: ImportIssue['severity'] = 'error') =>
    issues.push({ code, severity, message, ...(current ? { rowId: current.id } : {}) });
  const applyDate = (item: CalendarProperty, end: boolean) => {
    if (!current) return;
    const dateField = end ? 'endDate' : 'date';
    const timeField = end ? 'endTime' : 'startTime';
    const dateOnly =
      /(?:^|;)VALUE=DATE(?:;|$)/i.test(item.parameters) || /^\d{8}$/.test(item.value);
    if (dateOnly) {
      const match = /^(\d{4})(\d{2})(\d{2})$/.exec(item.value);
      if (!match) {
        addIssue('invalid-calendar-date', '全天活動日期格式不正確，請核對原始檔案。');
        return;
      }
      if (!end) current.allDay = true;
      else if (!current.allDay)
        addIssue('mixed-calendar-date', '開始與結束日期的格式不同，請確認是否為全天活動。');
      current[dateField] = `${match[1]}-${match[2]}-${match[3]}`;
      return;
    }
    const match = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})?(Z)?$/.exec(item.value);
    if (!match) {
      addIssue('invalid-calendar-date', '活動日期時間格式無法辨識，請核對原始檔案。');
      return;
    }
    if (end && current.allDay)
      addIssue('mixed-calendar-date', '全天活動的結束值含有時間，請確認。');
    const isoDate = `${match[1]}-${match[2]}-${match[3]}`;
    const clock = `${match[4]}:${match[5]}`;
    const zone = /(?:^|;)TZID=(?:"([^"]+)"|([^;]+))/i.exec(item.parameters);
    const timezone = zone?.[1] ?? zone?.[2] ?? calendarTimezone;
    current[dateField] = isoDate;
    current[timeField] = clock;
    if (match[6] && match[6] !== '00')
      addIssue(
        'calendar-second-precision',
        '這筆活動含有秒數，個人行事曆以分鐘記錄，請先確認或調整原始時間。',
      );
    if (!isPersonalImportDate(isoDate) || !isPersonalImportTime(clock)) return;
    if (match[7] && zone)
      addIssue(
        'conflicting-calendar-timezone',
        '活動時間同時標示 UTC 與其他時區，請先修正原始檔案。',
      );
    if (match[7] || ['UTC', 'Etc/UTC', 'GMT', 'Etc/GMT'].includes(timezone ?? '')) {
      const instant = new Date(`${isoDate}T${clock}:00.000Z`);
      // Use the named zone rather than the device timezone (including its historical rules).
      const parts = new Intl.DateTimeFormat('en-CA', {
        timeZone: 'Asia/Taipei',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        hourCycle: 'h23',
      }).formatToParts(instant);
      const part = (type: string) => parts.find((value) => value.type === type)?.value ?? '';
      current[dateField] = `${part('year')}-${part('month')}-${part('day')}`;
      current[timeField] = `${part('hour')}:${part('minute')}`;
      addIssue(
        'calendar-timezone-converted',
        '原始 UTC 時間已換算為台灣時間（Asia/Taipei），請確認預覽日期與時間。',
        'warning',
      );
    } else {
      if (timezone && timezone !== 'Asia/Taipei')
        addIssue(
          'unsupported-calendar-timezone',
          `這筆活動使用 ${timezone} 時區，尚未換算；請先轉為台灣時間或 UTC 後重新匯入。`,
        );
      else if (!timezone)
        addIssue(
          'floating-calendar-time',
          '原始行事曆未指定時區，已保留原始時間，請確認是否為你需要的當地時間。',
          'warning',
        );
    }
  };
  const finish = () => {
    if (!current) return;
    const used = new Set<string>();
    for (const item of properties) {
      if (['RRULE', 'RDATE', 'EXDATE', 'RECURRENCE-ID', 'EXRULE'].includes(item.name))
        addIssue(
          'unsupported-calendar-recurrence',
          '這筆活動有重複規則或例外日期；目前不能展開完整行程，請先匯出個別活動再匯入。',
        );
      if (['SUMMARY', 'LOCATION', 'DTSTART', 'DTEND'].includes(item.name)) {
        if (used.has(item.name))
          addIssue(
            'duplicate-calendar-property',
            `同一活動出現重複的 ${item.name}，請先核對原始檔案。`,
          );
        used.add(item.name);
      }
      if (item.name === 'SUMMARY') current.title = unescapeText(item.value);
      if (item.name === 'LOCATION') current.location = unescapeText(item.value);
      if (item.name === 'STATUS' && item.value.toUpperCase() === 'CANCELLED')
        addIssue(
          'cancelled-calendar-event',
          '原始行事曆已將這筆活動標示為取消，請不要直接匯入為有效活動。',
        );
      if (item.name === 'DURATION')
        addIssue(
          'unsupported-calendar-duration',
          '這筆活動只提供持續時間，請補上明確結束日期與時間後重新匯入。',
        );
    }
    const start = properties.find((item) => item.name === 'DTSTART');
    const end = properties.find((item) => item.name === 'DTEND');
    if (start) applyDate(start, false);
    if (end) applyDate(end, true);
    rows.push(current);
    current = undefined;
    properties = [];
  };
  for (const line of lines) {
    const upper = line.text.toUpperCase();
    if (upper === 'BEGIN:VEVENT') {
      if (current) {
        addIssue('malformed-calendar', '行事曆活動沒有正常結束，請重新匯出檔案。');
        finish();
      }
      current = {
        id: createPersonalImportId(),
        kind: 'events',
        title: '',
        schoolId: options.schoolId,
        academicYear: options.academicYear,
        semester: options.semester,
        source: {
          ...options.source,
          type: options.source?.type ?? 'file',
          line: line.line,
          rawText: line.text,
        },
      };
      properties = [];
      nested = 0;
    } else if (current) {
      current.source.rawText += `\n${line.text}`;
      if (upper === 'END:VEVENT') {
        if (nested) addIssue('malformed-calendar', '活動中的子項目沒有完整結束，請重新匯出檔案。');
        finish();
      } else if (upper.startsWith('BEGIN:')) nested++;
      else if (upper.startsWith('END:')) {
        if (nested) nested--;
        else addIssue('malformed-calendar', '活動的結尾標記不正確，請重新匯出檔案。');
      } else if (!nested) {
        const parsed = property(line.text);
        if (parsed) properties.push(parsed);
        else addIssue('malformed-calendar', '活動內有無法辨識的欄位，請重新匯出檔案。');
      }
    } else if (upper === 'END:VEVENT')
      addIssue('malformed-calendar', '行事曆包含沒有開始標記的活動。');
  }
  if (current) {
    addIssue('malformed-calendar', '行事曆活動缺少結尾，請重新匯出檔案。');
    finish();
  }
  return { rows, issues };
}
