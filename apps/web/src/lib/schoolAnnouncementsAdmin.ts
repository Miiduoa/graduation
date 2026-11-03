import {
  collection,
  getDocsFromServer,
  limit,
  orderBy,
  query,
} from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { getDb, getFunctionsInstance, isFirebaseConfigured, type Announcement } from '@/lib/firebase';

export type SchoolAnnouncementDraft = {
  title: string;
  body: string;
  source: string;
  pinned: boolean;
};

export type UpsertSchoolAnnouncementInput = {
  schoolId: string;
  announcementId?: string | null;
  title: string;
  body?: string;
  source?: string;
  pinned?: boolean;
};

export type UpsertSchoolAnnouncementResult = {
  success: boolean;
  announcementId: string;
};

const TITLE_MAX = 160;
const BODY_MAX = 4000;
const SOURCE_MAX = 160;
const LIST_LIMIT = 80;

function publishedDate(value: unknown): string {
  const date =
    typeof value === 'string'
      ? new Date(value)
      : value &&
          typeof value === 'object' &&
          'toDate' in value &&
          typeof (value as { toDate?: unknown }).toDate === 'function'
        ? (value as { toDate: () => Date }).toDate()
        : null;
  return date instanceof Date && Number.isFinite(date.getTime()) ? date.toISOString() : '';
}

function normalizeAdminAnnouncement(
  document: { id: string; data: () => Record<string, unknown> },
  schoolId: string,
): Announcement {
  const data = document.data();
  const title = typeof data.title === 'string' ? data.title.trim() : '';
  if (!title) throw new Error('Invalid announcement');
  if (data.schoolId != null && data.schoolId !== schoolId) throw new Error('Invalid announcement');
  const body = typeof data.body === 'string' ? data.body : '';
  return {
    id: document.id,
    title,
    body,
    summary: body,
    publishedAt: publishedDate(data.publishedAt),
    source: typeof data.source === 'string' ? data.source : undefined,
    pinned: data.pinned === true,
    schoolId,
  };
}

/** 校管列表：直接讀 schools/{id}/announcements，不做公開牆過濾。 */
export async function listSchoolAnnouncementsForAdmin(
  schoolId: string,
): Promise<Announcement[]> {
  if (!schoolId.trim()) throw new Error('Missing schoolId');
  if (!isFirebaseConfigured()) throw new Error('Announcement source unavailable');
  const snapshot = await getDocsFromServer(
    query(
      collection(getDb(), 'schools', schoolId, 'announcements'),
      orderBy('publishedAt', 'desc'),
      limit(LIST_LIMIT),
    ),
  );
  return snapshot.docs.flatMap((document) => {
    try {
      return [normalizeAdminAnnouncement(document, schoolId)];
    } catch {
      return [];
    }
  });
}

export function validateSchoolAnnouncementDraft(
  draft: SchoolAnnouncementDraft,
): { ok: true; value: SchoolAnnouncementDraft } | { ok: false; error: string } {
  const title = draft.title.trim();
  if (!title) return { ok: false, error: '請輸入標題' };
  if (title.length > TITLE_MAX) return { ok: false, error: `標題最多 ${TITLE_MAX} 字` };
  const body = draft.body.trim();
  if (body.length > BODY_MAX) return { ok: false, error: `內容最多 ${BODY_MAX} 字` };
  const source = draft.source.trim();
  if (source.length > SOURCE_MAX) return { ok: false, error: `來源最多 ${SOURCE_MAX} 字` };
  return {
    ok: true,
    value: {
      title,
      body,
      source,
      pinned: draft.pinned === true,
    },
  };
}

/** 與手機 AdminDashboard 相同的既有 callable。授權由後端既有檢查負責。 */
export async function upsertSchoolAnnouncement(
  input: UpsertSchoolAnnouncementInput,
): Promise<UpsertSchoolAnnouncementResult> {
  const schoolId = input.schoolId?.trim() ?? '';
  if (!schoolId) throw new Error('Missing schoolId');
  const validated = validateSchoolAnnouncementDraft({
    title: input.title ?? '',
    body: input.body ?? '',
    source: input.source ?? '',
    pinned: input.pinned === true,
  });
  if (!validated.ok) throw new Error(validated.error);
  if (!isFirebaseConfigured()) throw new Error('Functions unavailable');

  const callable = httpsCallable<
    UpsertSchoolAnnouncementInput,
    UpsertSchoolAnnouncementResult
  >(getFunctionsInstance(), 'upsertSchoolAnnouncement');
  const result = await callable({
    schoolId,
    announcementId: input.announcementId ?? null,
    title: validated.value.title,
    body: validated.value.body,
    source: validated.value.source || undefined,
    pinned: validated.value.pinned,
  });
  if (!result.data?.success || !result.data.announcementId) {
    throw new Error('Announcement save not confirmed');
  }
  return result.data;
}

export function announcementPublicHref(announcementId: string, schoolId: string): string {
  const params = new URLSearchParams({ schoolId, campus: schoolId });
  return `/announcements/${encodeURIComponent(announcementId)}?${params.toString()}`;
}
