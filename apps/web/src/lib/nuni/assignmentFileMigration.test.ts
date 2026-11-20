import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { expect, it } from 'vitest';

const dir = path.resolve(__dirname, '../../../../../deploy/nuni-api/assignment-files');

it('numbers the overlay SQL after personal-import-sync and keeps CREATE rerunnable', () => {
  expect(existsSync(path.join(dir, '279_assignment_submission_files.sql'))).toBe(false);
  expect(existsSync(path.join(dir, '279_assignment_submission_files.rollback.sql'))).toBe(false);
  const sql = readFileSync(path.join(dir, '280_assignment_submission_files.sql'), 'utf8');
  const rollback = readFileSync(path.join(dir, '280_assignment_submission_files.rollback.sql'), 'utf8');
  const personal = readFileSync(
    path.resolve(__dirname, '../../../../../deploy/nuni-api/personal-import-sync/279_personal_import_sync.sql'),
    'utf8',
  );
  expect(personal.length).toBeGreaterThan(20);
  expect(sql).toContain('CREATE TABLE IF NOT EXISTS class_assignment_submission_files');
  expect(sql).toContain('CREATE TABLE IF NOT EXISTS class_assignment_file_idempotency');
  expect(sql).toContain('CREATE INDEX IF NOT EXISTS class_assignment_submission_files_visible');
  expect(rollback).toContain('DROP TABLE IF EXISTS class_assignment_file_idempotency');
  expect(rollback).toContain('DROP TABLE IF EXISTS class_assignment_submission_files');
});

it('adds a rerunnable withdrawal ledger and limits rollback to that table', () => {
  const sql = readFileSync(path.join(dir, '281_assignment_submission_withdrawals.sql'), 'utf8');
  const rollback = readFileSync(path.join(dir, '281_assignment_submission_withdrawals.rollback.sql'), 'utf8');
  expect(sql).toContain('CREATE TABLE IF NOT EXISTS class_assignment_submission_withdrawals');
  expect(sql).toContain('PRIMARY KEY (assignment_id, platform_account_id, submitted_at)');
  expect(sql).not.toMatch(/\b(?:UPDATE|DELETE|DROP|ALTER)\b/i);
  expect(rollback).toContain('DROP TABLE IF EXISTS class_assignment_submission_withdrawals');
  expect(rollback).not.toContain('DROP TABLE IF EXISTS class_assignment_submission_files');
});
