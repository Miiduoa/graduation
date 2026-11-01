'use strict';

const { createHash } = require('node:crypto');
const { HttpsError } = require('firebase-functions/v2/https');
const { understandCampusUtterance, unavailable } = require('./semanticCampusIntent');
const { GROQ_MODEL } = require('./freeCloudModel');

const CACHE_MS = 60_000;
const MAX_ENTRIES = 128;
const MAX_UID_ENTRIES = 15;
const DEADLINE_MS = 30_000;
const record = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const exactKeys = (value, keys) => record(value) && Object.keys(value).sort().join(',') === keys;

function validateSemanticConsent(data) {
  if (
    !record(data) ||
    typeof data.utterance !== 'string' ||
    !data.utterance ||
    data.utterance !== data.utterance.trim() ||
    data.utterance.length > 400 ||
    Array.from(data.utterance).some((ch) => ch.charCodeAt(0) < 32 || ch.charCodeAt(0) === 127) ||
    typeof data.schoolId !== 'string' ||
    !/^[a-zA-Z0-9_-]{2,40}$/.test(data.schoolId)
  ) {
    throw new HttpsError('invalid-argument', '請提供已核對的文字與校園。');
  }
  const consent = data.consent;
  if (
    !exactKeys(consent, 'model,provider,purpose,schoolId,utterance,version') ||
    consent.version !== 1 ||
    consent.purpose !== 'campus-service-entry' ||
    consent.provider !== 'groq' ||
    consent.model !== GROQ_MODEL ||
    consent.schoolId !== data.schoolId ||
    consent.utterance !== data.utterance
  ) {
    throw new HttpsError('failed-precondition', '請先確認雲端供應商與本次傳送資料。', {
      reason: 'cloud-consent-required',
    });
  }
  if (
    !exactKeys(data, 'consent,requestId,schoolId,utterance') ||
    typeof data.requestId !== 'string' ||
    !/^[a-zA-Z0-9_-]{8,128}$/.test(data.requestId)
  ) {
    throw new HttpsError('invalid-argument', '請重新確認這次請求。');
  }
  return data;
}

class Interrupted extends Error {
  constructor(reason) {
    super(reason);
    this.reason = reason;
  }
}

function createSemanticConsentTask(deps = {}) {
  const entries = new Map();
  const now = deps.now ?? Date.now;
  const deadlineMs = Math.max(1, Math.min(DEADLINE_MS, deps.deadlineMs ?? DEADLINE_MS));
  const interpret = deps.interpret ?? understandCampusUtterance;
  const enforceLimit = deps.enforceLimit ?? require('../securityUtils').enforceRateLimit;
  const getDb = () => require('firebase-admin/firestore').getFirestore();
  const assertAccount =
    deps.assertAccount ??
    ((uid) => require('../accountLifecycle').assertAccountAvailable(getDb(), uid));
  const assertMembership =
    deps.assertMembership ??
    ((schoolId, uid) =>
      require('../authz').createAuthzHelpers(getDb()).assertActiveSchoolMember(schoolId, uid));

  function response(data, outcome) {
    return {
      ...outcome,
      previews: [],
      provider: 'groq',
      model: GROQ_MODEL,
      requestId: data.requestId,
      schoolId: data.schoolId,
      utterance: data.utterance,
      checkedAt: new Date(now()).toISOString(),
    };
  }

  async function perform(uid, data, cached) {
    const controller = new AbortController();
    let stopped = false;
    let rejectTimeout;
    const interrupted = new Promise((_, reject) => {
      rejectTimeout = reject;
    });
    interrupted.catch(() => {});
    const timer = setTimeout(() => {
      stopped = true;
      controller.abort();
      rejectTimeout(new Interrupted('timeout'));
    }, deadlineMs);
    async function bounded(operation) {
      if (stopped) throw new Interrupted('timeout');
      const result = await Promise.race([
        Promise.resolve().then(() => {
          if (stopped) throw new Interrupted('timeout');
          return operation();
        }),
        interrupted,
      ]);
      if (stopped) throw new Interrupted('timeout');
      return result;
    }
    async function access() {
      try {
        await bounded(() => assertAccount(uid));
      } catch (error) {
        throw error instanceof Interrupted ? error : new Interrupted('account_changed');
      }
      try {
        const member = await bounded(() => assertMembership(data.schoolId, uid));
        if (!member || typeof member !== 'object') throw new Error('Membership unavailable');
      } catch (error) {
        throw error instanceof Interrupted ? error : new Interrupted('permission_changed');
      }
    }
    try {
      await access();
      if (cached) return response(data, cached);
      try {
        enforceLimit({
          scope: 'understand-campus-request',
          key: uid,
          limit: 15,
          windowMs: 5 * 60 * 1000,
        });
      } catch {
        return response(data, unavailable('rate_limited', 60));
      }
      const result = await bounded(() =>
        interpret({
          utterance: data.utterance,
          schoolId: data.schoolId,
          signal: controller.signal,
        }),
      );
      await access();
      return response(data, result);
    } catch (error) {
      return response(
        data,
        unavailable(error instanceof Interrupted ? error.reason : 'provider_error'),
      );
    } finally {
      stopped = true;
      clearTimeout(timer);
      controller.abort();
    }
  }

  return async function run(uid, input) {
    if (typeof uid !== 'string' || !uid)
      throw new HttpsError('unauthenticated', 'Must be logged in');
    const validated = validateSemanticConsent(input);
    const data = {
      schoolId: validated.schoolId,
      utterance: validated.utterance,
      requestId: validated.requestId,
    };
    const key = JSON.stringify([uid, data.schoolId, data.requestId]);
    const digest = createHash('sha256')
      .update(JSON.stringify([data.schoolId, data.utterance]))
      .digest('hex');
    for (const [oldKey, entry] of entries) {
      if (!entry.pending && entry.expiresAt <= now()) entries.delete(oldKey);
    }
    let entry = entries.get(key);
    if (entry && entry.digest !== digest)
      throw new HttpsError('invalid-argument', '請勿重複使用不同內容的請求編號。');
    if (entry?.pending) return entry.pending;
    if (entry?.result) {
      const result = await perform(uid, data, entry.result);
      if (
        (result.reason === 'account_changed' || result.reason === 'permission_changed') &&
        entries.get(key) === entry
      )
        entries.delete(key);
      return result;
    }
    if (!entry) {
      if (
        entries.size >= MAX_ENTRIES ||
        [...entries.values()].filter((candidate) => candidate.uid === uid).length >= MAX_UID_ENTRIES
      )
        return response(data, unavailable('rate_limited', 60));
      entry = { uid, digest, expiresAt: now() + CACHE_MS, pending: null, result: null };
      entries.set(key, entry);
    }
    entry.pending = perform(uid, data, null)
      .then((result) => {
        // Admission failures retain no binding; a rejected caller cannot fill the shared cache.
        if (
          (result.reason === 'account_changed' || result.reason === 'permission_changed') &&
          entries.get(key) === entry
        )
          entries.delete(key);
        // Other failures keep their bounded binding for an explicit same-ID retry.
        entry.result = result.status === 'unavailable' ? null : result;
        return result;
      })
      .finally(() => {
        entry.pending = null;
        entry.expiresAt = now() + CACHE_MS;
      });
    return entry.pending;
  };
}

module.exports = {
  createSemanticConsentTask,
  validateSemanticConsent,
  CACHE_MS,
  MAX_ENTRIES,
  MAX_UID_ENTRIES,
  DEADLINE_MS,
};
