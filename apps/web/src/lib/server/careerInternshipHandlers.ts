/** Approval-isolated: never registered in API routes, fnDispatch or deployed exports. */
import { Timestamp, type Firestore } from 'firebase-admin/firestore';
import type { CallableRequest } from './groupInviteHandlers';
import { HttpsError } from './httpsError';
import {
  internshipProgress,
  type InternshipCommand,
  type InternshipRecord,
  type InternshipRule,
  type InternshipReply,
  type InternshipAudit,
} from '@campus/shared/src/careerInternship';
function fail(code: ConstructorParameters<typeof HttpsError>[0], message: string): never {
  throw new HttpsError(code, message);
}
function id(value: unknown): string {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(value))
    fail('invalid-argument', '資料編號不正確。');
  return value;
}
function text(value: unknown, max = 200): string {
  if (typeof value !== 'string' || !value.trim() || value.length > max)
    fail('invalid-argument', '請確認必填欄位與字數。');
  return value.trim();
}
function url(value: unknown, school = false): string {
  const raw = text(value, 1500);
  try {
    const u = new URL(raw);
    if (
      u.protocol === 'https:' &&
      !u.username &&
      !u.password &&
      (!school || u.hostname.endsWith('.edu.tw'))
    )
      return u.href;
  } catch {
    /* invalid */
  }
  return fail('invalid-argument', school ? '請填寫校方 HTTPS 來源。' : '文件請填 HTTPS 網址。');
}
function date(value: unknown): string {
  if (
    typeof value !== 'string' ||
    !Number.isFinite(Date.parse(value)) ||
    new Date(value).toISOString() !== value
  )
    fail('invalid-argument', '日期格式不正確。');
  return value;
}
function cleanRule(r: InternshipRule): InternshipRule {
  if (
    !r ||
    !Number.isInteger(r.credits) ||
    r.credits < 1 ||
    r.credits > 30 ||
    !Number.isInteger(r.hoursPerCredit) ||
    r.hoursPerCredit < 60 ||
    r.hoursPerCredit > 1000 ||
    !Number.isInteger(r.revision) ||
    r.revision < 0 ||
    !Array.isArray(r.documents) ||
    r.documents.length !== 5 ||
    r.documents.some((d) => !d || typeof d !== 'object')
  )
    fail('invalid-argument', '請確認學分、每學分至少 60 小時及五個流程步驟。');
  return {
    id: id(r.id),
    revision: r.revision,
    department: text(r.department),
    term: text(r.term, 40),
    credits: r.credits,
    hoursPerCredit: r.hoursPerCredit,
    sourceUrl: url(r.sourceUrl, true),
    applicationUrl: url(r.applicationUrl, true),
    documents: r.documents.map((d) => ({
      title: text(d.title),
      recipient: text(d.recipient),
      deadline: date(d.deadline),
    })),
  };
}
export function createCareerInternshipHandlers({
  db,
  now = () => new Date(),
}: {
  db: Firestore;
  now?: () => Date;
}) {
  return async (request: CallableRequest): Promise<InternshipReply> => {
    const c = request.data as InternshipCommand & { schoolId: string };
    if (!c || typeof c !== 'object') fail('invalid-argument', '實習操作內容不正確。');
    const school = db.doc(`schools/${id(c.schoolId)}`);
    const uid = request.auth?.uid;
    if (!uid) fail('unauthenticated', '請先登入再查看實習進度。');
    return db.runTransaction(async (tx) => {
      const [member, role] = await Promise.all([
        tx.get(school.collection('members').doc(uid)),
        tx.get(school.collection('serviceRoles').doc(uid)),
      ]);
      if (member.data()?.status !== 'active')
        fail('permission-denied', '請使用這所學校的有效身分。');
      const admin = member.data()?.role === 'admin';
      const staff =
        admin || (role.data()?.status === 'active' && role.data()?.career_staff === true);
      const departments: string[] =
        role.data()?.status === 'active' && Array.isArray(role.data()?.internship_departments)
          ? role.data()!.internship_departments.filter((d: unknown) => typeof d === 'string')
          : [];
      const records = school.collection('internshipRecords');
      const rules = school.collection('internshipRules');
      const at = now().toISOString();
      const audit = (action: string, targetId: string) =>
        tx.create(school.collection('adminLogs').doc(), {
          action: `internship_${action}`,
          targetId,
          actorUid: uid,
          at,
          createdAt: Timestamp.fromDate(new Date(at)),
        });
      if (c.action === 'list') {
        if (!['student', 'staff', 'ops'].includes(c.audience))
          fail('invalid-argument', '檢視範圍不正確。');
        if (
          (c.audience === 'ops' && !admin) ||
          (c.audience === 'staff' && !staff && !departments.length)
        )
          fail('permission-denied', '目前沒有實習承辦權限。');
        const ruleRows = await tx.get(rules.limit(501));
        const all: InternshipRecord[] = [];
        if (c.audience !== 'ops') {
          const queries =
            c.audience === 'student'
              ? [records.where('uid', '==', uid)]
              : staff
                ? [records]
                : departments.map((d) => records.where('rule.department', '==', d));
          // Assigned teachers may verify only their assigned records, alongside own student records.
          if (c.audience === 'student') queries.push(records.where('teacherUid', '==', uid));
          for (const query of queries) {
            const snap = await tx.get(query.limit(501));
            all.push(...snap.docs.map((d) => ({ ...d.data(), id: d.id }) as InternshipRecord));
          }
        }
        const unique = [...new Map(all.map((r) => [r.id, r])).values()];
        if (ruleRows.size > 500 || unique.length > 500)
          fail('resource-exhausted', '資料超過單次範圍，請洽平台營運分批處理。');
        let logs: InternshipAudit[] = [];
        if (c.audience === 'ops') {
          const result = await tx.get(
            school.collection('adminLogs').orderBy('createdAt', 'desc').limit(100),
          );
          logs = result.docs
            .filter((d) => String(d.data().action).startsWith('internship_'))
            .map((d) => ({
              id: d.id,
              action: d.data().action,
              targetId: d.data().targetId,
              at: d.data().at,
            }));
        }
        return {
          snapshot: {
            rules: ruleRows.docs.map((d) => ({ ...d.data(), id: d.id }) as InternshipRule),
            records: unique,
            audit: logs,
          },
        };
      }
      if (c.action === 'rule') {
        if (!staff && !departments.length) fail('permission-denied', '只有承辦可設定系所規則。');
        const rule = cleanRule(c.rule);
        const ref = rules.doc(rule.id);
        const old = await tx.get(ref);
        if (
          !staff &&
          (!departments.includes(rule.department) ||
            (old.exists && !departments.includes(old.data()!.department)))
        )
          fail('permission-denied', '只能設定負責系所的規則。');
        if ((old.data()?.revision ?? 0) !== rule.revision)
          fail('aborted', '系所規則已更新，請重新整理。');
        tx.set(ref, { ...rule, revision: rule.revision + 1 });
        audit('rule', ref.id);
        return { id: ref.id };
      }
      if (c.action === 'create') {
        const ref = records.doc(id(c.id));
        const existing = await tx.get(ref);
        if (existing.exists) {
          if (existing.data()?.uid !== uid) fail('already-exists', '紀錄編號已使用，請重新建立。');
          return { id: ref.id };
        }
        const ruleSnap = await tx.get(rules.doc(id(c.ruleId)));
        if (!ruleSnap.exists || ruleSnap.data()?.revision !== c.ruleRevision)
          fail('failed-precondition', '系所規則已更新，請重新選擇。');
        const rule = ruleSnap.data() as InternshipRule;
        const teacherUid = id(c.teacherUid);
        const teacher = await tx.get(school.collection('members').doc(teacherUid));
        if (
          teacher.data()?.status !== 'active' ||
          !['teacher', 'staff', 'admin'].includes(teacher.data()?.role)
        )
          fail('invalid-argument', '請填寫本校有效指導老師的帳號編號。');
        const record: InternshipRecord = {
          id: ref.id,
          uid,
          revision: 1,
          rule,
          organization: text(c.organization),
          teacher: text(c.teacher),
          teacherUid,
          hours: [],
          documents: rule.documents.map(() => ({
            submitted: false,
            url: '',
            verified: false,
            message: '',
          })),
          confirmed: false,
          updatedAt: at,
        };
        tx.create(ref, record);
        audit('create', ref.id);
        return { id: ref.id };
      }
      const ref = records.doc(id(c.id));
      const snap = await tx.get(ref);
      if (!snap.exists) fail('not-found', '找不到這筆實習紀錄。');
      const r = snap.data() as InternshipRecord;
      const owner = r.uid === uid;
      const reviewer = staff || departments.includes(r.rule.department) || r.teacherUid === uid;
      if (!owner && !reviewer) fail('permission-denied', '無法查看這筆實習紀錄。');
      if (c.revision !== r.revision) fail('aborted', '紀錄已更新，請重新整理後再操作。');
      if (r.confirmed) fail('failed-precondition', '老師已確認此紀錄，如需更正請洽承辦。');
      if (c.action === 'hours') {
        if (!owner) fail('permission-denied', '只能登錄自己的實習時數。');
        const h = c.entry;
        if (
          !h ||
          !/^\d{4}-\d\d-\d\d$/.test(h.date) ||
          !Number.isFinite(Date.parse(h.date)) ||
          new Date(h.date).toISOString().slice(0, 10) !== h.date ||
          h.date > new Date(now().getTime() + 8 * 3600000).toISOString().slice(0, 10) ||
          !Number.isFinite(h.hours) ||
          h.hours <= 0 ||
          h.hours > 24 ||
          h.hours * 4 !== Math.round(h.hours * 4)
        )
          fail('invalid-argument', '請填實際日期與有效時數，以 15 分鐘為單位。');
        id(h.id);
        const old = r.hours.find((x) => x.id === h.id);
        if (old?.verified) fail('failed-precondition', '已確認的時數請洽承辦更正。');
        const rest = r.hours.filter((x) => x.id !== h.id);
        if (
          rest.length >= 500 ||
          rest.filter((x) => x.date === h.date).reduce((s, x) => s + x.hours, 0) + h.hours > 24
        )
          fail('invalid-argument', '每日時數不得超過 24 小時，單筆實習最多 500 筆登錄。');
        r.hours = [
          ...rest,
          { id: h.id, date: h.date, hours: h.hours, note: text(h.note, 1000), verified: false },
        ];
      } else if (c.action === 'document' || c.action === 'verifyDocument') {
        if (!Number.isInteger(c.index) || c.index < 0 || c.index >= r.documents.length)
          fail('invalid-argument', '文件編號不正確。');
        const d = r.documents[c.index];
        if (c.action === 'document') {
          if (!owner || d.verified) fail('permission-denied', '只能更新自己尚未確認的文件。');
          if (typeof c.submitted !== 'boolean') fail('invalid-argument', '文件狀態不正確。');
          d.submitted = c.submitted;
          d.url = c.submitted ? url(c.url) : '';
          d.message = '';
        } else {
          if (!reviewer || typeof c.verified !== 'boolean')
            fail('permission-denied', '只有負責承辦或指導老師可確認文件。');
          if (!d.submitted) fail('failed-precondition', '學生尚未登錄繳交這份文件。');
          d.verified = c.verified;
          d.message = c.verified ? '' : text(c.message, 1000);
        }
      } else if (c.action === 'removeHours') {
        if (!owner) fail('permission-denied', '只能移除自己的未確認時數。');
        const entry = r.hours.find((h) => h.id === c.entryId);
        if (!entry) fail('not-found', '找不到這筆時數。');
        if (entry.verified) fail('failed-precondition', '已確認的時數請先洽承辦撤銷確認。');
        r.hours = r.hours.filter((h) => h.id !== c.entryId);
      } else if (c.action === 'verifyHours') {
        if (!reviewer || typeof c.verified !== 'boolean')
          fail('permission-denied', '只有負責承辦或指導老師可確認時數。');
        const h = r.hours.find((x) => x.id === c.entryId);
        if (!h) fail('not-found', '找不到這筆時數。');
        h.verified = c.verified;
      } else if (c.action === 'confirm') {
        if (uid !== r.teacherUid) fail('permission-denied', '最後確認須由指定指導老師完成。');
        if (
          internshipProgress(r).verified < internshipProgress(r).required ||
          r.documents.some((d) => !d.verified)
        )
          fail('failed-precondition', '時數與所有文件確認完成後才能結案。');
        r.confirmed = true;
      } else return fail('invalid-argument', '不支援的實習操作。');
      tx.set(ref, { ...r, revision: r.revision + 1, updatedAt: at });
      audit(c.action, ref.id);
      return { id: ref.id };
    });
  };
}
