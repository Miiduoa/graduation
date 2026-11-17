'use strict';

const { toJsDate } = require('../lib/assistantFormat');

const titleQuotes = /《[^《》]*》|「[^「」]*」|『[^『』]*』|"[^"]*"|“[^“”]*”|‘[^‘’]*’/gu;
const quoteMark = /[《》「」『』"“”‘’]/u;
const normalizeTitle = (value) => String(value ?? '').normalize('NFC').trim().toLowerCase();

/** A named target must never become permission to choose some other loan. */
function parseLibraryLoanRequest(message) {
  const text = String(message ?? '').trim();
  const quoted = [...text.matchAll(titleQuotes)];
  const outside = text.replace(titleQuotes, ' ');
  if (quoted.length > 1 || quoteMark.test(outside)) return { kind: 'clarify' };
  const title = quoted[0]?.[0].slice(1, -1).trim();
  if (quoted.length && !title) return { kind: 'clarify' };

  // Titles such as 《IntroductionToAlgorithms》 are not identifiers. Require an
  // explicit label outside the title, and preserve case-sensitive document IDs.
  const labeledId = /(?:借閱(?:紀錄)?(?:編號|ID)?|loanId|loan|紀錄(?:編號|ID)?|編號|單號)(?:\s*[:：]\s*|\s+)([^\s，。！？,!?；;]*)/gi;
  const ids = [...outside.matchAll(labeledId)].map((match) => match[1]);
  // Invalid selectors must remain visible as an error, never get truncated or
  // disappear so that a different title/default target can take their place.
  if (ids.some((id) => !/^[A-Za-z0-9_-]{1,128}$/.test(id))) return { kind: 'clarify' };
  const uniqueIds = [...new Set(ids)];
  if (uniqueIds.length > 1) return { kind: 'clarify' };
  if (title && /[和與及或、]|還有|\band\b|\bor\b/iu.test(outside.replace(labeledId, ' '))) {
    return { kind: 'clarify' };
  }
  const loanId = uniqueIds[0];
  const onlyOverdue = /逾期|過期/.test(outside);
  if (title) return { kind: 'title', title, onlyOverdue, ...(loanId ? { loanId } : {}) };
  if (loanId) return { kind: 'id', loanId };

  // Only whole generic requests may use the earliest-due default. Unknown
  // unquoted book names and bulk requests require a clear target instead.
  const generic = text.replace(/\s+/gu, '').replace(/[。.!！?？]+$/u, '');
  if (/^(?:請|麻煩)?你?(?:幫我|替我|我想|我要)?(?:(?:續借|還書|歸還(?:書籍|書)?)|(?:續借|還書|還|歸還)(?:快到期|即將到期|最早到期|最近到期|逾期|過期)的?(?:書籍|書))(?:謝謝)?$/.test(generic)) {
    return { kind: 'automatic', onlyOverdue };
  }
  return { kind: 'clarify' };
}

function dueTime(row) {
  const date = toJsDate(row?.dueAt ?? row?.dueDate);
  return date && Number.isFinite(date.getTime()) ? date.getTime() : Number.POSITIVE_INFINITY;
}

function chooseLibraryLoan(loans, target) {
  const active = (Array.isArray(loans) ? loans : []).filter((loan) =>
    loan && !['returned', 'cancelled', 'canceled'].includes(String(loan.status || '').trim().toLowerCase()));
  if (target.kind === 'title') {
    const candidates = target.loanId
      ? active.filter((loan) => loan.id === target.loanId || loan.loanId === target.loanId)
      : active;
    const title = normalizeTitle(target.title);
    if (!title) return { selectionIssue: 'clarify' };
    const exact = candidates.filter((loan) => normalizeTitle(loan.bookTitle || loan.title) === title);
    const matches = exact.length ? exact : candidates.filter((loan) =>
      normalizeTitle(loan.bookTitle || loan.title).includes(title));
    if (matches.length !== 1) return { selectionIssue: matches.length ? 'ambiguous' : 'not-found' };
    return { loan: matches[0] };
  }
  if (target.kind !== 'automatic') return { selectionIssue: 'clarify' };
  const loan = [...active].sort((a, b) => dueTime(a) - dueTime(b))[0];
  return loan ? { loan } : null;
}

module.exports = { parseLibraryLoanRequest, chooseLibraryLoan };
