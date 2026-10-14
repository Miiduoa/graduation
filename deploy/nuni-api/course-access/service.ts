import { createHash, randomUUID } from 'node:crypto';
import { CourseAccessError, courseIdentifier, courseKeys, courseMetadata, courseRecord, courseScope,
  courseText, courseVersion, courseFold, sameCourseScope, type CourseCandidate, type CourseMetadata,
  type CourseRequest, type CourseRequestState } from './courseAccess';

export type CourseActor = { platformAccountId: string; credentialId: string; expiresAt: number };
export interface CourseSql { query<Row = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<{ rows: Row[] }> }
export interface CourseDatabase { transaction<T>(run: (tx: CourseSql) => Promise<T>): Promise<T> }
type Row = { id: string; kind: 'student' | 'teacher'; state: CourseRequestState; version: number;
  applicant_id: string; workspace_id: string; course_id: string | null; course_version: number | null;
  metadata: CourseMetadata; statement: string; decision_reason: string | null; created_at: string | Date;
  membership_active?: boolean };
type DirectoryRow = { id: string; workspace_id: string; version: number; metadata: CourseMetadata;
  teacher_id: string; teacher_request_id: string; state: 'active' | 'revoked' };
const notFound = () => new CourseAccessError('COURSE_NOT_FOUND', 404);
const conflict = () => new CourseAccessError('COURSE_STATE_CHANGED', 409);
const denied = () => new CourseAccessError('COURSE_REVIEW_FORBIDDEN', 403);
const key = (value: unknown) => courseText(value, 100, 8);
const requestSelect = `SELECT r.*, EXISTS (SELECT 1 FROM class_workspace_members m
  JOIN class_workspaces w ON w.id=m.workspace_id WHERE m.workspace_id=r.workspace_id
  AND m.platform_account_id=r.applicant_id AND m.state='active' AND w.state='active') AS membership_active
  FROM course_access_requests r`;
function project(row: Row, reviewer = false): CourseRequest {
  return { ...(reviewer ? { applicantId: row.applicant_id } : {}), id: row.id, kind: row.kind, state: row.state, version: row.version,
    workspaceId: row.workspace_id, courseId: row.course_id, metadata: row.metadata,
    statement: row.statement, decisionReason: row.decision_reason,
    createdAt: new Date(row.created_at).toISOString(), membershipActive: row.state === 'approved' && row.membership_active === true };
}
function sorted(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sorted);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => [k, sorted(v)]));
  return value;
}
function hash(value: unknown) { return createHash('sha256').update(JSON.stringify(sorted(value))).digest('hex'); }

/** A PlatformActor must come from PlatformAccountService.resolveSession, never from request JSON. */
export class CourseAccessService {
  constructor(private readonly db: CourseDatabase) {}

  private async actor(tx: CourseSql, actor: CourseActor) {
    if (!Number.isFinite(actor.expiresAt) || actor.expiresAt <= Date.now()) throw new CourseAccessError('COURSE_SESSION_EXPIRED', 401);
    const account = await tx.query(`SELECT id FROM platform_accounts WHERE id=$1 AND state='active' FOR SHARE`, [actor.platformAccountId]);
    const credential = await tx.query(`SELECT id FROM platform_account_credentials WHERE id=$1
      AND platform_account_id=$2 AND state='active' FOR SHARE`, [actor.credentialId, actor.platformAccountId]);
    if (!account.rows.length || !credential.rows.length) throw new CourseAccessError('COURSE_SESSION_EXPIRED', 401);
  }
  private async operator(tx: CourseSql, actor: CourseActor) {
    const result = await tx.query(`SELECT platform_account_id FROM platform_operator_assignments
      WHERE platform_account_id=$1 AND role_key='platform-operator' AND state='active' FOR SHARE`, [actor.platformAccountId]);
    if (!result.rows.length) throw denied();
  }
  private async school(tx: CourseSql, metadata: CourseMetadata) {
    const result = await tx.query(`SELECT id FROM tenants WHERE id=$1 AND state IN ('provisioned','open') FOR SHARE`, [metadata.schoolId]);
    if (!result.rows.length) throw notFound();
  }
  private async current(tx: CourseSql, id: string) {
    const row = (await tx.query<Row>(`${requestSelect} WHERE r.id=$1`, [id])).rows[0];
    if (!row) throw notFound();
    return project(row);
  }
  private async audit(tx: CourseSql, actor: CourseActor, id: string, schoolId: string, action: string) {
    await tx.query(`INSERT INTO course_access_audit (id,actor_id,request_id,school_id,action)
      VALUES ($1,$2,$3,$4,$5)`, [randomUUID(), actor.platformAccountId, id, schoolId, action]);
  }
  private async write(actor: CourseActor, operation: string, input: Record<string, unknown>, privileged: boolean,
    run: (tx: CourseSql) => Promise<string>): Promise<CourseRequest> {
    const idempotencyKey = key(input.idempotencyKey);
    const fingerprint = hash({ operation, input });
    return this.db.transaction(async tx => {
      await this.actor(tx, actor);
      if (privileged) await this.operator(tx, actor);
      // Per-actor serialization also makes pending limits and retry keys race-safe.
      await tx.query(`SELECT pg_advisory_xact_lock(hashtextextended($1,0))`, [`course-access:${actor.platformAccountId}`]);
      const replay = (await tx.query<{ request_hash: string; request_id: string }>(`SELECT request_hash,request_id
        FROM course_access_idempotency WHERE actor_id=$1 AND key=$2`, [actor.platformAccountId, idempotencyKey])).rows[0];
      if (replay) {
        if (replay.request_hash !== fingerprint) throw new CourseAccessError('COURSE_IDEMPOTENCY_CONFLICT', 409);
        // A retry never replays a stale "approved" response after revocation.
        return this.current(tx, replay.request_id);
      }
      const id = await run(tx);
      await tx.query(`INSERT INTO course_access_idempotency (actor_id,key,request_hash,request_id)
        VALUES ($1,$2,$3,$4)`, [actor.platformAccountId, idempotencyKey, fingerprint, id]);
      return this.current(tx, id);
    });
  }
  private async pendingLimit(tx: CourseSql, actor: CourseActor, workspaceId: string, kind: string) {
    const count = (await tx.query<{ count: number }>(`SELECT count(*)::int AS count FROM course_access_requests
      WHERE applicant_id=$1 AND state='pending'`, [actor.platformAccountId])).rows[0]?.count ?? 0;
    if (count >= 10) throw new CourseAccessError('COURSE_PENDING_LIMIT', 429);
    if ((await tx.query(`SELECT id FROM course_access_requests WHERE applicant_id=$1 AND workspace_id=$2
      AND kind=$3 AND state IN ('pending','approved')`, [actor.platformAccountId, workspaceId, kind])).rows.length) throw conflict();
  }
  private async directory(tx: CourseSql, id: string): Promise<DirectoryRow> {
    const row = (await tx.query<DirectoryRow>(`SELECT d.* FROM course_access_directory d
      JOIN course_access_requests r ON r.id=d.teacher_request_id AND r.state='approved'
      JOIN platform_accounts teacher ON teacher.id=d.teacher_id AND teacher.state='active'
      JOIN class_workspaces w ON w.id=d.workspace_id AND w.state='active'
      JOIN class_workspace_affiliations a ON a.workspace_id=d.workspace_id AND a.state='active'
        AND a.tenant_id=d.school_id AND a.section_id IS NOT NULL
      WHERE d.id=$1 AND d.state='active' FOR SHARE OF d,r,w,a`, [id])).rows[0];
    if (!row) throw notFound();
    return row;
  }
  async match(actor: CourseActor, raw: unknown): Promise<{ candidates: CourseCandidate[]; truncated: boolean }> {
    const input = courseMetadata(raw);
    return this.db.transaction(async tx => {
      await this.actor(tx, actor); await this.school(tx, input);
      const rows = (await tx.query<DirectoryRow>(`SELECT d.* FROM course_access_directory d
        JOIN course_access_requests r ON r.id=d.teacher_request_id AND r.state='approved'
        JOIN platform_accounts teacher ON teacher.id=d.teacher_id AND teacher.state='active'
      JOIN class_workspaces w ON w.id=d.workspace_id AND w.state='active'
        JOIN class_workspace_affiliations a ON a.workspace_id=d.workspace_id AND a.tenant_id=d.school_id
          AND a.state='active' AND a.section_id IS NOT NULL
        WHERE d.school_id=$1 AND d.academic_year=$2 AND d.semester=$3 AND d.state='active'
          AND ((d.course_code_key=$4 AND $4<>'') OR d.title_key=$5)
        ORDER BY d.id LIMIT 201`, [input.schoolId, input.academicYear, input.semester, courseFold(input.courseCode), courseFold(input.title)])).rows;
      return { candidates: rows.slice(0, 200).map(row => ({ ...row.metadata, id: row.id,
        workspaceId: row.workspace_id, version: row.version, verification: 'administrator-reviewed' as const })), truncated: rows.length > 200 };
    });
  }
  async student(actor: CourseActor, raw: unknown): Promise<CourseRequest> {
    const input = courseRecord(raw);
    courseKeys(input, ['courseId', 'version', 'metadata', 'confirmed', 'idempotencyKey']);
    const courseId = courseIdentifier(input.courseId, 'ccd'), version = courseVersion(input.version), metadata = courseMetadata(input.metadata);
    if (input.confirmed !== true) throw new CourseAccessError('COURSE_CONFIRMATION_REQUIRED');
    return this.write(actor, 'student-request', input, false, async tx => {
      const directory = await this.directory(tx, courseId);
      if (directory.version !== version || !sameCourseScope(metadata, directory.metadata)) throw conflict();
      await this.school(tx, directory.metadata);
      if (directory.teacher_id === actor.platformAccountId) throw conflict();
      await this.pendingLimit(tx, actor, directory.workspace_id, 'student');
      const id = `car_${randomUUID()}`;
      await tx.query(`INSERT INTO course_access_requests (id,kind,applicant_id,workspace_id,course_id,course_version,
        school_id,academic_year,semester,metadata,statement) VALUES ($1,'student',$2,$3,$4,$5,$6,$7,$8,$9::jsonb,'')`,
      [id, actor.platformAccountId, directory.workspace_id, courseId, version, metadata.schoolId,
        metadata.academicYear, metadata.semester, JSON.stringify(directory.metadata)]);
      await this.audit(tx, actor, id, metadata.schoolId, 'student-requested');
      return id;
    });
  }
  async teacher(actor: CourseActor, raw: unknown): Promise<CourseRequest> {
    const input = courseRecord(raw);
    courseKeys(input, ['workspaceId', 'metadata', 'statement', 'confirmed', 'idempotencyKey']);
    const workspaceId = courseIdentifier(input.workspaceId, 'cw'), metadata = courseMetadata(input.metadata), statement = courseText(input.statement, 1000, 20);
    if (!metadata.courseCode || !metadata.teacher || input.confirmed !== true) throw new CourseAccessError('COURSE_CONFIRMATION_REQUIRED');
    return this.write(actor, 'teacher-request', input, false, async tx => {
      await this.school(tx, metadata);
      const owner = await tx.query(`SELECT w.id FROM class_workspaces w JOIN class_workspace_members m
        ON m.workspace_id=w.id AND m.platform_account_id=w.owner_platform_account_id
        WHERE w.id=$1 AND w.owner_platform_account_id=$2 AND w.state='active'
          AND m.state='active' AND m.role='owner-teacher' FOR UPDATE OF w`, [workspaceId, actor.platformAccountId]);
      if (!owner.rows.length) throw notFound();
      if ((await tx.query(`SELECT id FROM course_access_directory WHERE workspace_id=$1`, [workspaceId])).rows.length) throw conflict();
      await this.pendingLimit(tx, actor, workspaceId, 'teacher');
      const id = `car_${randomUUID()}`;
      await tx.query(`INSERT INTO course_access_requests (id,kind,applicant_id,workspace_id,school_id,
        academic_year,semester,metadata,statement) VALUES ($1,'teacher',$2,$3,$4,$5,$6,$7::jsonb,$8)`,
      [id, actor.platformAccountId, workspaceId, metadata.schoolId, metadata.academicYear, metadata.semester, JSON.stringify(metadata), statement]);
      await this.audit(tx, actor, id, metadata.schoolId, 'teacher-requested');
      return id;
    });
  }
  async list(actor: CourseActor, raw: unknown, operator = false) {
    const input = courseRecord(raw);
    courseKeys(input, operator ? ['schoolId', 'cursor'] : ['cursor']);
    const cursor = input.cursor == null ? null : courseIdentifier(input.cursor, 'car');
    const schoolId = operator ? courseScope({ schoolId: input.schoolId, academicYear: '115', semester: '1' }).schoolId : '';
    return this.db.transaction(async tx => {
      await this.actor(tx, actor); if (operator) await this.operator(tx, actor);
      const rows = (await tx.query<Row>(`${requestSelect} WHERE ${operator ? 'r.school_id=$1' : 'r.applicant_id=$1'}
        AND ($2::text IS NULL OR r.id>$2) ORDER BY r.id LIMIT 101`, [operator ? schoolId : actor.platformAccountId, cursor])).rows;
      return { requests: rows.slice(0, 100).map(row => project(row, operator)), nextCursor: rows.length > 100 ? rows[99]!.id : null };
    });
  }
  async withdraw(actor: CourseActor, requestId: string, raw: unknown) {
    const id = courseIdentifier(requestId, 'car'), input = courseRecord(raw);
    courseKeys(input, ['version', 'idempotencyKey']); const version = courseVersion(input.version);
    return this.write(actor, `withdraw:${id}`, input, false, async tx => {
      const row = (await tx.query<Row>(`SELECT * FROM course_access_requests WHERE id=$1 AND applicant_id=$2 FOR UPDATE`, [id, actor.platformAccountId])).rows[0];
      if (!row) throw notFound();
      if (row.state !== 'pending' || row.version !== version) throw conflict();
      await tx.query(`UPDATE course_access_requests SET state='withdrawn',version=version+1,updated_at=now() WHERE id=$1`, [id]);
      await this.audit(tx, actor, id, row.metadata.schoolId, 'withdrawn');
      return id;
    });
  }
  async decide(actor: CourseActor, requestId: string, raw: unknown) {
    const id = courseIdentifier(requestId, 'car'), input = courseRecord(raw);
    courseKeys(input, ['version', 'decision', 'reason', 'evidenceReference', 'independentlyVerified', 'idempotencyKey']);
    const version = courseVersion(input.version), decision = courseText(input.decision, 10), reason = courseText(input.reason, 1000, 5);
    if (!['approve', 'reject', 'revoke'].includes(decision)) throw new CourseAccessError('COURSE_INVALID_INPUT');
    const evidence = courseText(input.evidenceReference ?? '', 500);
    if (decision === 'approve' && (evidence.length < 8 || input.independentlyVerified !== true))
      throw new CourseAccessError('COURSE_INDEPENDENT_REVIEW_REQUIRED');
    return this.write(actor, `decide:${id}`, input, true, async tx => {
      const row = (await tx.query<Row>(`SELECT * FROM course_access_requests WHERE id=$1 FOR UPDATE`, [id])).rows[0];
      if (!row) throw notFound();
      if (row.applicant_id === actor.platformAccountId) throw new CourseAccessError('COURSE_SELF_REVIEW_FORBIDDEN', 403);
      if (row.version !== version || row.state !== (decision === 'revoke' ? 'approved' : 'pending')) throw conflict();
      if (decision === 'approve') {
        await this.school(tx, row.metadata);
        if (!(await tx.query(`SELECT id FROM platform_accounts WHERE id=$1 AND state='active' FOR SHARE`, [row.applicant_id])).rows.length) throw conflict();
        if (row.kind === 'teacher') await this.checkTeacherApproval(tx, row);
        else {
          const directory = await this.directory(tx, row.course_id!);
          if (directory.workspace_id !== row.workspace_id || directory.version !== row.course_version || !sameCourseScope(row.metadata, directory.metadata)) throw conflict();
          const member = (await tx.query<{ role: string }>(`SELECT role FROM class_workspace_members
            WHERE workspace_id=$1 AND platform_account_id=$2 FOR UPDATE`, [row.workspace_id, row.applicant_id])).rows[0];
          if (member && member.role !== 'student') throw conflict();
        }
      }
      const state = decision === 'approve' ? 'approved' : decision === 'reject' ? 'rejected' : 'revoked';
      await tx.query(`UPDATE course_access_requests SET state=$2,version=version+1,decision_reason=$3,
        evidence_reference=$4,reviewer_id=$5,reviewed_at=now(),updated_at=now() WHERE id=$1`, [id, state, reason, evidence, actor.platformAccountId]);
      if (decision === 'approve' && row.kind === 'student') {
        await tx.query(`INSERT INTO class_workspace_members (workspace_id,platform_account_id,role,state)
          VALUES ($1,$2,'student','active') ON CONFLICT (workspace_id,platform_account_id) DO UPDATE
          SET role='student',state='active',removed_at=NULL,joined_at=now(),updated_at=now()`, [row.workspace_id, row.applicant_id]);
      } else if (decision === 'approve') {
        const courseId = `ccd_${randomUUID()}`;
        await tx.query(`INSERT INTO course_access_directory (id,workspace_id,teacher_id,teacher_request_id,
          school_id,academic_year,semester,metadata,course_code_key,title_key) VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9,$10)`,
        [courseId, row.workspace_id, row.applicant_id, id, row.metadata.schoolId, row.metadata.academicYear, row.metadata.semester, JSON.stringify(row.metadata), courseFold(row.metadata.courseCode), courseFold(row.metadata.title)]);
        await tx.query(`UPDATE course_access_requests SET course_id=$2,course_version=1 WHERE id=$1`, [id, courseId]);
      } else if (decision === 'revoke' && row.kind === 'student') {
        await tx.query(`UPDATE class_workspace_members SET state='removed',removed_at=now(),updated_at=now()
          WHERE workspace_id=$1 AND platform_account_id=$2 AND role='student'`, [row.workspace_id, row.applicant_id]);
      } else if (decision === 'revoke') {
        await tx.query(`UPDATE course_access_directory SET state='revoked',version=version+1 WHERE workspace_id=$1`, [row.workspace_id]);
        await tx.query(`UPDATE class_workspaces SET state='archived' WHERE id=$1`, [row.workspace_id]);
      }
      await this.audit(tx, actor, id, row.metadata.schoolId, state);
      return id;
    });
  }
  private async checkTeacherApproval(tx: CourseSql, row: Row) {
    const workspace = await tx.query(`SELECT w.id FROM class_workspaces w
      JOIN class_workspace_affiliations a ON a.workspace_id=w.id AND a.state='active'
      WHERE w.id=$1 AND w.owner_platform_account_id=$2 AND w.state='active'
        AND a.tenant_id=$3 AND a.section_id IS NOT NULL FOR UPDATE OF w FOR SHARE OF a`,
    [row.workspace_id, row.applicant_id, row.metadata.schoolId]);
    if (!workspace.rows.length) throw new CourseAccessError('COURSE_AUTHORIZED_AFFILIATION_REQUIRED', 409);
    // No silent migration of a self-created workspace's pre-existing students or co-teachers.
    const members = (await tx.query<{ platform_account_id: string; role: string }>(`SELECT platform_account_id,role
      FROM class_workspace_members WHERE workspace_id=$1 AND state='active' FOR UPDATE`, [row.workspace_id])).rows;
    if (members.length !== 1 || members[0]!.platform_account_id !== row.applicant_id || members[0]!.role !== 'owner-teacher')
      throw new CourseAccessError('COURSE_MEMBER_MIGRATION_REVIEW_REQUIRED', 409);
    if ((await tx.query(`SELECT id FROM course_access_directory WHERE workspace_id=$1`, [row.workspace_id])).rows.length) throw conflict();
  }
}
