import type { TronClassSubmissionAvailability } from './tronClassSubmissionAvailability';

export const TRONCLASS_AVAILABILITY_DESCRIPTION = '以下是校方回傳的個人狀態；nuni 可送出的方式仍以本頁繳交區為準。';
export const TRONCLASS_AVAILABILITY_UNAVAILABLE = '暫時無法確認你的校方繳交狀態，已取得的作業內容與紀錄仍可查看。';
export const TRONCLASS_AVAILABILITY_GROUP = '這份作業採小組繳交，請至 TronClass 確認組別與繳交狀態。';

/** Shared display labels only; never derive canSubmit or an operation from them. */
export function tronClassSubmissionAvailabilityFacts(value: TronClassSubmissionAvailability): Array<[string, string]> {
  const ordinaryLabel = value.ordinary.kind === 'first' ? '一般初繳'
    : value.ordinary.kind === 'repeat' ? '一般再次繳交' : '一般繳交';
  const ordinary = {
    open: '校方目前開放', 'not-started': '尚未開始', closed: '已關閉',
    'attempts-exhausted': '一般繳交次數已用完', unknown: '尚待確認',
  }[value.ordinary.state];
  const remaining = value.ordinary.remainingAttempts === null ? '' : `，剩餘 ${value.ordinary.remainingAttempts} 次`;
  const makeUp = {
    none: '尚無個人補交紀錄', open: '個人補交已開放', used: '這次補交已使用',
    closed: '個人補交已關閉', disabled: '未開放補交', unknown: '暫時無法確認',
  }[value.makeUp.state];
  const resubmit = {
    none: '尚無個人重繳紀錄', open: '個人重繳已開放', used: '這次重繳已使用',
    closed: '個人重繳已關閉', disabled: '作業目前未開放重繳', unknown: '暫時無法確認',
  }[value.resubmit.state];
  const draft = value.draft.state === 'available' ? '校方有 1 份草稿，請至 TronClass 接續'
    : value.draft.state === 'ambiguous' ? `校方有 ${value.draft.count} 份草稿，請至 TronClass 確認`
      : value.draft.state === 'none' ? '校方沒有草稿' : '暫時無法確認校方草稿';
  return [[ordinaryLabel, `${ordinary}${remaining}`], ['個人補交', makeUp], ['個人重繳', resubmit], ['校方草稿', draft]];
}
