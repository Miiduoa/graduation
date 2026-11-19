import { isAnnouncementSchoolVisibleToPublic } from '@campus/shared/src/campusAnnouncements';
import { loadCampusEvent } from '../../campusEvents';
import type { PublicCampusReadGuard } from '../../publicCampusReadGuard';
import { getAnnouncementVisibilityEnv } from '../../runtime';
import { fail } from './contracts';
import {
  parsePublicEventResult,
  parsePublicEventSource,
  parsePublicEventTarget,
  publicEventArgs,
  publicEventFingerprint,
  publicEventHref,
  publicEventSourcePath,
  type PublicEventRead,
  type PublicEventSourceItem,
  type PublicEventTarget,
  type PublicEventUnavailable,
} from './publicEvent';

function plain(value: unknown): string {
  return typeof value === 'string' ? value.replace(/<[^<>]*>/g, ' ')
    .replace(/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/gu, ' ').replace(/\s+/g, ' ').trim() : '';
}

/** One exact anonymous document read. The caller supplies its shared budget,
 * deadline and cancellation guard, as it does for the public campus list. */
export async function readPublicEvent(input: {
  target: PublicEventTarget;
  guard: PublicCampusReadGuard;
  now?: number;
}): Promise<PublicEventRead> {
  const target = parsePublicEventTarget(input.target), { guard } = input;
  guard.afterRead();
  const now = () => input.now ?? Date.now();
  if (!Number.isFinite(now()) || !Number.isFinite(new Date(now()).getTime())) return fail();
  const base = () => ({ version: 1 as const, target, sourcePath: publicEventSourcePath(target), checkedAt: new Date(now()).toISOString() });
  const unavailable = (reason: PublicEventUnavailable): PublicEventRead => {
    guard.afterRead();
    return parsePublicEventResult({ ...base(), status: 'unavailable', unavailable: reason }, target, now());
  };
  if (!isAnnouncementSchoolVisibleToPublic({ schoolId: target.schoolId }, getAnnouncementVisibilityEnv()))
    return unavailable('HIDDEN_SCHOOL');
  // No fallback to the default Firebase app, which may carry a user's login.
  if (!guard.db) return unavailable('SOURCE_UNAVAILABLE');
  let guardFailed = false;
  const checkedGuard: PublicCampusReadGuard = { ...guard,
    beforeRead() { try { guard.beforeRead(); } catch (error) { guardFailed = true; throw error; } },
    afterRead() { try { guard.afterRead(); } catch (error) { guardFailed = true; throw error; } },
  };
  let event;
  try {
    event = await loadCampusEvent(target.schoolId, target.id, target.source, checkedGuard);
  } catch (error) {
    // Budget, deadline and abort exceptions remain terminal. A source failure
    // never triggers another collection lookup or produces an empty success.
    if (guardFailed) throw error;
    return unavailable('SOURCE_UNAVAILABLE');
  }
  guard.afterRead();
  if (!event) return unavailable('NOT_FOUND');
  if (!event.endsAt) return unavailable('MISSING_END_TIME');
  const location = plain(event.location);
  let item: PublicEventSourceItem;
  try {
    item = parsePublicEventSource({ schoolId: event.schoolId, source: event.source, id: event.id,
      title: plain(event.title), startsAt: event.startsAt, endsAt: event.endsAt, href: publicEventHref(target),
      ...(location ? { location } : {}) }, target);
  } catch {
    return unavailable('INVALID_EVENT');
  }
  const verifiedAt = now();
  if (Date.parse(item.startsAt) <= verifiedAt) return unavailable('EVENT_NOT_FUTURE');
  let args;
  try { args = publicEventArgs(item, verifiedAt); } catch { return unavailable('INVALID_EVENT'); }
  const result: PublicEventRead = { ...base(), status: 'ready', item,
    fingerprint: publicEventFingerprint(item), args };
  guard.afterRead();
  return parsePublicEventResult(result, target, verifiedAt);
}
