'use strict';

const { z } = require('zod');
const { FieldPath, getFirestore } = require('firebase-admin/firestore');
const { projectLibraryLoan } = require('../libraryLoanSource');

// Page size for a complete source snapshot, including returned/legacy records.
// Paginate instead of failing closed so long-lived accounts still see unpaid loans.
const LOAN_PAGE_SIZE = 500;
const MAX_LOAN_PAGES = 20;

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

async function loadLoanDocs(uid, schoolId) {
  const col = loanPath(uid, schoolId);
  const docs = [];
  let cursor = null;
  let complete = true;
  for (let page = 0; page < MAX_LOAN_PAGES; page++) {
    let query = col.orderBy(FieldPath.documentId());
    if (cursor) query = query.startAfter(cursor);
    const snap = await query.limit(LOAN_PAGE_SIZE).get();
    docs.push(...snap.docs);
    if (snap.docs.length < LOAN_PAGE_SIZE) {
      return { docs, complete };
    }
    cursor = snap.docs[snap.docs.length - 1];
  }
  complete = false;
  return { docs, complete };
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

  const { docs, complete } = await loadLoanDocs(uid, schoolId);
  const now = Date.now();
  const loans = [];

  for (const doc of docs) {
    const row = { id: doc.id, ...doc.data() };
    if (!isActiveLoan(row)) continue;
    const loan = projectLibraryLoan(doc.id, row);
    const overdueByStatus = String(row.status || '').toLowerCase() === 'overdue';
    const overdueByDate = loan.dueAt != null && Date.parse(loan.dueAt) < now;
    if (input.onlyOverdue && !overdueByStatus && !overdueByDate) continue;

    loans.push(loan);
  }

  const result = { ok: true, count: loans.length, loans };
  if (!complete) result.complete = false;
  return result;
}

module.exports = {
  name: 'getLibraryLoans',
  description:
    '查詢使用者尚未歸還的圖書借閱紀錄（含即將到期／逾期）。當使用者問還沒還的書、借閱列表、續借或圖書館欠書時呼叫。',
  inputSchema,
  execute,
  requiresConfirmation: false,
};
