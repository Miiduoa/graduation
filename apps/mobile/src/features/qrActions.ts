import { httpsCallable } from 'firebase/functions';
import { getFunctionsInstance, isFirebaseMockMode } from '../firebase';

export type CampusQrAction =
  | { kind: 'friend'; uid: string }
  | { kind: 'group'; joinCode: string }
  | { kind: 'link'; url: string }
  | { kind: 'unsupported'; purpose: 'attendance' | 'group' | 'other' }
  | { kind: 'text'; text: string }
  | { kind: 'invalid' };

function validId(value: unknown, maxLength = 160): value is string {
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    value.length <= maxLength &&
    value.trim() === value &&
    !/[\s/]/.test(value) &&
    !Array.from(value).some(
      (character) => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127,
    )
  );
}

export function parseCampusQrAction(raw: string): CampusQrAction {
  const value = raw.trim();
  if (!value || value.length > 4096) return { kind: 'invalid' };
  try {
    const url = new URL(value);
    if (url.protocol === 'campus:') {
      if (url.username || url.password || url.port || url.hash) return { kind: 'invalid' };
      if (url.hostname === 'add-friend' && (!url.pathname || url.pathname === '/')) {
        const entries = Array.from(url.searchParams.entries());
        const uid = url.searchParams.get('uid');
        return entries.length === 1 && entries[0][0] === 'uid' && validId(uid, 128)
          ? { kind: 'friend', uid }
          : { kind: 'invalid' };
      }
      if (url.hostname === 'group') {
        const match = /^\/join\/([a-z0-9]{8})$/i.exec(url.pathname);
        return match && !url.search
          ? { kind: 'group', joinCode: match[1].toUpperCase() }
          : { kind: 'unsupported', purpose: 'group' };
      }
      if (url.hostname === 'checkin' || url.hostname === 'attendance') {
        // Legacy checksums are not attendance authorization. Never reinterpret them as private tokens.
        return { kind: 'unsupported', purpose: 'attendance' };
      }
      return { kind: 'unsupported', purpose: 'other' };
    }
    if ((url.protocol === 'https:' || url.protocol === 'http:') && url.hostname) {
      if (url.username || url.password) return { kind: 'invalid' };
      return { kind: 'link', url: url.toString() };
    }
    return { kind: 'unsupported', purpose: 'other' };
  } catch {
    return /^campus:/i.test(value) ? { kind: 'invalid' } : { kind: 'text', text: value };
  }
}

export async function joinCampusGroupFromQr(input: {
  uid: string;
  schoolId: string;
  joinCode: string;
}): Promise<{ groupId: string; name: string }> {
  if (
    !validId(input.uid, 128) ||
    !validId(input.schoolId) ||
    !/^[A-Z0-9]{8}$/.test(input.joinCode) ||
    isFirebaseMockMode()
  )
    throw new Error('group-join-unavailable');
  const response = await httpsCallable<
    { schoolId: string; joinCode: string },
    {
      success?: unknown;
      ownerUid?: unknown;
      status?: unknown;
      groupId?: unknown;
      groupName?: unknown;
    }
  >(
    getFunctionsInstance(),
    'joinGroupByCode',
  )({
    schoolId: input.schoolId,
    joinCode: input.joinCode,
  });
  const data = response.data;
  if (
    !data ||
    data.success !== true ||
    data.ownerUid !== input.uid ||
    data.status !== 'active' ||
    !validId(data.groupId)
  )
    throw new Error('group-join-unconfirmed');
  return {
    groupId: data.groupId,
    name:
      typeof data.groupName === 'string' && data.groupName.trim() ? data.groupName.trim() : '群組',
  };
}
