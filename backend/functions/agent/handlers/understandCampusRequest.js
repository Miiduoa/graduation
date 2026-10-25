'use strict';

const { onCall: firebaseOnCall, HttpsError } = require('firebase-functions/v2/https');
const { createAccountGuardedOnCall } = require('../../accountLifecycle');
const { assertToolInputBounds } = require('../inputLimits');
const { enforceRateLimit } = require('../../securityUtils');
const { understandCampusUtterance } = require('../semanticCampusIntent');
const { connectCampusServiceData } = require('../semanticCampusData');

const onCall = createAccountGuardedOnCall({
  onCall: firebaseOnCall,
  getDb: () => require('firebase-admin/firestore').getFirestore(),
});

module.exports = onCall(
  {
    region: 'asia-east1',
    timeoutSeconds: 30,
    memory: '256MiB',
    preflight(request) {
      if (!request.auth?.uid) throw new HttpsError('unauthenticated', 'Must be logged in');
      assertToolInputBounds(request.data);
      const utterance = request.data?.utterance;
      if (typeof utterance !== 'string' || !utterance.trim() || utterance.length > 400) {
        throw new HttpsError('invalid-argument', 'Utterance must contain 1–400 characters');
      }
      const schoolId = request.data?.schoolId;
      if (schoolId !== undefined && (typeof schoolId !== 'string' || schoolId.length > 40)) {
        throw new HttpsError('invalid-argument', 'Invalid school scope');
      }
    },
  },
  async (request) => {
    try {
      enforceRateLimit({
        scope: 'understand-campus-request',
        key: request.auth.uid,
        limit: 15,
        windowMs: 5 * 60 * 1000,
      });
    } catch {
      throw new HttpsError('resource-exhausted', 'Too many AI requests');
    }
    const utterance = request.data.utterance;
    const schoolId = request.data.schoolId || '';
    const semantic = await understandCampusUtterance({ utterance, schoolId });
    if (semantic.status !== 'understood' || !Array.isArray(semantic.destinations)) {
      return { ...semantic, previews: [] };
    }
    const previews = await connectCampusServiceData({
      uid: request.auth.uid,
      schoolId,
      utterance,
      destinations: semantic.destinations,
    });
    return { ...semantic, previews };
  },
);
