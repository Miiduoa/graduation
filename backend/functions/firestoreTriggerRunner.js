'use strict';

const nodeCrypto = require('node:crypto');
const os = require('node:os');

const LEASE_COLLECTION = '_flyRuntime';
const LEASE_DOC_ID = 'firestoreTriggerLease';
const PROCESSED_COLLECTION = 'processed';
const WATERMARK_COLLECTION = 'watermarks';
const DEFAULT_LEASE_MS = 45_000;
const DEFAULT_HEARTBEAT_MS = 15_000;

const TRIGGER_POLICIES = {
  onUserProfileChanged: { sideEffect: 'sync', createdOnly: false },
  onSchoolMembershipChanged: { sideEffect: 'sync', createdOnly: false },
  onCafeteriaOperatorChanged: { sideEffect: 'sync', createdOnly: false },
  onInspectionWritten: { sideEffect: 'sync', createdOnly: false },
  groupQuestionAssistantReply: { sideEffect: 'notify', createdOnly: true },
  gradePublishedNotification: { sideEffect: 'notify', createdOnly: true },
  onCafeteriaStorefrontPostCreated: { sideEffect: 'notify', createdOnly: true },
};

function policyFor(trigger) {
  const named = TRIGGER_POLICIES[trigger.name] || {};
  const createdOnly =
    named.createdOnly ??
    trigger.createdOnly ??
    String(trigger.eventType || '').includes('.created');
  const sideEffect = named.sideEffect || (createdOnly ? 'notify' : 'sync');
  return { createdOnly, sideEffect };
}

function paramsFromPath(pattern, path) {
  if (!pattern || !path) return null;
  const patternParts = String(pattern).split('/').filter(Boolean);
  const pathParts = String(path).split('/').filter(Boolean);
  if (patternParts.length !== pathParts.length) return null;
  const params = {};
  for (let i = 0; i < patternParts.length; i += 1) {
    const token = patternParts[i];
    if (token.startsWith('{') && token.endsWith('}')) {
      params[token.slice(1, -1)] = pathParts[i];
    } else if (token !== pathParts[i]) {
      return null;
    }
  }
  return params;
}

function listenQuery(db, documentPattern) {
  const parts = String(documentPattern || '')
    .split('/')
    .filter(Boolean);
  if (parts.length < 2) return null;
  if (parts.length === 2) {
    return db.collection(parts[0]);
  }
  return db.collectionGroup(parts[parts.length - 2]);
}

function missingSnapshot(id, ref) {
  return {
    exists: false,
    id,
    ref,
    data: () => undefined,
    get: () => undefined,
    updateTime: undefined,
    createTime: undefined,
  };
}

function versionOf(snap) {
  if (!snap || snap.exists === false) return 'missing';
  const stamp = snap.updateTime || snap.createTime;
  if (!stamp) return 'unknown';
  if (typeof stamp.toMillis === 'function') return String(stamp.toMillis());
  if (typeof stamp.toDate === 'function') return String(stamp.toDate().getTime());
  if (typeof stamp === 'number') return String(stamp);
  if (typeof stamp === 'string') return stamp;
  return String(stamp);
}

function changeVersion(changeType, beforeSnap, afterSnap) {
  return `${changeType}:${versionOf(afterSnap)}:${versionOf(beforeSnap)}`;
}

function markerId(triggerName, path) {
  const digest = nodeCrypto.createHash('sha256').update(`${triggerName}\0${path}`).digest('hex');
  return `${String(triggerName).slice(0, 40)}_${digest.slice(0, 40)}`;
}

function leaseRef(db) {
  return db.collection(LEASE_COLLECTION).doc(LEASE_DOC_ID);
}

function markerRef(db, triggerName, path) {
  return leaseRef(db).collection(PROCESSED_COLLECTION).doc(markerId(triggerName, path));
}

function watermarkRef(db, triggerName) {
  return leaseRef(db).collection(WATERMARK_COLLECTION).doc(triggerName);
}

async function readWatermarkMs(db, triggerName) {
  const snap = await watermarkRef(db, triggerName).get();
  if (!snap.exists) return 0;
  return Number(snap.data()?.watermarkMs) || 0;
}

async function writeWatermarkMs(db, triggerName, watermarkMs) {
  await watermarkRef(db, triggerName).set(
    {
      triggerName,
      watermarkMs,
      updatedAtMs: watermarkMs,
    },
    { merge: true },
  );
}

async function readMarker(db, triggerName, path) {
  const snap = await markerRef(db, triggerName, path).get();
  if (!snap.exists) return null;
  return snap.data() || null;
}

async function writeMarker(db, triggerName, path, version, now) {
  await markerRef(db, triggerName, path).set(
    {
      triggerName,
      path,
      version,
      processedAtMs: now(),
    },
    { merge: true },
  );
}

async function tryAcquireLease(db, { holderId, now, leaseMs }) {
  const ref = leaseRef(db);
  return db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const data = snap.exists ? snap.data() || {} : {};
    const expiresAtMs = Number(data.expiresAtMs) || 0;
    if (data.holderId && data.holderId !== holderId && expiresAtMs > now()) {
      return false;
    }
    tx.set(
      ref,
      {
        holderId,
        expiresAtMs: now() + leaseMs,
        heartbeatAtMs: now(),
      },
      { merge: true },
    );
    return true;
  });
}

async function releaseLease(db, { holderId, now = Date.now }) {
  const ref = leaseRef(db);
  return db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const data = snap.exists ? snap.data() || {} : {};
    if (data.holderId !== holderId) return false;
    tx.set(
      ref,
      {
        holderId: null,
        expiresAtMs: 0,
        releasedAtMs: now(),
      },
      { merge: true },
    );
    return true;
  });
}

function createChangeEvent(trigger, params, beforeSnap, afterSnap) {
  const { createdOnly } = policyFor(trigger);
  if (createdOnly) {
    return {
      params,
      data: afterSnap?.exists === false ? null : afterSnap,
    };
  }
  return {
    params,
    data: {
      before: beforeSnap,
      after: afterSnap,
    },
  };
}

async function processChange(trigger, change, { cache, db, isInitial, now, watermarkMs = 0 }) {
  const doc = change.doc;
  if (!doc?.ref?.path) return { status: 'ignored' };
  const path = doc.ref.path;
  const params = paramsFromPath(trigger.document, path);
  if (!params) return { status: 'filtered' };

  const policy = policyFor(trigger);
  const beforeCached = cache.get(path);
  let afterSnap;
  let beforeSnap;

  if (change.type === 'removed') {
    afterSnap = missingSnapshot(doc.id, doc.ref);
    beforeSnap = beforeCached || doc;
    cache.delete(path);
  } else {
    afterSnap = doc;
    beforeSnap = beforeCached || missingSnapshot(doc.id, doc.ref);
    cache.set(path, doc);
  }

  if (policy.createdOnly && change.type !== 'added') {
    return { status: 'skipped-not-create' };
  }

  const version = policy.createdOnly
    ? `created:${versionOf(afterSnap)}`
    : changeVersion(change.type, beforeSnap, afterSnap);
  const marker = await readMarker(db, trigger.name, path);

  if (marker?.version === version) {
    return { status: 'already-processed' };
  }

  // First-ever start has no watermark: record markers so history is not spammed.
  // After a watermark exists, the first snapshot is catch-up and must run
  // unmarked notify work (grades / group questions written while we were down).
  if (policy.sideEffect === 'notify' && isInitial && !watermarkMs) {
    await writeMarker(db, trigger.name, path, version, now);
    return { status: 'marked-bootstrap' };
  }

  const event = createChangeEvent(trigger, params, beforeSnap, afterSnap);
  await trigger.handler(event);
  await writeMarker(db, trigger.name, path, version, now);
  return { status: 'processed' };
}

function watchTrigger(db, trigger, { now, log }) {
  const query = listenQuery(db, trigger.document);
  if (!query || typeof query.onSnapshot !== 'function') {
    log.warn(`[firestore-triggers] no query for ${trigger.name}`);
    return () => {};
  }
  if (typeof trigger.handler !== 'function') {
    log.warn(`[firestore-triggers] missing handler for ${trigger.name}`);
    return () => {};
  }

  const cache = new Map();
  let isInitial = true;
  let queue = Promise.resolve();

  const enqueue = (work) => {
    const run = queue.then(work, work);
    queue = run.catch((error) => {
      log.error(`[firestore-triggers] ${trigger.name} failed`, error);
    });
    return queue;
  };

  const unsubscribe = query.onSnapshot(
    (snapshot) => {
      const initial = isInitial;
      isInitial = false;
      enqueue(async () => {
        const changes =
          typeof snapshot.docChanges === 'function' ? snapshot.docChanges() : snapshot.docChanges || [];
        const watermarkMs = await readWatermarkMs(db, trigger.name);
        for (const change of changes) {
          await processChange(trigger, change, {
            cache,
            db,
            isInitial: initial,
            now,
            watermarkMs,
          });
        }
        if (initial) {
          await writeWatermarkMs(db, trigger.name, now());
        }
      });
    },
    (error) => {
      log.error(`[firestore-triggers] ${trigger.name} listener error`, error);
    },
  );

  return {
    stop: typeof unsubscribe === 'function' ? unsubscribe : () => {},
    flush: () => queue,
  };
}

async function startFirestoreTriggerRunner({
  db,
  triggers = [],
  holderId = `${os.hostname()}:${process.pid}:${nodeCrypto.randomBytes(4).toString('hex')}`,
  now = Date.now,
  leaseMs = DEFAULT_LEASE_MS,
  heartbeatMs = DEFAULT_HEARTBEAT_MS,
  enabled = true,
  log = console,
} = {}) {
  const handles = [];
  let heartbeatTimer = null;
  let holdingLease = false;

  const detach = () => {
    for (const handle of handles.splice(0)) {
      try {
        handle.stop();
      } catch (error) {
        log.error('[firestore-triggers] stop failed', error);
      }
    }
  };

  const attach = () => {
    if (handles.length > 0) return;
    for (const trigger of triggers) {
      if (!trigger?.document || typeof trigger.handler !== 'function') continue;
      handles.push(watchTrigger(db, trigger, { now, log }));
    }
    log.log(
      `[firestore-triggers] listening: ${handles.length ? triggers.map((item) => item.name).join(', ') : '(none)'}`,
    );
  };

  const tick = async () => {
    const acquired = await tryAcquireLease(db, { holderId, now, leaseMs });
    if (acquired) {
      if (!holdingLease) {
        holdingLease = true;
        attach();
      }
      return;
    }
    if (holdingLease) {
      holdingLease = false;
      log.warn('[firestore-triggers] lost lease; detaching listeners');
      detach();
    }
  };

  const stop = async () => {
    if (heartbeatTimer) {
      clearInterval(heartbeatTimer);
      heartbeatTimer = null;
    }
    detach();
    if (holdingLease) {
      holdingLease = false;
      await releaseLease(db, { holderId, now });
    } else {
      holdingLease = false;
    }
  };

  if (!enabled) {
    return {
      stop,
      flush: async () => {},
      isHoldingLease: () => false,
      holderId,
    };
  }

  if (!db) {
    throw new Error('Firestore trigger runner requires a Firestore instance');
  }

  await tick();
  heartbeatTimer = setInterval(() => {
    tick().catch((error) => log.error('[firestore-triggers] lease heartbeat failed', error));
  }, heartbeatMs);
  if (typeof heartbeatTimer.unref === 'function') heartbeatTimer.unref();

  return {
    stop,
    flush: async () => {
      await Promise.all(handles.map((handle) => handle.flush()));
    },
    isHoldingLease: () => holdingLease,
    holderId,
  };
}

module.exports = {
  DEFAULT_HEARTBEAT_MS,
  DEFAULT_LEASE_MS,
  LEASE_COLLECTION,
  LEASE_DOC_ID,
  TRIGGER_POLICIES,
  WATERMARK_COLLECTION,
  changeVersion,
  listenQuery,
  markerId,
  paramsFromPath,
  policyFor,
  releaseLease,
  startFirestoreTriggerRunner,
  tryAcquireLease,
  versionOf,
};
