'use strict';

const { createHash } = require('node:crypto');
const { HttpsError } = require('firebase-functions/v2/https');
const { toJsDate } = require('../lib/assistantFormat');

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

/** Use the same reviewed values for a private mirror and a canonical loan. */
function projectLibraryLoan(id, row) {
  return {
    id,
    bookId: row.bookId != null ? String(row.bookId) : undefined,
    bookTitle: row.bookTitle != null ? String(row.bookTitle) : row.title != null ? String(row.title) : undefined,
    borrowedAt: parseLoanDate(row.borrowedAt)?.toISOString(),
    dueAt: parseLoanDate(row.dueAt ?? row.dueDate)?.toISOString(),
    status: row.status != null ? String(row.status) : 'borrowed',
    renewCount: typeof row.renewCount === 'number' ? row.renewCount : 0,
  };
}

/** Comparison only: the hash conveys neither ownership nor authorization. */
function libraryLoanVersion(row) {
  const reviewed = projectLibraryLoan(undefined, row);
  // The undefined ID is omitted by JSON serialization; scope is checked separately.
  return createHash('sha256').update(JSON.stringify(reviewed)).digest('hex');
}

/** Run after checking the canonical borrower, inside the service transaction. */
function assertLibraryLoanVersion(ctx, input, canonicalLoan) {
  const expected = input.expectedLoanVersion;
  if (expected === undefined && !ctx.agentActionKey) return;
  if (expected !== libraryLoanVersion(canonicalLoan)) {
    throw new HttpsError('failed-precondition', '借閱資料已變更，請重新查詢並確認。');
  }
}

module.exports = { projectLibraryLoan, libraryLoanVersion, assertLibraryLoanVersion };
