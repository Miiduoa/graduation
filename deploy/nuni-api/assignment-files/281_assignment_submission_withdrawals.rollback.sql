-- 先回退應用程式並停用附件入口；匯出撤回紀錄後才移除此新增表。
-- 移除後舊版會重新顯示曾撤回的文字繳交；保留既有作業與檔案資料。
BEGIN;
DROP TABLE IF EXISTS class_assignment_submission_withdrawals;
COMMIT;
