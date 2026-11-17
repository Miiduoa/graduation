'use strict';

const { parseLibraryLoanRequest, chooseLibraryLoan } = require('./libraryLoanSelection');

function loan(id, bookTitle, extra = {}) {
  return { id, bookTitle, status: 'borrowed', dueAt: '2026-11-20T00:00:00.000Z', ...extra };
}

function titleTarget(title, extra = {}) {
  return { kind: 'title', title, onlyOverdue: false, ...extra };
}

describe('parseLibraryLoanRequest', () => {
  test.each([
    ['《', '》'], ['「', '」'], ['『', '』'], ['"', '"'], ['“', '”'], ['‘', '’'],
  ])('recognizes one title enclosed by %s%s', (opening, closing) => {
    expect(parseLibraryLoanRequest(`幫我續借${opening} 資料結構 ${closing}`))
      .toEqual(titleTarget('資料結構'));
  });

  test.each(['禪', '長書名'.repeat(40), 'IntroductionToAlgorithms'])('keeps %s as an explicit title', (title) => {
    expect(parseLibraryLoanRequest(`還書《${title}》`)).toEqual(titleTarget(title));
  });

  test.each([
    '續借《資料結構', '續借《資料結構」', '續借資料結構》', '續借《》',
    '續借《   》', '續借《資料結構》和《演算法》', '續借《資料結構》《資料結構》',
  ])('asks for clarification instead of discarding malformed or multiple titles: %s', (message) => {
    expect(parseLibraryLoanRequest(message)).toEqual({ kind: 'clarify' });
  });

  test('does not read overdue wording or a loan-ID label inside the title as instructions', () => {
    expect(parseLibraryLoanRequest('續借《逾期借閱 loanId: AbCdEfGh1234》'))
      .toEqual(titleTarget('逾期借閱 loanId: AbCdEfGh1234'));
    expect(parseLibraryLoanRequest('續借逾期的《時間管理》'))
      .toEqual(titleTarget('時間管理', { onlyOverdue: true }));
  });

  test.each(['借閱：', 'loanId: ', '編號 '])('preserves a case-sensitive ID following %s', (label) => {
    expect(parseLibraryLoanRequest(`續借 ${label}AbCdEfGh1234`))
      .toEqual({ kind: 'id', loanId: 'AbCdEfGh1234' });
  });

  test('keeps an outside labeled ID together with the quoted title', () => {
    expect(parseLibraryLoanRequest('還書《資料結構》 借閱：AbCdEfGh1234'))
      .toEqual(titleTarget('資料結構', { loanId: 'AbCdEfGh1234' }));
  });

  test.each(['AbCd/Other', 'AbCd.Other', 'AbCd中文', '/Other', 'A'.repeat(129), ''])(
    'refuses the entire invalid ID %s even when a title could select a different loan', (id) => {
      expect(parseLibraryLoanRequest(`續借 借閱：${id}`)).toEqual({ kind: 'clarify' });
      expect(parseLibraryLoanRequest(`續借《資料結構》 借閱：${id}`)).toEqual({ kind: 'clarify' });
    },
  );

  test('does not ignore an invalid second ID or an additional unquoted title', () => {
    expect(parseLibraryLoanRequest('續借 借閱：AbCdEfGh1234 編號：/Other'))
      .toEqual({ kind: 'clarify' });
    expect(parseLibraryLoanRequest('續借《資料結構》和演算法')).toEqual({ kind: 'clarify' });
    expect(parseLibraryLoanRequest('還書《資料結構》、演算法')).toEqual({ kind: 'clarify' });
  });

  test('accepts one repeated ID but refuses two different labeled IDs', () => {
    expect(parseLibraryLoanRequest('續借 借閱：AbCdEfGh1234 loanId: AbCdEfGh1234'))
      .toEqual({ kind: 'id', loanId: 'AbCdEfGh1234' });
    expect(parseLibraryLoanRequest('續借 借閱：AbCdEfGh1234 loanId: OtherLoan5678'))
      .toEqual({ kind: 'clarify' });
  });

  test.each([
    '幫我續借', '幫我還書', '請替我歸還。', '麻煩你幫我續借快到期的書！',
    '幫我還快到期的書', '續借即將到期的書', '還書最早到期的書', '歸還最近到期的書',
  ])('preserves an explicit generic single-book request: %s', (message) => {
    expect(parseLibraryLoanRequest(message)).toEqual({ kind: 'automatic', onlyOverdue: false });
  });

  test.each(['幫我續借逾期的書', '還過期的書'])('keeps an overdue-only generic request: %s', (message) => {
    expect(parseLibraryLoanRequest(message)).toEqual({ kind: 'automatic', onlyOverdue: true });
  });

  test.each([
    '續借不存在的書', '續借資料結構', '續借 IntroductionToAlgorithms',
    '續借全部的書', '還書《資料結構》「', '續借 loanIdAbCdEfGh1234',
  ])('refuses to reinterpret an unparsed target as the earliest loan: %s', (message) => {
    expect(parseLibraryLoanRequest(message)).toEqual({ kind: 'clarify' });
  });
});

describe('chooseLibraryLoan', () => {
  test('prefers a unique exact title over an earlier partial match regardless of due date', () => {
    const partial = loan('partial', '資料結構進階', { dueAt: '2026-11-18T00:00:00.000Z' });
    const exact = loan('exact', '資料結構');
    const loans = [partial, exact];
    const before = [...loans];
    expect(chooseLibraryLoan(loans, titleTarget('資料結構'))).toEqual({ loan: exact });
    expect(loans).toEqual(before);
  });

  test('matches a unique partial title after trimming and case folding', () => {
    const selected = loan('algorithm', '  Introduction to Algorithms  ');
    expect(chooseLibraryLoan([loan('other', 'Databases'), selected], titleTarget(' ALGORITHMS ')))
      .toEqual({ loan: selected });
    expect(chooseLibraryLoan([selected], titleTarget(' introduction TO algorithms ')))
      .toEqual({ loan: selected });
  });

  test.each([
    ['duplicate exact titles', [loan('copy-a', '資料結構'), loan('copy-b', '資料結構')]],
    ['multiple partial titles', [loan('part-a', '資料結構（一）'), loan('part-b', '資料結構（二）')]],
  ])('does not pick the first or earliest loan among %s', (_label, loans) => {
    expect(chooseLibraryLoan(loans, titleTarget('資料結構'))).toEqual({ selectionIssue: 'ambiguous' });
  });

  test('does not substitute an unrelated earliest loan when the requested title is missing', () => {
    expect(chooseLibraryLoan([loan('other', '其他書')], titleTarget('不存在的書')))
      .toEqual({ selectionIssue: 'not-found' });
    expect(chooseLibraryLoan([], titleTarget('不存在的書'))).toEqual({ selectionIssue: 'not-found' });
  });

  test('ignores returned and canceled rows before counting matches or selecting a default', () => {
    const inactive = ['returned', 'cancelled', 'canceled'].map((status) => loan(status, '資料結構', { status }));
    const active = loan('active', '資料結構');
    expect(chooseLibraryLoan([...inactive, active], titleTarget('資料結構'))).toEqual({ loan: active });
    expect(chooseLibraryLoan(inactive, titleTarget('資料結構'))).toEqual({ selectionIssue: 'not-found' });
    expect(chooseLibraryLoan(inactive, { kind: 'automatic', onlyOverdue: false })).toBeNull();
  });

  test('uses the case-sensitive ID to disambiguate a title without losing the title constraint', () => {
    const selected = loan('AbCdEfGh1234', '資料結構');
    const otherCopy = loan('OtherLoan5678', '資料結構');
    const loans = [otherCopy, selected];
    expect(chooseLibraryLoan(loans, titleTarget('資料結構', { loanId: selected.id })))
      .toEqual({ loan: selected });
    expect(chooseLibraryLoan(loans, titleTarget('資料結構', { loanId: selected.id.toLowerCase() })))
      .toEqual({ selectionIssue: 'not-found' });
    expect(chooseLibraryLoan(loans, titleTarget('不存在的書', { loanId: selected.id })))
      .toEqual({ selectionIssue: 'not-found' });
  });

  test('accepts the legacy loanId alias when it exactly identifies the requested title', () => {
    const selected = loan('record-a', '資料結構', { loanId: 'LegacyAbCd1234' });
    expect(chooseLibraryLoan([selected], titleTarget('資料結構', { loanId: 'LegacyAbCd1234' })))
      .toEqual({ loan: selected });
  });

  test('retains earliest-due selection only for an automatic request and leaves source order intact', () => {
    const later = loan('later', '較晚到期');
    const unknown = loan('unknown', '期限未知', { dueAt: null });
    const earliest = loan('earliest', '最早到期', { dueAt: '2026-11-18T00:00:00.000Z' });
    const loans = [later, unknown, earliest];
    const before = [...loans];
    expect(chooseLibraryLoan(loans, { kind: 'automatic', onlyOverdue: false })).toEqual({ loan: earliest });
    expect(loans).toEqual(before);
    expect(chooseLibraryLoan([], { kind: 'automatic', onlyOverdue: false })).toBeNull();
    expect(chooseLibraryLoan(loans, { kind: 'clarify' })).toEqual({ selectionIssue: 'clarify' });
  });
});
