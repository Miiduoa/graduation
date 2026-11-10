import type { TeacherGradebook } from './teacherCourse';

export const GRADEBOOK_SOURCE = '目前畫面已授權的課程成績紀錄';

// Quote every cell for CSV syntax, and neutralize spreadsheet formula prefixes,
// including formulas hidden behind whitespace and leading control characters.
export function gradebookCsvCell(value: string | number): string {
  const text = String(value);
  const safe = /^[\s\u0000-\u001f]*[=+\-@]|^[\u0000-\u001f]/u.test(text)
    ? `'${text}`
    : text;
  return `"${safe.replace(/"/g, '""')}"`;
}

export function gradebookUnknownFields(gradebook: TeacherGradebook): number {
  return gradebook.rows.reduce(
    (total, row) => total + [row.name, row.finalScore, row.result, row.published, row.publishedAt]
      .filter((value) => value === null || value === '').length,
    0,
  );
}

export function teacherGradebookCsv(gradebook: TeacherGradebook): string {
  const rows: (string | number)[][] = [
    ['課程識別', '學生', '使用者編號', '總分', '結果', '發布狀態', '發布時間', '來源'],
    ...gradebook.rows.map((row) => [
      gradebook.course.id,
      row.name ?? '未提供姓名',
      row.uid,
      row.finalScore ?? '未登錄',
      row.result === 'passed' ? '通過'
        : row.result === 'failed' ? '未通過'
          : row.result === 'incomplete' ? '尚未完成' : row.result || '未提供',
      row.published === true ? '已發布' : row.published === false ? '未發布' : '未提供',
      row.publishedAt
        ? new Date(row.publishedAt).toLocaleString('zh-TW', { timeZone: 'Asia/Taipei' })
        : '—',
      GRADEBOOK_SOURCE,
    ]),
  ];
  return '\uFEFF' + rows.map((row) => row.map(gradebookCsvCell).join(',')).join('\r\n') + '\r\n';
}

export function teacherGradebookFilename(courseId: string): string {
  const safeId = courseId.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 80) || 'course';
  return `gradebook-${safeId}.csv`;
}
