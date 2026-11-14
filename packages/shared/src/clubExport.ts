import type { ClubPortalView } from './clubPortal';
const cell = (value: unknown) => {
  const s = String(value ?? '');
  return `"${(/^[\s]*[=+@-]/.test(s) ? "'" : '') + s.replace(/"/g, '""')}"`;
};
export function clubRosterCsv(view: ClubPortalView) {
  return (
    '\ufeff' +
    [
      ['類別', '名稱', '學號', '電話', '角色', '時間', '地點', '報名數', '簽到數'],
      ...(view.members || []).map((m) => ['社員', m.name, m.studentId, m.phone, m.role]),
      ...(view.events || []).map((e) => [
        '活動',
        e.title,
        '',
        '',
        '',
        new Date(e.startsAt).toISOString(),
        e.location,
        e.registered,
        e.checkedIn,
      ]),
    ]
      .map((r) => r.map(cell).join(','))
      .join('\r\n')
  );
}
