import { isAnnouncementSchoolVisibleToPublic } from '@campus/shared/src/campusAnnouncements';
import { assistantServiceHref } from '@campus/shared/src/assistantServices';
import type { PublicCampusReadGuard } from '../../publicCampusReadGuard';
import type { CampusEvent, CampusEventCursor } from '../../campusEvents';
import { getAnnouncementVisibilityEnv } from '../../runtime';
import { V2Error } from './contracts';
import {
  parsePublicCampusResult,
  publicCampusSourcePath,
  type PublicCampusItem,
  type PublicCampusKind,
  type PublicCampusRead,
} from './publicCampus';

function plain(value: unknown, max: number): string {
  return typeof value === 'string' ? value.replace(/<[^>]*>/g, ' ')
    .replace(/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/gu, ' ').replace(/\s+/g, ' ').trim().slice(0, max) : '';
}
function time(value: unknown): string | undefined {
  return typeof value === 'string' && Number.isFinite(Date.parse(value)) ? new Date(value).toISOString() : undefined;
}
function link(value: unknown): string | undefined {
  if (typeof value !== 'string' || value.length > 1000) return;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password ? url.href : undefined;
  } catch { return; }
}

/** Reuse the actual pages' anonymous public readers and project only their
 * reviewed display fields. No user credential or request metadata reaches them. */
export async function readPublicCampus(input: {
  kind: PublicCampusKind;
  schoolId: string;
  limit: number;
  guard: PublicCampusReadGuard;
  now?: number;
}): Promise<PublicCampusRead> {
  const { kind, schoolId, limit, guard } = input;
  if (!['announcements', 'events'].includes(kind) || !/^[a-z0-9][a-z0-9-]{0,79}$/.test(schoolId) ||
      schoolId === 'personal' || !Number.isInteger(limit) || limit < 1 || limit > 5)
    throw new V2Error(422, 'INVALID_INPUT');
  guard.afterRead();
  const now = input.now ?? Date.now();
  const base: PublicCampusRead = { version: 1, kind, schoolId,
    source: kind === 'announcements' ? 'school-announcements' : 'school-club-events',
    sourcePath: '', checkedAt: new Date(now).toISOString(), status: 'ready', items: [], partial: false,
    href: assistantServiceHref(kind, schoolId)! };
  const finish = () => {
    guard.afterRead();
    base.sourcePath = publicCampusSourcePath(schoolId, base.source);
    return parsePublicCampusResult(base, schoolId, kind);
  };
  if (!isAnnouncementSchoolVisibleToPublic({ schoolId }, getAnnouncementVisibilityEnv())) {
    base.status = 'unavailable';
    base.unavailable = 'HIDDEN_SCHOOL';
    return finish();
  }
  let incomplete = false;
  const boundedGuard: PublicCampusReadGuard = { ...guard, onIncomplete() {
    incomplete = true;
    guard.onIncomplete?.();
  } };
  if (kind === 'announcements') {
    const { loadAnnouncementFeed } = await import('../../../app/announcements/publicAnnouncements');
    guard.afterRead();
    const feed = await loadAnnouncementFeed(schoolId, boundedGuard);
    guard.afterRead();
    const candidates: PublicCampusItem[] = [];
    for (const row of feed.announcements) {
      const publishedAt = time(row.publishedAt);
      const title = plain(row.title, 160);
      if (row.schoolId !== schoolId || !title || !publishedAt || !row.id || row.id.includes('/')) {
        incomplete = true;
        continue;
      }
      const originalUrl = link(row.originalUrl);
      const office = plain(row.office || row.source, 120);
      candidates.push({ id: row.id, schoolId, title,
        summary: plain(row.summary || row.body, 320), publishedAt,
        href: `/announcements/${encodeURIComponent(row.id)}?${new URLSearchParams({ schoolId })}`,
        ...(office ? { office } : {}), ...(originalUrl ? { originalUrl } : {}) });
    }
    base.items = candidates.slice(0, limit);
    const sourceDown = feed.sources.some(source => source.status === 'unavailable');
    base.partial = incomplete || sourceDown || !feed.sources.length || candidates.length > limit;
    if (!candidates.length && (incomplete || sourceDown || feed.allUnavailable || !feed.sources.length)) {
      base.status = 'unavailable';
      base.unavailable = incomplete || sourceDown || feed.allUnavailable ? 'SOURCE_UNAVAILABLE' : 'NOT_CONNECTED';
    }
    return finish();
  }
  const { loadCampusEventPage } = await import('../../campusEvents');
  guard.afterRead();
  let cursor: CampusEventCursor | null = null;
  const events: CampusEvent[] = [];
  for (let page = 0; page < 3; page++) {
    try {
      const result = await loadCampusEventPage(schoolId, cursor, boundedGuard);
      guard.afterRead();
      if (page && result.source !== base.source) throw new V2Error(502, 'INVALID_PUBLIC_CAMPUS_RESULT');
      base.source = result.source;
      events.push(...result.items);
      incomplete ||= result.skipped.length > 0;
      cursor = result.nextCursor;
      if (!cursor) break;
    } catch (error) {
      guard.afterRead();
      // Previously read public records remain useful, with explicit incomplete
      // coverage. A first-page failure is never converted to an empty success.
      if (!page || (error as { code?: string }).code === 'INVALID_PUBLIC_CAMPUS_RESULT') throw error;
      incomplete = true;
      break;
    }
  }
  const candidates: PublicCampusItem[] = [];
  for (const event of events) {
    const startsAt = time(event.startsAt), endsAt = time(event.endsAt);
    const title = plain(event.title, 160);
    if (event.schoolId !== schoolId || event.source !== base.source || !title || !startsAt ||
        !event.id || event.id.includes('/') || (endsAt && endsAt < startsAt)) {
      incomplete = true;
      continue;
    }
    if (Date.parse(startsAt) < now && (!endsAt || Date.parse(endsAt) <= now)) continue;
    const location = plain(event.location, 120);
    candidates.push({ id: event.id, schoolId, title, summary: plain(event.description, 320), startsAt,
      ...(endsAt ? { endsAt } : {}), ...(location ? { location } : {}),
      href: `/events/${encodeURIComponent(event.id)}?${new URLSearchParams({ schoolId, source: event.source })}` });
  }
  candidates.sort((a, b) => a.startsAt!.localeCompare(b.startsAt!) || a.id.localeCompare(b.id));
  base.items = candidates.slice(0, limit);
  base.partial = incomplete || Boolean(cursor) || candidates.length > limit;
  return finish();
}
