import { parseAssistantCampusEventTargets, parseCampusEventCommand, type AssistantCampusEventTarget } from '../../assistantCampusEvent';
import { parseAssistantCalendarIntent } from '@campus/shared/src/assistantCalendarIntent';
import { parsePublicCampusResult } from './publicCampus';

export const CAMPUS_EVENT_SELECTION_REQUIRED_MESSAGE =
  '若要把公開活動加入個人行事曆，請從活動清單選擇一筆，或明確指定清單第幾筆。我會重新核對來源與時段，再提供確認卡；這次尚未建立活動行程。若另外要建立自己的行程，請分開提供名稱、日期與起訖時間。';

/** A whole verified reader result becomes one ordered choice list. A partial
 * result still identifies its displayed records, but cannot establish a global
 * ranking or authorize automatic selection from a discovery request.
 */
export function publicCampusEventTargets(raw: unknown, schoolId: string): AssistantCampusEventTarget[] {
  try {
    const read = parsePublicCampusResult(raw, schoolId, 'events');
    if (read.status !== 'ready') return [];
    return parseAssistantCampusEventTargets(read.items.map(item => ({
      schoolId, source: read.source, id: item.id, title: item.title, startsAt: item.startsAt,
      ...(item.endsAt !== undefined ? { endsAt: item.endsAt } : {}),
      ...(item.location !== undefined ? { location: item.location } : {}),
      href: item.href, checkedAt: read.checkedAt,
    })), schoolId);
  } catch { return []; }
}

/** This is a proposal guard, not a parser that grants execution authority.
 * Explicit source references must use the selected-event endpoint even when a
 * model proposes before reading, or the source lookup later fails. A standalone
 * appointment with its own name/date/time does not match merely for saying
 * "活動" in its title.
 */
export function publicEventCalendarSourceIntent(question: string, now = Date.now()): boolean {
  if (typeof question !== 'string' || question.length > 1000) return false;
  const command = parseCampusEventCommand(question);
  if (command?.kind === 'discover' || (command?.kind === 'followup' &&
      (command.explicitActivity || command.selection.kind === 'index'))) return true;
  const text = question.normalize('NFKC').replace(/[\s\p{Cf}]/gu, '');
  const calendar = '(?:個人)?(?:行事曆|日曆|行程)';
  const ordinal = '(?:第[一二兩三四五六七八九十\\d]{1,3}(?:個|筆|場|項)|第一個|首個)';
  const transfer = new RegExp(`(?:加入|加到|加進|放入|放到|排入|排進|新增|建立|儲存|保存).{0,60}${calendar}|${calendar}.{0,30}(?:加入|新增|建立|保存)`, 'u').test(text);
  const sourced = /(?:查詢|查看|查一下|列出|顯示|搜尋|看看|查|找).{0,20}活動|活動(?:清單|列表|查詢|結果)|(?:上面|上述|剛剛|剛才|查到|已查|近期|最近|最新|最早|全部|所有).{0,12}活動|(?:這|那)(?:個|筆|場)活動|(?:把|將)活動/u.test(text) ||
    new RegExp(`${ordinal}.{0,8}活動|活動.{0,8}${ordinal}`, 'u').test(text);
  const referenced = new RegExp(`(?:把|將)?${ordinal}(?:活動)?(?:加入|加到|加進|放入|放到|排入|排進).{0,8}${calendar}`, 'u').test(text);
  const publicTransfer = /(?:公開|校園|學校)(?:的)?活動/u.test(text) &&
    (transfer || /(?:安排|幫我排|替我排).{0,12}(?:公開|校園|學校)(?:的)?活動/u.test(text)) &&
    !parseAssistantCalendarIntent(question, now);
  const sourceArrangement = new RegExp(`(?:安排|幫我排|替我排).{0,12}(?:${ordinal}(?:活動)?|(?:這|那)(?:個|筆|場)活動)`, 'u').test(text);
  return referenced || sourceArrangement || publicTransfer || (transfer && sourced);
}
