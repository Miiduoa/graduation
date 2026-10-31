import type { OnDeviceSchoolContext } from './onDeviceSchoolContext';
import { validCampusSenseSnapshot, type CampusSenseSnapshot } from './campusSenseSnapshot';
import { runOfflineCampusTool } from './offlineCampusTools';
import {
  localCampusReadPrompt, localCampusReadQuery, parseLocalCampusReadPlan,
  type LocalReadMessage, type LocalCampusReadResult,
} from './localCampusToolProtocol';

/**
 * One bounded planning inference, followed by at most three deterministic reads.
 * The callback is the existing on-device engine. There is intentionally no
 * HTTP client, write executor, notification module or dynamic route lookup here.
 */
export async function resolveLocalCampusSemanticReads(input: {
  messages: readonly LocalReadMessage[];
  context: OnDeviceSchoolContext;
  snapshot?: CampusSenseSnapshot | null;
  uid: string;
  schoolId: string;
  assertCurrent: () => void;
  /** Fired only when an allowed local read is about to run. */
  onReadStart?: () => void;
  generate: (messages: NonNullable<ReturnType<typeof localCampusReadPrompt>>) => Promise<{
    content: string; finishReason: string;
  }>;
}): Promise<{ content: string; results: LocalCampusReadResult[] } | null> {
  input.assertCurrent();
  if (!input.uid || !input.schoolId || input.context.schoolId !== input.schoolId) return null;
  const scope = { uid: input.uid, schoolId: input.schoolId };
  const initialSense = validCampusSenseSnapshot(input.snapshot, scope);
  if (input.context.timetable.source !== 'saved-device-copy' && !initialSense) return null;
  const prompt = localCampusReadPrompt(input.messages);
  if (!prompt) return null;
  const selection = await input.generate(prompt);
  input.assertCurrent();
  // Truncated JSON can look valid while omitting the user's other requirements.
  if (selection.finishReason !== 'stop') return null;
  const plan = parseLocalCampusReadPlan(selection.content);
  if (!plan?.calls.length) return null;

  const results: LocalCampusReadResult[] = [];
  for (const [index, call] of plan.calls.entries()) {
    input.assertCurrent();
    input.onReadStart?.();
    input.assertCurrent();
    const now = Date.now();
    // Do not extend snapshot life by starting a long native inference.
    const sense = validCampusSenseSnapshot(input.snapshot, scope, now);
    const context = { ...input.context, checkedAt: new Date(now).toISOString() };
    const query = localCampusReadQuery(call);
    const answer = runOfflineCampusTool(query.question, context, sense, input.uid);
    const available = call.tool === 'timetable'
      ? context.timetable.source === 'saved-device-copy'
      : call.tool === 'assignments' ? sense?.assignments.status === 'available'
      : call.tool === 'announcements' ? sense?.announcements.status === 'available'
      : context.timetable.source === 'saved-device-copy' || Boolean(sense);
    const checkedAt = call.tool === 'timetable'
      ? context.timetable.updatedAt
      : call.tool === 'study-plan'
        ? sense?.checkedAt ?? context.timetable.updatedAt
        : sense?.checkedAt ?? null;
    results.push({
      id: call.tool + ':' + index,
      label: query.label,
      content: answer?.content || '目前沒有足夠且可核對的本機資料，請先在對應服務儲存或同步資料。',
      route: query.route,
      source: query.source,
      checkedAt,
      status: available && answer && answer.tool !== 'online-required' ? 'available' : 'unavailable',
    });
  }
  input.assertCurrent();
  return {
    content: results.map((result) => result.label + '\n' + result.content).join('\n\n'),
    results,
  };
}
