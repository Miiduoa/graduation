-- 僅新增撤回紀錄，不更動既有文字繳交或檔案資料。
CREATE TABLE IF NOT EXISTS class_assignment_submission_withdrawals (
  assignment_id text NOT NULL REFERENCES class_workspace_assignments(id),
  platform_account_id text NOT NULL REFERENCES platform_accounts(id),
  submitted_at timestamptz NOT NULL,
  withdrawn_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (assignment_id, platform_account_id, submitted_at)
);
