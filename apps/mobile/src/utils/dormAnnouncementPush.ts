export type DormAnnouncementTap = {
  schoolId?: string;
  dormAnnouncementId?: string;
  inboxNotificationId?: string;
  deliveryKey?: string;
};

export function isDormAnnouncementData(data: unknown): data is Record<string, unknown> {
  return (
    !!data &&
    typeof data === 'object' &&
    'type' in data &&
    data.type === 'announcement' &&
    'channel' in data &&
    data.channel === 'dormitory'
  );
}

export function parseDormAnnouncementTap(data: Record<string, unknown>): DormAnnouncementTap {
  const { schoolId, dormAnnouncementId, inboxNotificationId, deliveryKey } = data;
  return {
    schoolId:
      typeof schoolId === 'string' && /^[a-zA-Z0-9_-]{1,100}$/.test(schoolId)
        ? schoolId
        : undefined,
    dormAnnouncementId:
      typeof dormAnnouncementId === 'string' &&
      dormAnnouncementId.length > 0 &&
      dormAnnouncementId.length <= 128 &&
      !dormAnnouncementId.includes('/') &&
      !['.', '..'].includes(dormAnnouncementId)
        ? dormAnnouncementId
        : undefined,
    inboxNotificationId:
      typeof inboxNotificationId === 'string' && /^dorm_[0-9a-f]{64}$/.test(inboxNotificationId)
        ? inboxNotificationId
        : undefined,
    deliveryKey:
      typeof deliveryKey === 'string' &&
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(deliveryKey)
        ? deliveryKey
        : undefined,
  };
}
