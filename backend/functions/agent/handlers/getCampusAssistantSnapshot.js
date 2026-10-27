'use strict';

const { onCall: firebaseOnCall, HttpsError } = require('firebase-functions/v2/https');
const { getFirestore } = require('firebase-admin/firestore');
const { createAccountGuardedOnCall } = require('../../accountLifecycle');
const { createAuthzHelpers } = require('../../authz');
const { enforceRateLimit } = require('../../securityUtils');
const {
  fetchAssistantUserProfile,
  fetchAssistantTodaySchedule,
  fetchAssistantPendingAssignments,
  fetchAssistantAnnouncements,
} = require('../../lib/assistantFetchers');
const { toJsDate } = require('../../lib/assistantFormat');
const { summarizeAssignmentRows } = require('../assignmentSummary');

const onCall = createAccountGuardedOnCall({
  onCall: firebaseOnCall,
  getDb: () => getFirestore(),
});

function toIso(value) {
  const date = toJsDate(value);
  return date && Number.isFinite(date.getTime()) ? date.toISOString() : null;
}

function summarizeSettled(result, map, fallback) {
  if (result.status !== 'fulfilled') return fallback;
  try {
    return map(result.value);
  } catch {
    return fallback;
  }
}

module.exports = onCall(
  {
    region: 'asia-east1',
    timeoutSeconds: 45,
    memory: '512MiB',
    preflight(request) {
      if (!request.auth?.uid) throw new HttpsError('unauthenticated', 'Must be logged in');
      const id = request.data?.schoolId;
      if (id !== undefined && (typeof id !== 'string' || !/^[A-Za-z0-9_-]{1,40}$/.test(id))) {
        throw new HttpsError('invalid-argument', 'Invalid school');
      }
    },
  },
  async (request) => {
    const uid = request.auth.uid;
    enforceRateLimit({ scope: 'campus-sense-snapshot', key: uid, limit: 12, windowMs: 5 * 60 * 1000 });

    const profile = await fetchAssistantUserProfile(uid);
    const schoolId = request.data?.schoolId || profile?.schoolId;
    if (!schoolId) throw new HttpsError('failed-precondition', 'Select a school');
    await createAuthzHelpers(getFirestore()).assertActiveSchoolMember(schoolId, uid);

    const [scheduleResult, assignmentsResult, announcementsResult] = await Promise.allSettled([
      fetchAssistantTodaySchedule(uid, schoolId),
      fetchAssistantPendingAssignments(uid, schoolId),
      fetchAssistantAnnouncements(schoolId),
    ]);

    const schedule = summarizeSettled(scheduleResult, (value) => {
      if (value?.status !== 'available' || !Array.isArray(value.slots)) {
        return { status: 'unavailable', count: null };
      }
      return { status: 'available', count: value.slots.length };
    }, { status: 'unavailable', count: null });

    const assignments = summarizeSettled(assignmentsResult, summarizeAssignmentRows,
      { status: 'unavailable', count: null, items: [] });

    const announcements = summarizeSettled(announcementsResult, (items) => ({
      status: 'available',
      items: (Array.isArray(items) ? items : []).slice(0, 8).map((item) => ({
        title: String(item.title || '').slice(0, 140),
        publishedAt: toIso(item.publishedAt),
      })),
    }), { status: 'unavailable', items: [] });

    // Membership may change while independent readers are running.
    // Do not deliver a personal snapshot after the selected school's grant is revoked.
    await createAuthzHelpers(getFirestore()).assertActiveSchoolMember(schoolId, uid);
    return {
      schoolId,
      checkedAt: new Date().toISOString(),
      schedule,
      assignments,
      announcements,
    };
  },
);
