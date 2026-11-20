/** 加好友 QR / deep link：`campus://add-friend?uid=<FirebaseAuthUid>` */

export function buildAddFriendDeepLink(uid: string): string {
  const q = encodeURIComponent(uid.trim());
  return `campus://add-friend?uid=${q}`;
}

export function parseAddFriendUid(raw: string): string | null {
  const s = raw.trim();
  const direct = /^campus:\/\/add-friend\?uid=([^&\s#]+)/i.exec(s);
  if (direct?.[1]) {
    try {
      return decodeURIComponent(direct[1]);
    } catch {
      return direct[1];
    }
  }
  return null;
}
