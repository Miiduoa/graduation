import { httpsCallable } from 'firebase/functions';

import { getFunctionsInstance } from '../firebase';

type SuccessResponse = { success: boolean };

export async function upsertSchoolAnnouncement(input: {
  schoolId: string;
  announcementId?: string | null;
  title: string;
  body?: string;
  source?: string;
  pinned?: boolean;
}): Promise<{ success: boolean; announcementId: string }> {
  const callable = httpsCallable<typeof input, { success: boolean; announcementId: string }>(
    getFunctionsInstance(),
    'upsertSchoolAnnouncement',
  );
  const result = await callable(input);
  return result.data;
}

export async function deleteSchoolAnnouncement(input: {
  schoolId: string;
  announcementId: string;
}): Promise<SuccessResponse> {
  const callable = httpsCallable<typeof input, SuccessResponse>(
    getFunctionsInstance(),
    'deleteSchoolAnnouncement',
  );
  const result = await callable(input);
  return result.data;
}

export async function bulkUpdateSchoolAnnouncements(input: {
  schoolId: string;
  announcementIds: string[];
  action: 'delete' | 'pin' | 'unpin';
}): Promise<{ success: boolean; count: number }> {
  const callable = httpsCallable<typeof input, { success: boolean; count: number }>(
    getFunctionsInstance(),
    'bulkUpdateSchoolAnnouncements',
  );
  const result = await callable(input);
  return result.data;
}

export async function upsertSchoolEvent(input: {
  schoolId: string;
  eventId?: string | null;
  title: string;
  description?: string;
  location?: string;
  capacity?: number | string | null;
  startsAt?: string | null;
  endsAt?: string | null;
}): Promise<{ success: boolean; eventId: string }> {
  const callable = httpsCallable<typeof input, { success: boolean; eventId: string }>(
    getFunctionsInstance(),
    'upsertSchoolEvent',
  );
  const result = await callable(input);
  return result.data;
}

export async function deleteSchoolEvent(input: {
  schoolId: string;
  eventId: string;
}): Promise<SuccessResponse> {
  const callable = httpsCallable<typeof input, SuccessResponse>(
    getFunctionsInstance(),
    'deleteSchoolEvent',
  );
  const result = await callable(input);
  return result.data;
}

export async function bulkDeleteSchoolEvents(input: {
  schoolId: string;
  eventIds: string[];
}): Promise<{ success: boolean; count: number }> {
  const callable = httpsCallable<typeof input, { success: boolean; count: number }>(
    getFunctionsInstance(),
    'bulkDeleteSchoolEvents',
  );
  const result = await callable(input);
  return result.data;
}

export async function updateSchoolMemberRole(input: {
  schoolId: string;
  targetUid: string;
  role: 'admin' | 'editor' | 'member';
}): Promise<SuccessResponse> {
  const callable = httpsCallable<typeof input, SuccessResponse>(
    getFunctionsInstance(),
    'updateSchoolMemberRole',
  );
  const result = await callable(input);
  return result.data;
}

export async function updateSchoolServiceRole(input: {
  schoolId: string;
  targetUid: string;
  status?: 'active' | 'inactive';
  orders?: boolean;
  repairs?: boolean;
  packages?: boolean;
  printing?: boolean;
  health?: boolean;
}): Promise<SuccessResponse> {
  const callable = httpsCallable<typeof input, SuccessResponse>(
    getFunctionsInstance(),
    'updateSchoolServiceRole',
  );
  const result = await callable(input);
  return result.data;
}

export async function upsertSchoolCafeteriaConfig(input: {
  schoolId: string;
  cafeteriaId: string;
  name: string;
  location?: string | null;
  openingHours?: string | null;
  brandKey?: string | null;
  pilotStatus: 'inactive' | 'pilot' | 'live';
  orderingEnabled: boolean;
}): Promise<{ success: boolean; cafeteriaId: string }> {
  const callable = httpsCallable<typeof input, { success: boolean; cafeteriaId: string }>(
    getFunctionsInstance(),
    'upsertSchoolCafeteriaConfig',
  );
  const result = await callable(input);
  return result.data;
}

export async function upsertCafeteriaOperatorAssignment(input: {
  schoolId: string;
  cafeteriaId: string;
  targetUid: string;
  displayName?: string | null;
  email?: string | null;
  role?: 'owner' | 'manager' | 'staff';
  status?: 'active' | 'inactive';
}): Promise<{ success: boolean; activeOperatorCount: number }> {
  const callable = httpsCallable<typeof input, { success: boolean; activeOperatorCount: number }>(
    getFunctionsInstance(),
    'upsertCafeteriaOperatorAssignment',
  );
  const result = await callable(input);
  return result.data;
}

export async function clearSchoolAdminTestData(input: {
  schoolId: string;
}): Promise<{ success: boolean; deleted: { announcements: number; events: number } }> {
  const callable = httpsCallable<
    typeof input,
    { success: boolean; deleted: { announcements: number; events: number } }
  >(getFunctionsInstance(), 'clearSchoolAdminTestData');
  const result = await callable(input);
  return result.data;
}
