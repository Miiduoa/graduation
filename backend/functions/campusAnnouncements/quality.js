'use strict';

const STUDENT_WALL_DAYS = 90;

function taipeiYmd(now) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Taipei',
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
  }).formatToParts(now);
  const read = (type) => Number(parts.find((part) => part.type === type)?.value);
  return { year: read('year'), month: read('month'), day: read('day') };
}

function currentSemesterStartUtc(now = new Date()) {
  const { year, month } = taipeiYmd(now);
  if (month >= 8) return new Date(Date.UTC(year, 7, 1));
  if (month >= 2) return new Date(Date.UTC(year, 1, 1));
  return new Date(Date.UTC(year - 1, 7, 1));
}

function studentWallStartUtc(now = new Date()) {
  const semester = currentSemesterStartUtc(now).getTime();
  const ninety = now.getTime() - STUDENT_WALL_DAYS * 24 * 60 * 60 * 1000;
  return new Date(Math.min(semester, ninety));
}

function rocSchoolYear(now = new Date()) {
  const { year, month } = taipeiYmd(now);
  return (month >= 8 ? year : year - 1) - 1911;
}

function parseAnnouncementDate(value) {
  if (value == null || value === '') return null;
  if (value instanceof Date) {
    return Number.isFinite(value.getTime()) ? new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate())).toISOString() : null;
  }
  if (typeof value === 'object' && typeof value.toDate === 'function') {
    try {
      return parseAnnouncementDate(value.toDate());
    } catch {
      return null;
    }
  }
  const text = String(value)
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!text) return null;
  const iso = text.match(/(20\d{2})[./-](\d{1,2})[./-](\d{1,2})/);
  if (iso) {
    const date = new Date(Date.UTC(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3])));
    return Number.isFinite(date.getTime()) ? date.toISOString() : null;
  }
  const roc = text.match(/\[?(\d{2,3})[./年](\d{1,2})[./月](\d{1,2})\]?/);
  if (roc && Number(roc[1]) < 200) {
    const date = new Date(Date.UTC(Number(roc[1]) + 1911, Number(roc[2]) - 1, Number(roc[3])));
    return Number.isFinite(date.getTime()) ? date.toISOString() : null;
  }
  if (text.length <= 40) {
    const parsed = new Date(text);
    return Number.isFinite(parsed.getTime()) ? parsed.toISOString() : null;
  }
  return null;
}

function chineseDisplayTitle(title) {
  const raw = String(title || '')
    .replace(/\s+/g, ' ')
    .trim();
  const withoutAudience = raw.replace(/\((?:for)?(?:教師|學系)\)\s*$/i, '').trim();
  let lastCjk = -1;
  for (let index = 0; index < withoutAudience.length; index += 1) {
    if (/[\u4e00-\u9fff]/.test(withoutAudience[index] || '')) lastCjk = index;
  }
  if (lastCjk >= 0) {
    const head = withoutAudience
      .slice(0, lastCjk + 1)
      .replace(/[-_／/\s:]+$/, '')
      .trim();
    const tail = withoutAudience.slice(lastCjk + 1).trim();
    if (head && tail.length >= 8 && /[A-Za-z]{4,}/.test(tail)) return head;
  }
  return withoutAudience || raw;
}

function staffAudienceOf(title) {
  const text = String(title || '');
  if (/\(for教師\)|for教師/.test(text)) return 'teacher';
  if (/\(for學系\)|for學系/.test(text)) return 'department';
  return null;
}

function isStaticOrNavAnnouncement(title) {
  return /章則|名單|簡介|標準流程|工作簡報|資安專區|表單下載/.test(String(title || ''));
}

function isBroadcastOrAdmissionAnnouncement(title) {
  return /廣播電臺|Channel\+|人生100|30＋大學|30\+大學|第三人生|學分學程專班|招生中/.test(
    String(title || ''),
  );
}

function isComputerCenterSecurityAlert(title, office = '') {
  const text = `${title} ${office}`;
  return (
    /漏洞預警|資安轉知/.test(text) &&
    (/計算機/.test(office) || /Cisco|漏洞預警|資安轉知/.test(title))
  );
}

function isOffSeasonControl(title, now = new Date()) {
  const text = String(title || '');
  if (!/(通行證|停車|車證|車輛管制|床位|暑修)/.test(text)) return false;
  const current = rocSchoolYear(now);
  const years = [...text.matchAll(/(1[0-2]\d)學/g)].map((match) => Number(match[1]));
  if (years.some((year) => year < current)) return true;
  return /暑修/.test(text) && taipeiYmd(now).month >= 9;
}

function resolveAnnouncementOffice(schoolId, sourceOffice, itemOffice) {
  const unit = String(itemOffice || '').trim();
  if (unit) return unit;
  if (schoolId === 'ncku') return '全校';
  return sourceOffice;
}

function announcementQualityFlags(input, now = new Date()) {
  const rawTitle = String(input.title || '').trim();
  const stripped = rawTitle.replace(/^【(?!漏洞預警|資安轉知).*?】/, '').trim() || rawTitle;
  const title = chineseDisplayTitle(stripped);
  const publishedAt =
    parseAnnouncementDate(input.publishedAt) || parseAnnouncementDate(rawTitle);
  const office = resolveAnnouncementOffice(
    input.schoolId || '',
    input.sourceOffice || input.office || '',
    input.office,
  );
  const staff = staffAudienceOf(rawTitle);
  const offSeason = isOffSeasonControl(rawTitle, now);
  const outsideWall =
    Boolean(publishedAt) && new Date(publishedAt).getTime() < studentWallStartUtc(now).getTime();
  const studentFeed = !(
    isStaticOrNavAnnouncement(rawTitle) ||
    isBroadcastOrAdmissionAnnouncement(rawTitle) ||
    isComputerCenterSecurityAlert(rawTitle, office) ||
    staff ||
    offSeason ||
    outsideWall
  );
  return {
    title,
    publishedAt,
    office,
    audience: staff ? 'staff' : 'student',
    studentFeed,
    rank: offSeason ? 'demoted' : 'normal',
    visible: studentFeed,
  };
}

function selectStudentAnnouncements(rows, sources = [], now = new Date()) {
  const down = new Set(
    (sources || [])
      .filter((item) => item.status === 'unavailable')
      .map((item) => item.sourceId)
      .filter(Boolean),
  );
  return (rows || []).filter((row) => {
    if (row.visible === false || row.studentFeed === false) return false;
    if (row.audience === 'staff') return false;
    if (row.origin && row.origin !== 'public_scrape') return true;
    if (row.origin === 'public_scrape' && row.sourceId && down.has(row.sourceId)) return false;
    return announcementQualityFlags(
      {
        title: row.title || '',
        publishedAt: row.publishedAt,
        office: row.office || row.source,
      },
      now,
    ).studentFeed;
  });
}

module.exports = {
  STUDENT_WALL_DAYS,
  currentSemesterStartUtc,
  studentWallStartUtc,
  rocSchoolYear,
  parseAnnouncementDate,
  chineseDisplayTitle,
  staffAudienceOf,
  isStaticOrNavAnnouncement,
  isBroadcastOrAdmissionAnnouncement,
  isComputerCenterSecurityAlert,
  isOffSeasonControl,
  resolveAnnouncementOffice,
  announcementQualityFlags,
  selectStudentAnnouncements,
};
