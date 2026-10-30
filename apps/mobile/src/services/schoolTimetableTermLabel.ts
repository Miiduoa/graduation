/** Format only the canonical academic-year|semester key; keep unknown source text as evidence. */
export function schoolTimetableTermLabel(termKey: string | null, sourceSemester: string | null): string {
  const match = typeof termKey === 'string' ? /^([0-9]{2,4})\|([1-3])$/.exec(termKey) : null;
  // JavaScript's $ also matches before a final newline, so require an exact full-string match.
  if (match && match[0] === termKey) {
    return `${match[1]} 學年度 · 第 ${match[2]} 學期`;
  }
  return `來源學期：${sourceSemester || '未提供'}`;
}
