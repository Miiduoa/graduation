function eventDate(value) {
  try {
    const date =
      value instanceof Date
        ? value
        : value && typeof value.toDate === 'function'
          ? value.toDate()
          : typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(value)
            ? new Date(value)
            : null;
    return date instanceof Date && Number.isFinite(date.getTime()) ? date : null;
  } catch {
    return null;
  }
}

function escapeICalText(value) {
  return typeof value === 'string'
    ? value
        .replace(/\\/g, '\\\\')
        .replace(/;/g, '\\;')
        .replace(/,/g, '\\,')
        .replace(/\r\n|\r|\n/g, '\\n')
    : '';
}

function formatICalDate(date) {
  return date
    .toISOString()
    .replace(/[-:]/g, '')
    .replace(/\.\d{3}/, '');
}

function foldICalLine(line) {
  const chunks = [];
  let chunk = '';
  let bytes = 0;
  for (const character of line) {
    const size = Buffer.byteLength(character, 'utf8');
    if (bytes + size > 75) {
      chunks.push(chunk);
      chunk = ' ';
      bytes = 1;
    }
    chunk += character;
    bytes += size;
  }
  chunks.push(chunk);
  return chunks.join('\r\n');
}

function publicEvent(document, schoolId) {
  const data = document.data();
  const startsAt = eventDate(data.startsAt);
  if (
    !startsAt ||
    typeof data.title !== 'string' ||
    !data.title.trim() ||
    (data.schoolId != null && data.schoolId !== schoolId)
  ) {
    return null;
  }
  const endsAt = eventDate(data.endsAt);
  let url;
  if (typeof data.link === 'string' && !/[\r\n]/.test(data.link)) {
    try {
      const parsed = new URL(data.link);
      if (parsed.protocol === 'https:' && !parsed.username && !parsed.password) url = parsed.href;
    } catch {
      // An invalid optional link does not remove an otherwise scheduled public event.
    }
  }
  return {
    id: encodeURIComponent(document.id),
    title: data.title,
    description: data.description,
    location: data.location,
    startsAt,
    endsAt: endsAt && endsAt > startsAt ? endsAt : null,
    url,
  };
}

function generateICalFeed(events, calendarName, now = new Date()) {
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Campus One//TW',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    `X-WR-CALNAME:${escapeICalText(calendarName)}`,
    'X-WR-TIMEZONE:Asia/Taipei',
  ];
  for (const event of events) {
    lines.push(
      'BEGIN:VEVENT',
      `UID:event-${event.id}@campus-app.tw`,
      `DTSTAMP:${formatICalDate(now)}`,
      `DTSTART:${formatICalDate(event.startsAt)}`,
    );
    if (event.endsAt) lines.push(`DTEND:${formatICalDate(event.endsAt)}`);
    lines.push(`SUMMARY:${escapeICalText(event.title)}`, 'CATEGORIES:活動');
    if (typeof event.description === 'string') {
      lines.push(`DESCRIPTION:${escapeICalText(event.description)}`);
    }
    if (typeof event.location === 'string')
      lines.push(`LOCATION:${escapeICalText(event.location)}`);
    if (event.url) lines.push(`URL:${event.url}`);
    lines.push('END:VEVENT');
  }
  lines.push('END:VCALENDAR');
  return `${lines.map(foldICalLine).join('\r\n')}\r\n`;
}

function createCalendarSubscriptionHandler({ db, logger = console }) {
  return async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.setHeader('Allow', 'GET, HEAD');
      return res.status(405).send('Method not allowed');
    }

    const query = req.query || {};
    const { schoolId, type } = query;
    // Old personalized links must fail before any Admin SDK read.
    if (Object.hasOwn(query, 'userId') || ['all', 'assignments', 'registered'].includes(type)) {
      return res.status(410).send('Personal calendar subscriptions are no longer available');
    }
    if (
      Object.keys(query).some((key) => key !== 'schoolId' && key !== 'type') ||
      typeof schoolId !== 'string' ||
      !schoolId.trim() ||
      schoolId !== schoolId.trim() ||
      schoolId.length > 120 ||
      /[/\r\n\0]/.test(schoolId) ||
      schoolId === '.' ||
      schoolId === '..' ||
      (type !== undefined && type !== 'events')
    ) {
      return res.status(400).send('Expected schoolId and optional type=events');
    }

    try {
      const schoolRef = db.collection('schools').doc(schoolId);
      const schoolDoc = await schoolRef.get();
      if (!schoolDoc.exists) return res.status(404).send('School not found');
      const schoolName = schoolDoc.data()?.name || schoolId;
      const snapshot = await schoolRef
        .collection('clubEvents')
        .orderBy('startsAt', 'desc')
        .limit(100)
        .get();
      const events = snapshot.docs
        .map((document) => publicEvent(document, schoolId))
        .filter(Boolean)
        .sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime());
      const content = generateICalFeed(events, `${schoolName} 公開活動`);

      res.setHeader('Content-Type', 'text/calendar; charset=utf-8');
      res.setHeader('Content-Disposition', 'attachment; filename="campus-public-events.ics"');
      res.setHeader('Cache-Control', 'public, max-age=300');
      return res.send(content);
    } catch {
      logger.error('Public calendar subscription failed');
      return res.status(500).send('Internal server error');
    }
  };
}

module.exports = { createCalendarSubscriptionHandler, generateICalFeed };
