import type { AssistantCampusEventTarget } from '../../assistantCampusEvent';
import { CAMPUS_EVENT_MESSAGES, prepareCampusEventRequest } from './campusEventRequest';
import { bounded, fail, requireAssistantPermission, type Adapter, type Binding, type Step } from './contracts';
import { withOperationSignal } from './operation';
import { formatPublicCampusRead, parsePublicCampusResult } from './publicCampus';
import { publicCampusEventTargets } from './publicCampusSelection';

/** One-based ordinal in a fresh, bounded recent-activity read. No caller-supplied
 * title, dates, source path, filters or school can change this query. */
export type CampusEventDiscovery = { index: number };

export function parseCampusEventDiscovery(raw: unknown): CampusEventDiscovery {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw) ||
      ![Object.prototype, null].includes(Object.getPrototypeOf(raw))) return fail();
  const descriptors = Object.getOwnPropertyDescriptors(raw);
  if (Reflect.ownKeys(descriptors).length !== 1 || !Object.hasOwn(descriptors, 'index')) return fail();
  const descriptor = descriptors.index;
  if (!descriptor.enumerable || !('value' in descriptor) || !Number.isInteger(descriptor.value) ||
      descriptor.value < 1 || descriptor.value > 5) return fail();
  return { index: descriptor.value };
}

type DiscoveryReply = Awaited<ReturnType<typeof prepareCampusEventRequest>> & { campusEventPreview: boolean };

/** Discovery is preparation, never a write or a read retry. An ordinal can only
 * select from a complete, verified list; partial lists require an explicit
 * identity selection through the existing event-preview path. */
export async function prepareCampusEventDiscovery(input: {
  discovery: CampusEventDiscovery;
  adapter: Adapter;
  binding: Binding;
  secret: string;
  writes: boolean;
  now: number;
  signal: AbortSignal;
}): Promise<DiscoveryReply> {
  const { index } = parseCampusEventDiscovery(input.discovery);
  const started = Date.now(), currentTime = () => input.now + Math.max(0, Date.now() - started);
  const steps: Step[] = [];
  let eventTargets: AssistantCampusEventTarget[] = [];
  const selection = (answer: string, stopReason: string): DiscoveryReply => ({
    answer, stopReason, steps, cards: [], eventTargets, dataRead: true, campusEventPreview: false,
  });
  try {
    return await bounded(signal => withOperationSignal(signal, async () => {
      await requireAssistantPermission(input.adapter, 'createPersonalEvent');
      signal.throwIfAborted();
      if (!input.adapter.publicCampus) return fail('CAMPUS_EVENT_UNAVAILABLE', 503);
      const raw = await bounded(child => withOperationSignal(child, async () => {
        const result = await input.adapter.publicCampus!('events', 5);
        child.throwIfAborted();
        return result;
      }), signal, 12000);
      signal.throwIfAborted();
      const read = parsePublicCampusResult(raw, input.binding.schoolId, 'events');
      eventTargets = publicCampusEventTargets(read, input.binding.schoolId);
      if (read.status !== 'ready') {
        steps.push({ name: 'get_campus_events', status: 'error', summary: '目前無法核對近期活動來源' });
        return selection(formatPublicCampusRead(read) + '\n這次沒有準備或新增行程。', 'CAMPUS_EVENT_UNAVAILABLE');
      }
      // A single invalid choice makes the ordered selection unusable. It cannot
      // be removed and shift the ordinal onto a different event.
      if (eventTargets.length !== read.items.length) return fail('INVALID_PUBLIC_CAMPUS_RESULT', 502);
      steps.push({ name: 'get_campus_events', status: 'ok', summary: read.partial
        ? '已取得部分近期活動，仍有來源或其他項目尚未核對'
        : '已核對目前來源列出的近期活動與原始順序' });
      const ordered = read.items.every((item, position, items) => !position ||
        items[position - 1].startsAt!.localeCompare(item.startsAt!) < 0 ||
        (items[position - 1].startsAt === item.startsAt && items[position - 1].id.localeCompare(item.id) <= 0));
      if (read.partial || !ordered) {
        return selection('目前取得的活動清單尚未完整核對，或來源順序無法確認，因此沒有直接挑選第 ' + index +
          ' 筆。請從這次列出的活動選擇一筆，我會重新核對來源與時間，再提供確認卡。這次沒有新增行程。',
        'CAMPUS_EVENT_SELECTION_REQUIRED');
      }
      if (!eventTargets.length) return selection('這次已讀取的近期活動沒有可選項目，尚未準備或新增行程。請稍後重新查詢活動；這不代表校內沒有其他活動。',
        'CAMPUS_EVENT_EMPTY');
      if (index > eventTargets.length) return selection(`這次清單只有 ${eventTargets.length} 筆，沒有第 ${index} 筆活動。請從列出的項目選擇一筆；這次沒有準備或新增行程。`,
        'CAMPUS_EVENT_SELECTION_REQUIRED');
      const selected = eventTargets[index - 1];
      signal.throwIfAborted();
      const result = await prepareCampusEventRequest({ ...input,
        target: { schoolId: selected.schoolId, source: selected.source, id: selected.id },
        now: currentTime(), signal });
      signal.throwIfAborted();
      // The exact-source read determines all card fields. The list is only an
      // identity hint, so a changed description cannot become calendar authority.
      return { ...result, campusEventPreview: true, steps: [...steps, ...result.steps],
        answer: `已依本次近期活動清單選擇第 ${index} 筆。\n` + result.answer };
    }), input.signal, 20000);
  } catch (error) {
    if (input.signal.aborted || (error as { status?: number }).status === 401) throw error;
    const rawCode = (error as { code?: string }).code;
    const code = typeof rawCode === 'string' && /^[A-Z_]{1,80}$/.test(rawCode) ? rawCode : 'CAMPUS_EVENT_UNAVAILABLE';
    steps.push({ name: 'prepare_campus_event', status: 'error', summary: code });
    return selection(CAMPUS_EVENT_MESSAGES[code] || CAMPUS_EVENT_MESSAGES.CAMPUS_EVENT_UNAVAILABLE, code);
  }
}
