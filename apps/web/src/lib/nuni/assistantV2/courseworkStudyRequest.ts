import { signCard } from './actions';
import {
  courseworkStudyTarget,
  readCourseworkStudyTask,
  selectCourseworkStudyEvent,
  studyGuardForTask,
} from './courseworkStudy';
import {
  bounded,
  fail,
  type Adapter,
  type Binding,
  type Card,
  type CourseworkStudyTarget,
  type Step,
} from './contracts';
import { withOperationSignal } from './operation';

export const COURSEWORK_STUDY_MESSAGES: Record<string, string> = {
  COURSEWORK_CHANGED:
    '這份作業或測驗的內容、期限或完成狀態已變更，請重新讀取後安排。這次沒有建立行程。',
  COURSEWORK_UNAVAILABLE:
    '目前無法核對這份作業或測驗的課程資格與原始資料，請重新查詢。這次沒有建立行程。',
  COURSEWORK_DEADLINE_REQUIRED:
    '這份作業或測驗沒有可核對的未來截止時間，請先確認期限，再尋找準備時段。',
  STUDY_DATE_OUT_OF_RANGE: '請選擇今天起七天內的日期，再尋找準備時段。',
  STUDY_SLOT_CHANGED:
    '課表或個人行程已變更，或這個時段已開始。請重新尋找並確認時段，這次沒有建立行程。',
  SCHEDULE_INCOMPLETE:
    '目前沒有完整的已同步課表，無法可靠判斷課間空堂。請先同步或補齊課表，再尋找時段。',
  CALENDAR_INCOMPLETE: '目前無法完整核對已同步的個人行程，請先檢查行事曆，再尋找時段。',
};

/** This selected-source operation is deterministic and never forwards coursework to a model. */
export async function prepareCourseworkStudyRequest(input: {
  target: CourseworkStudyTarget;
  adapter: Adapter;
  binding: Binding;
  secret: string;
  writes: boolean;
  now: number;
  signal: AbortSignal;
}): Promise<{ answer: string; cards: Card[]; steps: Step[]; stopReason: string; dataRead: true }> {
  const target = courseworkStudyTarget(input.target);
  const steps: Step[] = [];
  try {
    const result = await bounded(
      (signal) =>
        withOperationSignal(signal, async () => {
          const task = await readCourseworkStudyTask(input.adapter, target);
          steps.push({
            name: 'get_course_work',
            status: 'ok',
            summary: '已重新核對選取作業與課程資格',
          });
          const ledger = await input.adapter.ledger();
          signal.throwIfAborted();
          if (ledger.schoolId !== input.binding.schoolId) return fail('FORBIDDEN_SCOPE', 403);
          const event = selectCourseworkStudyEvent(
            ledger,
            input.binding,
            task,
            input.now,
            target.date,
          );
          steps.push({
            name: 'find_coursework_study_time',
            status: 'ok',
            summary: '已核對課間空堂與個人行程',
          });
          if (!event)
            return {
              answer: `${task.title}\n${target.date ? `${target.date} 當天` : '今天起七天內'}、截止前的已知課間空堂，沒有符合條件的 30 分鐘。已避開上課與個人行程，前後各保留 10 分鐘；尚未建立行程。`,
              cards: [],
              steps,
              stopReason: 'NO_STUDY_SLOT',
              dataRead: true as const,
            };
          if (!input.writes)
            return {
              answer: `可供核對的準備時段：\n${event.date} ${event.startTime}–${event.endTime}｜${task.title}\n目前未開放由助理儲存個人行程，這筆內容尚未加入行事曆。`,
              cards: [],
              steps,
              stopReason: 'WRITES_DISABLED',
              dataRead: true as const,
            };
          const card = signCard(
            input.binding,
            'propose_personal_event',
            event,
            ledger.revision,
            input.secret,
            input.now,
            undefined,
            undefined,
            studyGuardForTask(task, 'coursework-gap'),
          );
          steps.push({
            name: 'propose_personal_event',
            status: 'ok',
            summary: '已準備 30 分鐘行程，等待確認',
          });
          return {
            answer: `找到這份${task.kind === 'quiz' ? '測驗' : '作業'}的準備時段：\n${event.date} ${event.startTime}–${event.endTime}｜${task.title}\n依已同步課表與個人行程，只使用 08:00–22:00 的課間空堂，前後各保留 10 分鐘。\n按下確認後，會再次核對原作業、課表與行程，再儲存並讀回確認；目前尚未保存。`,
            cards: [card],
            steps,
            stopReason: '',
            dataRead: true as const,
          };
        }),
      input.signal,
      16000,
    );
    input.signal.throwIfAborted();
    return result;
  } catch (error) {
    if (input.signal.aborted || (error as { status?: number }).status === 401) throw error;
    const code = (error as { code?: string }).code || 'COURSEWORK_UNAVAILABLE';
    return {
      answer: COURSEWORK_STUDY_MESSAGES[code] || COURSEWORK_STUDY_MESSAGES.COURSEWORK_UNAVAILABLE,
      cards: [],
      steps: [...steps, { name: 'propose_coursework_study', status: 'error', summary: code }],
      stopReason: code,
      dataRead: true,
    };
  }
}
