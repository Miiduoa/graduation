-- Additive platform-only review workflow. This does NOT create school staff roles,
-- student enrollments, identity claims, or seeded verification results.
CREATE TABLE course_access_requests (
  id text PRIMARY KEY,
  kind text NOT NULL CHECK (kind IN ('student','teacher')),
  applicant_id text NOT NULL REFERENCES platform_accounts(id),
  workspace_id text NOT NULL REFERENCES class_workspaces(id),
  course_id text,
  course_version integer,
  school_id text NOT NULL REFERENCES tenants(id),
  academic_year text NOT NULL,
  semester text NOT NULL CHECK (semester IN ('1','2','summer')),
  metadata jsonb NOT NULL CHECK (jsonb_typeof(metadata)='object'),
  statement text NOT NULL DEFAULT '' CHECK (length(statement)<=1000),
  state text NOT NULL DEFAULT 'pending' CHECK (state IN ('pending','approved','rejected','withdrawn','revoked')),
  version integer NOT NULL DEFAULT 1 CHECK (version>0),
  reviewer_id text REFERENCES platform_accounts(id),
  decision_reason text CHECK (length(decision_reason)<=1000),
  evidence_reference text CHECK (length(evidence_reference)<=500),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  reviewed_at timestamptz,
  CHECK (metadata ?& ARRAY['schoolId','academicYear','semester','title','courseCode','teacher','className']),
  CHECK (metadata->>'schoolId'=school_id AND metadata->>'academicYear'=academic_year AND metadata->>'semester'=semester),
  CHECK (state<>'approved' OR (reviewer_id IS NOT NULL AND reviewer_id<>applicant_id AND length(evidence_reference)>=8)),
  CHECK (kind<>'student' OR (course_id IS NOT NULL AND course_version>0))
);
CREATE UNIQUE INDEX course_access_one_open_request ON course_access_requests(applicant_id,workspace_id,kind)
  WHERE state IN ('pending','approved');
CREATE INDEX course_access_own_requests ON course_access_requests(applicant_id,id);
CREATE INDEX course_access_school_queue ON course_access_requests(school_id,id);

CREATE TABLE course_access_directory (
  id text PRIMARY KEY,
  workspace_id text NOT NULL UNIQUE REFERENCES class_workspaces(id),
  teacher_id text NOT NULL REFERENCES platform_accounts(id),
  teacher_request_id text NOT NULL UNIQUE REFERENCES course_access_requests(id),
  school_id text NOT NULL REFERENCES tenants(id),
  academic_year text NOT NULL,
  semester text NOT NULL CHECK (semester IN ('1','2','summer')),
  metadata jsonb NOT NULL,
  course_code_key text NOT NULL,
  title_key text NOT NULL,
  state text NOT NULL DEFAULT 'active' CHECK (state IN ('active','revoked')),
  version integer NOT NULL DEFAULT 1 CHECK (version>0),
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (metadata ?& ARRAY['schoolId','academicYear','semester','title','courseCode','teacher','className']),
  CHECK (metadata->>'schoolId'=school_id AND metadata->>'academicYear'=academic_year AND metadata->>'semester'=semester)
);
ALTER TABLE course_access_requests ADD CONSTRAINT course_access_request_directory_fk
  FOREIGN KEY (course_id) REFERENCES course_access_directory(id);
CREATE INDEX course_access_directory_code ON course_access_directory(school_id,academic_year,semester,course_code_key) WHERE state='active';
CREATE INDEX course_access_directory_title ON course_access_directory(school_id,academic_year,semester,title_key) WHERE state='active';

CREATE TABLE course_access_idempotency (
  actor_id text NOT NULL REFERENCES platform_accounts(id),
  key text NOT NULL CHECK (length(key) BETWEEN 8 AND 100),
  request_hash text NOT NULL,
  request_id text NOT NULL REFERENCES course_access_requests(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (actor_id,key)
);
CREATE TABLE course_access_audit (
  id text PRIMARY KEY,
  actor_id text REFERENCES platform_accounts(id),
  request_id text NOT NULL REFERENCES course_access_requests(id),
  school_id text NOT NULL REFERENCES tenants(id),
  action text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX course_access_audit_request ON course_access_audit(request_id,created_at);

-- Serializes publication with ALL legacy membership writes. Lock BEFORE checking
-- the registry so an old invite cannot pass a pre-publication snapshot and commit later.
CREATE FUNCTION enforce_reviewed_course_membership() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE directory course_access_directory%ROWTYPE;
BEGIN
  PERFORM id FROM class_workspaces WHERE id=NEW.workspace_id FOR UPDATE;
  SELECT * INTO directory FROM course_access_directory WHERE workspace_id=NEW.workspace_id;
  IF FOUND AND NEW.state='active' THEN
    IF directory.state<>'active' OR NOT EXISTS (
      SELECT 1 FROM class_workspaces w JOIN class_workspace_affiliations a ON a.workspace_id=w.id
      WHERE w.id=NEW.workspace_id AND w.state='active' AND a.state='active'
        AND a.tenant_id=directory.school_id AND a.section_id IS NOT NULL
    ) OR NOT EXISTS (
      SELECT 1 FROM course_access_requests r
      WHERE r.workspace_id=NEW.workspace_id AND r.applicant_id=NEW.platform_account_id AND r.state='approved'
        AND r.school_id=directory.school_id AND r.academic_year=directory.academic_year AND r.semester=directory.semester
        AND ((NEW.role='student' AND r.kind='student' AND r.course_id=directory.id AND r.course_version=directory.version)
          OR (NEW.role='owner-teacher' AND r.kind='teacher' AND r.id=directory.teacher_request_id AND directory.teacher_id=NEW.platform_account_id))
    ) THEN
      RAISE EXCEPTION 'COURSE_REVIEW_REQUIRED' USING ERRCODE='42501';
    END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER reviewed_course_membership BEFORE INSERT OR UPDATE ON class_workspace_members
  FOR EACH ROW EXECUTE FUNCTION enforce_reviewed_course_membership();

CREATE FUNCTION enforce_reviewed_course_publication() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM id FROM class_workspaces WHERE id=NEW.workspace_id FOR UPDATE;
  IF TG_OP='UPDATE' THEN
    IF NEW.workspace_id<>OLD.workspace_id OR NEW.teacher_id<>OLD.teacher_id OR NEW.metadata<>OLD.metadata
      OR NEW.teacher_request_id<>OLD.teacher_request_id OR NEW.school_id<>OLD.school_id
      OR NEW.academic_year<>OLD.academic_year OR NEW.semester<>OLD.semester
      OR (OLD.state='revoked' AND NEW.state<>'revoked') THEN
      RAISE EXCEPTION 'COURSE_DIRECTORY_IMMUTABLE' USING ERRCODE='42501';
    END IF;
    RETURN NEW;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM course_access_requests r JOIN class_workspaces w ON w.id=r.workspace_id
    JOIN class_workspace_affiliations a ON a.workspace_id=w.id
    WHERE r.id=NEW.teacher_request_id AND r.kind='teacher' AND r.state='approved'
      AND r.applicant_id=NEW.teacher_id AND w.owner_platform_account_id=NEW.teacher_id
      AND w.id=NEW.workspace_id AND w.state='active' AND a.state='active'
      AND a.tenant_id=NEW.school_id AND a.section_id IS NOT NULL AND r.metadata=NEW.metadata
  ) OR (SELECT count(*) FROM class_workspace_members WHERE workspace_id=NEW.workspace_id AND state='active')<>1
    OR NOT EXISTS (SELECT 1 FROM class_workspace_members WHERE workspace_id=NEW.workspace_id
      AND platform_account_id=NEW.teacher_id AND role='owner-teacher' AND state='active') THEN
    RAISE EXCEPTION 'COURSE_PUBLICATION_REVIEW_REQUIRED' USING ERRCODE='42501';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER reviewed_course_publication BEFORE INSERT OR UPDATE ON course_access_directory
  FOR EACH ROW EXECUTE FUNCTION enforce_reviewed_course_publication();

-- Removal/leave invalidates the old approval, even when initiated through an older API.
CREATE FUNCTION revoke_removed_course_member() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE changed record;
BEGIN
  IF TG_OP='UPDATE' AND NEW.state='active' AND NEW.role=OLD.role AND NEW.platform_account_id=OLD.platform_account_id THEN RETURN NEW; END IF;
  IF OLD.state='active' THEN
    FOR changed IN UPDATE course_access_requests SET state='revoked',version=version+1,updated_at=now()
      WHERE workspace_id=OLD.workspace_id AND applicant_id=OLD.platform_account_id AND state='approved'
      RETURNING id,school_id,kind LOOP
      INSERT INTO course_access_audit(id,actor_id,request_id,school_id,action)
        VALUES (gen_random_uuid()::text,NULL,changed.id,changed.school_id,'membership-removed');
      IF changed.kind='teacher' THEN
        UPDATE course_access_directory SET state='revoked',version=version+1 WHERE workspace_id=OLD.workspace_id AND state='active';
        UPDATE class_workspaces SET state='archived' WHERE id=OLD.workspace_id;
      END IF;
    END LOOP;
  END IF;
  RETURN NULL;
END $$;
CREATE TRIGGER reviewed_course_member_removed AFTER UPDATE OR DELETE ON class_workspace_members
  FOR EACH ROW EXECUTE FUNCTION revoke_removed_course_member();

CREATE FUNCTION prevent_reviewed_course_reactivation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.state='active' AND EXISTS (SELECT 1 FROM course_access_directory d
    JOIN course_access_requests r ON r.id=d.teacher_request_id
    WHERE d.workspace_id=NEW.id AND (d.state<>'active' OR r.state<>'approved')) THEN
    RAISE EXCEPTION 'COURSE_AUTHORITY_REVOKED' USING ERRCODE='42501';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER reviewed_course_reactivation BEFORE UPDATE ON class_workspaces
  FOR EACH ROW EXECUTE FUNCTION prevent_reviewed_course_reactivation();

CREATE FUNCTION revoke_changed_course_affiliation() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE changed record;
BEGIN
  IF TG_OP='UPDATE' AND NEW.state='active' AND NEW.tenant_id=OLD.tenant_id AND NEW.section_id IS NOT DISTINCT FROM OLD.section_id THEN RETURN NEW; END IF;
  FOR changed IN UPDATE course_access_directory SET state='revoked',version=version+1
    WHERE workspace_id=OLD.workspace_id AND state='active' RETURNING teacher_request_id,school_id LOOP
    UPDATE course_access_requests SET state='revoked',version=version+1,updated_at=now() WHERE id=changed.teacher_request_id AND state='approved';
    UPDATE class_workspaces SET state='archived' WHERE id=OLD.workspace_id;
    INSERT INTO course_access_audit(id,actor_id,request_id,school_id,action)
      VALUES (gen_random_uuid()::text,NULL,changed.teacher_request_id,changed.school_id,'affiliation-changed');
  END LOOP;
  RETURN NULL;
END $$;
CREATE TRIGGER reviewed_course_affiliation_changed AFTER UPDATE OR DELETE ON class_workspace_affiliations
  FOR EACH ROW EXECUTE FUNCTION revoke_changed_course_affiliation();

-- Closing a school or an account must also invalidate authority used by older APIs.
CREATE FUNCTION revoke_closed_course_school() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE changed record;
BEGIN
  IF NEW.state IN ('provisioned','open') OR NEW.state=OLD.state THEN RETURN NEW; END IF;
  FOR changed IN UPDATE course_access_requests SET state='revoked',version=version+1,updated_at=now()
    WHERE school_id=NEW.id AND state='approved' AND kind='teacher' RETURNING id,workspace_id,school_id LOOP
    UPDATE course_access_directory SET state='revoked',version=version+1 WHERE teacher_request_id=changed.id AND state='active';
    UPDATE class_workspaces SET state='archived' WHERE id=changed.workspace_id;
    INSERT INTO course_access_audit(id,actor_id,request_id,school_id,action)
      VALUES (gen_random_uuid()::text,NULL,changed.id,changed.school_id,'school-closed');
  END LOOP;
  RETURN NEW;
END $$;
CREATE TRIGGER reviewed_course_school_closed AFTER UPDATE OF state ON tenants
  FOR EACH ROW EXECUTE FUNCTION revoke_closed_course_school();

CREATE FUNCTION revoke_closed_course_account() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE changed record;
BEGIN
  IF NEW.state='active' OR NEW.state=OLD.state THEN RETURN NEW; END IF;
  FOR changed IN UPDATE course_access_requests SET state='revoked',version=version+1,updated_at=now()
    WHERE applicant_id=NEW.id AND state='approved' RETURNING id,workspace_id,school_id,kind LOOP
    IF changed.kind='teacher' THEN
      UPDATE course_access_directory SET state='revoked',version=version+1 WHERE teacher_request_id=changed.id AND state='active';
      UPDATE class_workspaces SET state='archived' WHERE id=changed.workspace_id;
    ELSE
      UPDATE class_workspace_members SET state='removed',removed_at=now(),updated_at=now()
        WHERE workspace_id=changed.workspace_id AND platform_account_id=NEW.id AND role='student';
    END IF;
    INSERT INTO course_access_audit(id,actor_id,request_id,school_id,action)
      VALUES (gen_random_uuid()::text,NULL,changed.id,changed.school_id,'account-closed');
  END LOOP;
  RETURN NEW;
END $$;
CREATE TRIGGER reviewed_course_account_closed AFTER UPDATE OF state ON platform_accounts
  FOR EACH ROW EXECUTE FUNCTION revoke_closed_course_account();
