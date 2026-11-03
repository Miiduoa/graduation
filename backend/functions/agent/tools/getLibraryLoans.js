'use strict';

const { z } = require('zod');
const { getFirestore } = require('firebase-admin/firestore');
const { toJsDate } = require('../../lib/assistantFormat');

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

function parseLoanDate(raw) {
  try {
    let date;
    if (raw && typeof raw.toMillis === 'function') {
      const milliseconds = raw.toMillis();
      if (typeof milliseconds !== 'number' || !Number.isFinite(milliseconds)) return null;
      date = new Date(milliseconds);
    } else {
      date = toJsDate(raw);
    }
    return date && Number.isFinite(date.getTime()) ? date : null;
  } catch {
    return null;
  }
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

  const snap = await loanPath(uid, schoolId).limit(50).get();
  const now = Date.now();
  const loans = [];

  for (const doc of snap.docs) {
    const row = { id: doc.id, ...doc.data() };
    if (!isActiveLoan(row)) continue;
    const dueDate = parseLoanDate(row.dueAt ?? row.dueDate);
    const overdueByStatus = String(row.status || '').toLowerCase() === 'overdue';
    const overdueByDate = dueDate != null && dueDate.getTime() < now;
    if (input.onlyOverdue && !overdueByStatus && !overdueByDate) continue;

    loans.push({
      id: doc.id,
      bookId: row.bookId != null ? String(row.bookId) : undefined,
      bookTitle: row.bookTitle != null ? String(row.bookTitle) : row.title != null ? String(row.title) : undefined,
      borrowedAt: parseLoanDate(row.borrowedAt)?.toISOString(),
      dueAt: dueDate?.toISOString(),
      status: row.status != null ? String(row.status) : 'borrowed',
      renewCount: typeof row.renewCount === 'number' ? row.renewCount : 0,
    });
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
