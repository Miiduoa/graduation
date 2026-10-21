-- Rollback for 279_assignment_submission_files.sql.
-- Only drops tables created by that migration. Does not touch existing course tables.
DROP TABLE IF EXISTS class_assignment_file_idempotency;
DROP TABLE IF EXISTS class_assignment_submission_files;
