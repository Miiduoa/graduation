/** Approval-isolated. Deliberately absent from fnDispatch, API routes and deployed functions. */
import { createHash } from 'node:crypto';
import { Timestamp } from 'firebase-admin/firestore';
import type {
  Firestore,
  Transaction,
  DocumentSnapshot,
  QuerySnapshot,
} from 'firebase-admin/firestore';
import {
  slotValid,
  transitionAllowed,
  type CareerOpportunity,
  type CareerApplication,
  type CareerCommand,
  type CareerReply,
  type CareerSources,
  type CareerAudit,
  type CareerWorkbenchEvent,
} from '@campus/shared/src/careerWorkstudy';
import type { CallableRequest } from './groupInviteHandlers';
import { HttpsError } from './httpsError';

function fail(code: ConstructorParameters<typeof HttpsError>[0], message: string): never {
  throw new HttpsError(code, message);
}
function id(value: unknown) {
  if (typeof value !== 'string' || !/^[a-zA-Z0-9_-]{1,128}$/.test(value))
    fail('invalid-argument', '資料編號不正確。');
  return value;
}
function text(value: unknown, max: number, required = true) {
  if (typeof value !== 'string' || value.length > max || (required && !value.trim()))
    fail('invalid-argument', '請確認必填欄位與字數。');
  return value.trim();
}
function schoolUrl(value: unknown) {
  const raw = text(value, 1500);
  try {
    const u = new URL(raw);
    if (u.protocol === 'https:' && u.hostname.endsWith('.edu.tw') && !u.username && !u.password)
      return u.href;
  } catch {
    /* invalid */
  }
  return fail('invalid-argument', '來源及權益說明請填校方 HTTPS 網址。');
}
function cleanOpportunity(value: CareerOpportunity): CareerOpportunity {
  if (
    !value ||
    !['workstudy', 'internship', 'fair'].includes(value.type) ||
    typeof value.credit !== 'boolean' ||
    typeof value.published !== 'boolean'
  )
    fail('invalid-argument', '機會類型或設定不正確。');
  if (
    !Number.isInteger(value.places) ||
    value.places < 1 ||
    value.places > 10000 ||
    !Number.isInteger(value.revision) ||
    value.revision < 0
  )
    fail('invalid-argument', '名額或版本不正確。');
  if (
    !Array.isArray(value.slots) ||
    !value.slots.length ||
    value.slots.length > 21 ||
    !value.slots.every((s) => s && slotValid(s))
  )
    fail('invalid-argument', '請填寫有效的每週時段。');
  if (
    typeof value.deadline !== 'string' ||
    !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(value.deadline) ||
    !Number.isFinite(Date.parse(value.deadline)) ||
    new Date(value.deadline).toISOString() !== value.deadline
  )
    fail('invalid-argument', '請填寫截止日期與時間。');
  return {
    id: value.id ? id(value.id) : '',
    revision: value.revision,
    type: value.type,
    title: text(value.title, 120),
    unit: text(value.unit, 120),
    pay: text(value.pay, 120),
    slots: value.slots.map((s) => ({ day: s.day, start: s.start, end: s.end })),
    places: value.places,
    deadline: value.deadline,
    credit: value.credit,
    courseCode: text(value.courseCode, 80, false),
    published: value.published,
    sourceUrl: schoolUrl(value.sourceUrl),
    rightsTitle: text(value.rightsTitle, 200),
    rightsText: text(value.rightsText, 12000),
    rightsUrl: schoolUrl(value.rightsUrl),
  };
}
function data<T>(snap: DocumentSnapshot): T {
  return { ...snap.data(), id: snap.id } as T;
}
function rows<T>(snap: QuerySnapshot): T[] {
  return snap.docs.map((s) => data<T>(s));
}

export function createCareerWorkstudyHandlers({
  db,
  now = () => new Date(),
}: {
  db: Firestore;
  now?: () => Date;
}) {
  return async function careerWorkstudy(request: CallableRequest): Promise<CareerReply> {
    const command = request.data as CareerCommand & { schoolId: string };
    if (!command || typeof command !== 'object') fail('invalid-argument', '請確認申請內容。');
    const schoolId = id(command.schoolId);
    const school = db.collection('schools').doc(schoolId);
    const opportunities = school.collection('careerOpportunities');
    const applications = school.collection('careerApplications');
    const uid = request.auth?.uid;
    // Public browsing stays available to visitors. Staff/ops identity is always read inside the transaction.
    return db.runTransaction(async (tx: Transaction) => {
      const at = now().toISOString();
      const member = uid ? await tx.get(school.collection('members').doc(uid)) : null;
      const service = uid ? await tx.get(school.collection('serviceRoles').doc(uid)) : null;
      const active = member?.data()?.status === 'active';
      const canOperate = !!active && member?.data()?.role === 'admin';
      const canReview =
        !!active &&
        (canOperate ||
          (service?.data()?.status === 'active' && service?.data()?.career_staff === true));
      const log = (action: string, targetId: string) => {
        tx.create(school.collection('adminLogs').doc(), {
          action: `career_${action}`,
          actorUid: uid,
          targetId,
          at,
          createdAt: Timestamp.fromDate(new Date(at)),
        });
      };
      if (command.action === 'list') {
        if (!['student', 'staff', 'ops'].includes(command.audience))
          fail('invalid-argument', '檢視範圍不正確。');
        if (
          (command.audience === 'staff' && !canReview) ||
          (command.audience === 'ops' && !canOperate)
        )
          fail('permission-denied', '目前沒有這所學校的職涯管理權限。');
        const staff = command.audience === 'staff';
        const opportunityQuery = staff
          ? opportunities
          : opportunities.where('published', '==', true);
        const opp = rows<CareerOpportunity>(await tx.get(opportunityQuery.limit(501)));
        const apps =
          uid && (staff || command.audience === 'student')
            ? rows<CareerApplication>(
                await tx.get(
                  (staff ? applications : applications.where('uid', '==', uid)).limit(501),
                ),
              )
            : [];
        if (opp.length > 500 || apps.length > 500)
          fail('resource-exhausted', '資料超過單次檢視範圍，請洽平台營運協助分批處理。');
        const events: CareerWorkbenchEvent[] = [];
        if (staff) {
          for (const [collection, source] of [
            ['clubEvents', 'school-club-events'],
            ['events', 'school-events'],
          ] as const) {
            const records = await tx.get(
              school.collection(collection).where('category', '==', 'career').limit(501),
            );
            if (records.size > 500)
              fail('resource-exhausted', '職涯活動超過單次檢視範圍，請洽平台營運協助分批處理。');
            for (const record of records.docs) {
              const event = record.data();
              if (typeof event.title !== 'string' || !event.title.trim()) continue;
              const startsAt =
                event.startsAt instanceof Timestamp
                  ? event.startsAt.toDate().toISOString()
                  : typeof event.startsAt === 'string' &&
                      Number.isFinite(Date.parse(event.startsAt))
                    ? new Date(event.startsAt).toISOString()
                    : '';
              events.push({ id: record.id, title: event.title, startsAt, source });
            }
          }
        }
        const ops = command.audience === 'ops';
        const sources = ops
          ? await tx.get(school.collection('settings').doc('careerSources'))
          : null;
        const audit = ops
          ? rows<CareerAudit>(
              await tx.get(school.collection('adminLogs').orderBy('createdAt', 'desc').limit(100)),
            )
              .filter((a) => typeof a.action === 'string' && a.action.startsWith('career_'))
              .map(({ id, action, actorUid, targetId, at }) => ({
                id,
                action,
                actorUid,
                targetId,
                at,
              }))
          : [];
        return {
          snapshot: {
            events: events.sort((a, b) => a.startsAt.localeCompare(b.startsAt)),
            opportunities: opp.sort((a, b) => a.deadline.localeCompare(b.deadline)),
            applications: apps.sort((a, b) => b.submittedAt.localeCompare(a.submittedAt)),
            canReview,
            canOperate,
            audit,
            sources: ops
              ? sources?.exists
                ? (sources.data() as CareerSources)
                : { office: true, departments: true, taiwanjobs: true, revision: 0 }
              : null,
          },
        };
      }
      if (!uid) fail('unauthenticated', '請先登入，再送出申請。');
      if (!active) fail('permission-denied', '請使用這所學校的學生或教職員身分。');
      if (command.action === 'save') {
        if (!canReview) fail('permission-denied', '目前沒有這所學校的職涯承辦權限。');
        const clean = cleanOpportunity(command.opportunity);
        const ref = clean.id ? opportunities.doc(clean.id) : opportunities.doc();
        const existing = await tx.get(ref);
        if ((existing.data()?.revision ?? 0) !== clean.revision || (!!clean.id && !existing.exists))
          fail('aborted', '機會已更新，請重新整理後再修改。');
        if (clean.published && clean.deadline <= at)
          fail('failed-precondition', '截止時間已過，請調整後再上架。');
        tx.set(ref, { ...clean, id: ref.id, revision: clean.revision + 1 });
        log(clean.published ? 'publish' : 'unpublish', ref.id);
        return { id: ref.id };
      }
      if (command.action === 'apply') {
        const opportunityId = id(command.opportunityId);
        const ref = applications.doc(
          createHash('sha256')
            .update(JSON.stringify([uid, opportunityId]))
            .digest('hex'),
        );
        const [opp, existing] = await Promise.all([
          tx.get(opportunities.doc(opportunityId)),
          tx.get(ref),
        ]);
        // Identical retry returns the original receipt, even after a deadline or revision change.
        if (existing.exists) return { id: ref.id };
        if (
          !opp.exists ||
          !opp.data()?.published ||
          opp.data()?.type !== 'workstudy' ||
          opp.data()?.deadline <= at
        )
          fail('failed-precondition', '這筆工讀已截止或下架，請重新查看機會。');
        const opportunity = data<CareerOpportunity>(opp);
        if (command.confirmed !== true || command.revision !== opportunity.revision)
          fail('failed-precondition', '工讀內容或權益說明已更新，請重新閱讀並勾選「我看過了」。');
        const application: CareerApplication = {
          id: ref.id,
          opportunityId,
          opportunityTitle: opportunity.title,
          unit: opportunity.unit,
          uid,
          contact: text(command.contact, 200),
          introduction: text(command.introduction, 2000, false),
          state: 'submitted',
          revision: 1,
          submittedAt: at,
          updatedAt: at,
          message: '',
          rights: {
            revision: opportunity.revision,
            title: opportunity.rightsTitle,
            text: opportunity.rightsText,
            url: opportunity.rightsUrl,
            confirmedAt: at,
          },
        };
        tx.create(ref, application);
        log('apply', ref.id);
        return { id: ref.id };
      }
      if (command.action === 'review') {
        if (!canReview) fail('permission-denied', '目前沒有這所學校的職涯承辦權限。');
        const ref = applications.doc(id(command.applicationId));
        const snap = await tx.get(ref);
        if (!snap.exists) fail('not-found', '找不到這筆申請。');
        const app = data<CareerApplication>(snap);
        if (command.revision !== app.revision) fail('aborted', '其他承辦已更新，請重新整理。');
        if (!transitionAllowed(app.state, command.state))
          fail('failed-precondition', '請依申請順序更新狀態。');
        const message = text(command.message, 1000, command.state === 'interview');
        tx.update(ref, {
          state: command.state,
          message,
          updatedAt: at,
          revision: app.revision + 1,
        });
        log(`review_${command.state}`, ref.id);
        return { id: ref.id };
      }
      if (command.action === 'sources') {
        if (!canOperate) fail('permission-denied', '只有校方管理員可調整資料來源。');
        const s = command.sources;
        if (
          !s ||
          !['office', 'departments', 'taiwanjobs'].every(
            (k) => typeof s[k as keyof CareerSources] === 'boolean',
          ) ||
          !Number.isInteger(s.revision)
        )
          fail('invalid-argument', '來源設定不正確。');
        const ref = school.collection('settings').doc('careerSources');
        const existing = await tx.get(ref);
        if ((existing.data()?.revision ?? 0) !== s.revision)
          fail('aborted', '來源設定已更新，請重新整理。');
        tx.set(ref, {
          office: s.office,
          departments: s.departments,
          taiwanjobs: s.taiwanjobs,
          revision: s.revision + 1,
        });
        log('sources', 'careerSources');
        return {};
      }
      return fail('invalid-argument', '不支援這個職涯操作。');
    });
  };
}
