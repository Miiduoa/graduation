'use strict';

const { z } = require('zod');
const { getFirestore } = require('firebase-admin/firestore');
const { projectLibraryLoan } = require('../libraryLoanSource');

// Bound the complete source snapshot, including returned/legacy records. The
// extra row proves whether the list is exhaustive before it can drive actions.
const MAX_LOAN_RECORDS = 500;

const inputSchema = z.object({
  onlyOverdue: z.boolean().optional(),
});

function loanPath(uid, schoolId) {
  return getFirestore()
    .collection('users')
    .doc(uid)
    .collection('schools')
    .doc(schoolId)
    .collection('libraryLoans');
}

function isActiveLoan(row) {
  const status = row.status != null ? String(row.status).toLowerCase() : '';
  if (status === 'returned') return false;
  return true;
}

/**
 * 讀取使用者目前未歸還的圖書借閱（與 App users/{uid}/schools/{schoolId}/libraryLoans 一致）。
 */
async function execute(ctx, rawInput) {
  const input = inputSchema.parse(rawInput ?? {});
  const uid = ctx.uid != null ? String(ctx.uid).trim() : '';
  const schoolId = ctx.schoolId != null ? String(ctx.schoolId).trim() : '';
  if (!uid || !schoolId) {
    return { ok: false, error: 'missing_uid_or_school', loans: [] };
  }

  const snap = await loanPath(uid, schoolId).limit(MAX_LOAN_RECORDS + 1).get();
  if (snap.docs.length > MAX_LOAN_RECORDS) {
    return { ok: false, error: 'library_loans_limit_exceeded', loans: [] };
  }
  const now = Date.now();
  const loans = [];

  for (const doc of snap.docs) {
    const row = { id: doc.id, ...doc.data() };
    if (!isActiveLoan(row)) continue;
    const loan = projectLibraryLoan(doc.id, row);
    const overdueByStatus = String(row.status || '').toLowerCase() === 'overdue';
    const overdueByDate = loan.dueAt != null && Date.parse(loan.dueAt) < now;
    if (input.onlyOverdue && !overdueByStatus && !overdueByDate) continue;

    loans.push(loan);
  }

  return { ok: true, count: loans.length, loans };
}

module.exports = {
  name: 'getLibraryLoans',
  description:
    '查詢使用者尚未歸還的圖書借閱紀錄（含即將到期／逾期）。當使用者問還沒還的書、借閱列表、續借或圖書館欠書時呼叫。',
  inputSchema,
  execute,
  requiresConfirmation: false,
};
