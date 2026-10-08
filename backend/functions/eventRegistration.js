const { createHash } = require('crypto');
const { FieldValue, Timestamp } = require('firebase-admin/firestore');
const { HttpsError } = require('firebase-functions/v2/https');
const fail = (code, message) => {
  throw new HttpsError(code, message);
};
const validId = (value, name) => {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{1,160}$/.test(value))
    fail('invalid-argument', `Invalid ${name}`);
  return value;
};
const millis = (value) =>
  value instanceof Timestamp
    ? value.toMillis()
    : typeof value === 'string'
      ? Date.parse(value)
      : NaN;
const date = (value, name) => {
  const time = millis(value);
  if (!Number.isFinite(time)) fail('invalid-argument', `Invalid ${name}`);
  return Timestamp.fromMillis(time);
};
const countOf = (event) => {
  const count = event.appRegistrationCount;
  if (!Number.isSafeInteger(count) || count < 0)
    fail('failed-precondition', '活動報名人數需要管理員確認。');
  return count;
};
function normalizeRegistrationPolicy(input, previous, startsAt) {
  if (input === undefined) return previous;
  if (
    !input ||
    typeof input !== 'object' ||
    Array.isArray(input) ||
    typeof input.enabled !== 'boolean'
  )
    fail('invalid-argument', '請明確設定是否受理 App 報名。');
  if (!input.enabled) return { ...(previous ?? {}), version: 1, enabled: false };
  if (
    input.eligibility !== 'active-school-members' ||
    input.free !== true ||
    typeof input.allowCancellation !== 'boolean'
  )
    fail('invalid-argument', '僅支援本校有效會員參加的免費活動，請確認資格與取消規則。');
  const opensAt = date(input.opensAt, 'opensAt');
  const closesAt = date(input.closesAt, 'closesAt');
  const cancellationClosesAt = input.allowCancellation
    ? date(input.cancellationClosesAt, 'cancellationClosesAt')
    : null;
  const start = millis(startsAt);
  if (
    opensAt.toMillis() >= closesAt.toMillis() ||
    (Number.isFinite(start) && closesAt.toMillis() > start) ||
    (cancellationClosesAt &&
      (cancellationClosesAt.toMillis() < opensAt.toMillis() ||
        (Number.isFinite(start) && cancellationClosesAt.toMillis() > start)))
  )
    fail('invalid-argument', '報名或取消期限順序不正確，截止不得晚於活動開始。');
  return {
    version: 1,
    enabled: true,
    eligibility: 'active-school-members',
    free: true,
    opensAt,
    closesAt,
    allowCancellation: input.allowCancellation,
    cancellationClosesAt,
  };
}
async function prepareRegistrationPolicy({
  db,
  transaction,
  schoolId,
  eventId,
  previous = {},
  input,
  startsAt,
  capacity,
}) {
  let policy = normalizeRegistrationPolicy(input, previous.registrationPolicy, startsAt);
  if (policy?.eligibility) {
    const validated = normalizeRegistrationPolicy(
      { ...policy, enabled: true },
      previous.registrationPolicy,
      startsAt,
    );
    policy = { ...validated, enabled: policy.enabled };
  }
  if (policy?.enabled && previous.fee != null && previous.fee !== 0)
    fail('failed-precondition', '收費活動不支援 App 報名。');
  let count = previous.appRegistrationCount;
  if (capacity != null && (!Number.isSafeInteger(capacity) || capacity <= 0))
    fail('invalid-argument', '人數上限需為正整數。');
  if (count !== undefined && previous.registrationPolicy?.version !== 1)
    fail('failed-precondition', '舊報名人數尚未核對。');
  if (policy?.enabled && count === undefined) {
    if (previous.registeredCount != null && previous.registeredCount !== 0)
      fail('failed-precondition', '舊報名人數尚未核對，請先完成名單整理。');
    const paths = [
      ['schools', schoolId, 'clubEvents', eventId, 'registrations'],
      ['schools', schoolId, 'events', eventId, 'registrations'],
      ['events', eventId, 'registrations'],
    ];
    for (const path of paths) {
      const registrations = await transaction.get(db.collection(path.join('/')).limit(1));
      if (!registrations.empty)
        fail('failed-precondition', '已有舊報名名單，請先核對後再開啟 App 報名。');
    }
    const oldFlat = await transaction.get(
      db.collection('eventRegistrations').where('eventId', '==', eventId).limit(1),
    );
    if (!oldFlat.empty) fail('failed-precondition', '已有舊報名名單，請先核對後再開啟 App 報名。');
    count = 0;
  }
  if (count > 0 && policy && previous.registrationPolicy) {
    for (const field of [
      'free',
      'eligibility',
      'allowCancellation',
      'opensAt',
      'closesAt',
      'cancellationClosesAt',
    ]) {
      const before = previous.registrationPolicy[field];
      const after = policy[field];
      if (
        field.endsWith('At')
          ? millis(before) !== millis(after) && !(before == null && after == null)
          : before !== after
      )
        fail('failed-precondition', '仍有參加者時不可更改已接受的報名與取消規則；可以關閉新報名。');
    }
  }
  if (count !== undefined) {
    countOf({ appRegistrationCount: count });
    if (capacity != null && capacity < count)
      fail('failed-precondition', '人數上限不可少於目前 App 報名人數。');
  }
  return {
    ...(policy ? { registrationPolicy: policy } : {}),
    ...(count === undefined ? {} : { appRegistrationCount: count }),
  };
}
function eventState(eventId, event, registration, now) {
  const status =
    registration?.status === 'registered'
      ? 'registered'
      : registration?.status === 'cancelled'
        ? 'cancelled'
        : 'not_registered';
  const policy = event?.registrationPolicy;
  const count =
    Number.isSafeInteger(event?.appRegistrationCount) && event.appRegistrationCount >= 0
      ? event.appRegistrationCount
      : null;
  const capacity = event?.capacity == null ? null : event.capacity;
  const validCapacity = capacity === null || (Number.isSafeInteger(capacity) && capacity > 0);
  const validPolicy =
    policy?.version === 1 &&
    policy?.free === true &&
    policy?.eligibility === 'active-school-members' &&
    Number.isFinite(millis(policy?.opensAt)) &&
    Number.isFinite(millis(policy?.closesAt)) &&
    millis(policy.opensAt) < millis(policy.closesAt) &&
    typeof policy.allowCancellation === 'boolean' &&
    (!policy.allowCancellation || Number.isFinite(millis(policy.cancellationClosesAt)));
  const free = event?.fee == null || event.fee === 0;
  let availability = 'unavailable';
  if (validPolicy && count !== null && validCapacity && free && policy.enabled === true) {
    availability =
      now < millis(policy.opensAt)
        ? 'not_open'
        : now >= millis(policy.closesAt)
          ? 'closed'
          : capacity !== null && count >= capacity
            ? 'full'
            : 'open';
  }
  return {
    eventId,
    status,
    availability,
    policyConfirmed: Boolean(validPolicy && count !== null && validCapacity && free),
    count,
    capacity,
    canRegister: status !== 'registered' && availability === 'open',
    canCancel:
      status === 'registered' &&
      validPolicy &&
      count !== null &&
      policy.allowCancellation === true &&
      now < millis(policy.cancellationClosesAt),
    opensAt: validPolicy ? new Date(millis(policy.opensAt)).toISOString() : null,
    closesAt: validPolicy ? new Date(millis(policy.closesAt)).toISOString() : null,
    cancellationClosesAt:
      validPolicy && policy.allowCancellation
        ? new Date(millis(policy.cancellationClosesAt)).toISOString()
        : null,
  };
}
function scopeOf(request) {
  const uid = request.auth?.uid;
  if (!uid) fail('unauthenticated', '請先登入。');
  if (uid.includes('/')) fail('permission-denied', '無法確認帳號。');
  return { uid, schoolId: validId(request.data?.schoolId, 'schoolId') };
}
function requireMember(snapshot) {
  if (!snapshot.exists || snapshot.data().status !== 'active')
    fail('permission-denied', '僅限目前學校的有效會員使用。');
}
function createEventRegistrationHandlers({ db, now = Date.now }) {
  const getEventRegistrations = async (request) => {
    const { uid, schoolId } = scopeOf(request);
    const ids = request.data?.eventIds;
    if (!Array.isArray(ids) || !ids.length || ids.length > 40 || new Set(ids).size !== ids.length)
      fail('invalid-argument', 'Invalid eventIds');
    ids.forEach((id) => validId(id, 'eventId'));
    return db.runTransaction(async (transaction) => {
      const refs = ids.flatMap((id) => {
        const event = db.collection('schools').doc(schoolId).collection('clubEvents').doc(id);
        return [event, event.collection('registrations').doc(uid)];
      });
      const [member, user, ...snapshots] = await transaction.getAll(
        db.collection('schools').doc(schoolId).collection('members').doc(uid),
        db.collection('users').doc(uid),
        ...refs,
      );
      requireMember(member);
      if (user.data()?.accountDeletionInProgress === true)
        fail('permission-denied', '帳號正在刪除。');
      return {
        ok: true,
        states: ids.map((id, i) =>
          eventState(id, snapshots[i * 2].data(), snapshots[i * 2 + 1].data(), now()),
        ),
      };
    });
  };
  const mutate = (action) => async (request) => {
    const { uid, schoolId } = scopeOf(request);
    if (
      Object.keys(request.data ?? {}).some(
        (key) => !['schoolId', 'eventId', 'requestId'].includes(key),
      )
    )
      fail('invalid-argument', 'Unexpected registration field');
    const eventId = validId(request.data?.eventId, 'eventId');
    const requestId = validId(request.data?.requestId, 'requestId');
    if (requestId.length < 16) fail('invalid-argument', 'Invalid requestId');
    const eventRef = db.collection('schools').doc(schoolId).collection('clubEvents').doc(eventId);
    const regRef = eventRef.collection('registrations').doc(uid);
    const receiptRef = db.collection('eventRegistrationRequests').doc(
      createHash('sha256')
        .update(JSON.stringify([uid, schoolId, eventId, requestId]))
        .digest('hex'),
    );
    return db.runTransaction(async (transaction) => {
      const [member, user, eventSnap, regSnap, receipt] = await transaction.getAll(
        db.collection('schools').doc(schoolId).collection('members').doc(uid),
        db.collection('users').doc(uid),
        eventRef,
        regRef,
        receiptRef,
      );
      requireMember(member);
      if (user.data()?.accountDeletionInProgress === true)
        fail('permission-denied', '帳號正在刪除。');
      if (!eventSnap.exists || eventSnap.data().schoolId !== schoolId)
        fail('not-found', '找不到目前學校的活動。');
      const event = eventSnap.data();
      const registration = regSnap.data();
      if (
        registration &&
        (registration.userId !== uid ||
          registration.schoolId !== schoolId ||
          registration.eventId !== eventId)
      )
        fail('failed-precondition', '報名紀錄需要管理員確認。');
      const state = eventState(eventId, event, registration, now());
      if (receipt.exists) {
        if (receipt.data().action !== action)
          fail('already-exists', '這個送出編號已用於另一項操作。');
        return { ok: true, reused: true, state };
      }
      const already =
        action === 'register' ? state.status === 'registered' : state.status !== 'registered';
      if (!already && !(action === 'register' ? state.canRegister : state.canCancel))
        fail(
          'failed-precondition',
          action === 'register'
            ? '目前無法報名，請更新活動狀態。'
            : '目前不受理取消，請聯繫主辦單位。',
        );
      let nextEvent = event;
      let nextRegistration = registration;
      if (!already) {
        const count = countOf(event) + (action === 'register' ? 1 : -1);
        if (count < 0) fail('failed-precondition', '活動報名人數需要管理員確認。');
        nextEvent = { ...event, appRegistrationCount: count };
        nextRegistration = {
          userId: uid,
          schoolId,
          eventId,
          status: action === 'register' ? 'registered' : 'cancelled',
          updatedAt: FieldValue.serverTimestamp(),
          ...(action === 'register'
            ? { registeredAt: FieldValue.serverTimestamp() }
            : { cancelledAt: FieldValue.serverTimestamp() }),
        };
        transaction.set(regRef, nextRegistration);
        transaction.update(eventRef, { appRegistrationCount: count });
      }
      transaction.create(receiptRef, {
        userId: uid,
        schoolId,
        eventId,
        action,
        createdAt: FieldValue.serverTimestamp(),
      });
      return {
        ok: true,
        reused: already,
        state: eventState(eventId, nextEvent, nextRegistration, now()),
      };
    });
  };
  return {
    getEventRegistrations,
    registerCampusEvent: mutate('register'),
    cancelCampusEventRegistration: mutate('cancel'),
  };
}
async function releaseDeletedUserEventRegistration({ db, registrationRef, uid }) {
  const match = /^schools\/([^/]+)\/clubEvents\/([^/]+)\/registrations\/([^/]+)$/.exec(
    registrationRef.path,
  );
  if (!match || match[3] !== uid) return false;
  const eventRef = db.collection('schools').doc(match[1]).collection('clubEvents').doc(match[2]);
  return db.runTransaction(async (transaction) => {
    const [event, registration] = await transaction.getAll(eventRef, registrationRef);
    if (!registration.exists) return true;
    if (
      event.exists &&
      (event.data().registrationPolicy?.version !== 1 ||
        !Number.isSafeInteger(event.data().appRegistrationCount))
    )
      return false;
    if (registration.data().userId !== uid)
      fail('failed-precondition', 'Invalid registration owner');
    if (event.exists && registration.data().status === 'registered') {
      const count = countOf(event.data());
      if (count < 1) fail('failed-precondition', 'Invalid registration count');
      transaction.update(eventRef, { appRegistrationCount: count - 1 });
    }
    transaction.delete(registrationRef);
    return true;
  });
}
module.exports = {
  createEventRegistrationHandlers,
  normalizeRegistrationPolicy,
  prepareRegistrationPolicy,
  releaseDeletedUserEventRegistration,
};
