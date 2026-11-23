import { bounded, object, V2Error, type Adapter, type Binding } from './contracts';
import { parseCampusMapCommand, type CampusMapCommand } from './campusMapRequest';
import { crossServiceRequest } from './crossServiceRequest';
import { runCrossService } from './crossService';
import { createTools } from './tools';
import { issueTaskRetry } from './taskRetry';

/** A small read command, never a client-provided tool graph or private source. */
export function parseCampusMapReadTask(raw: unknown): CampusMapCommand {
  const task = object(raw, ['kind', 'query']);
  if (task.kind === 'next-class' && Object.keys(task).length === 1) return { kind: 'next-class' };
  if (task.kind !== 'place' || typeof task.query !== 'string' || Object.keys(task).length !== 2)
    throw new V2Error(422, 'INVALID_INPUT');
  const query = task.query.normalize('NFKC').trim();
  const command = parseCampusMapCommand(`查校園地點${query}的位置`);
  if (!command || command.kind !== 'place' || command.query !== query)
    throw new V2Error(422, 'INVALID_INPUT');
  return command;
}

/** Read-only entry that leaves every existing proposal and chat route intact. */
export async function readCampusMapRequest(input: {
  task: unknown;
  adapter: Adapter;
  binding: Binding;
  secret: string;
  now: number;
  signal: AbortSignal;
}) {
  const task = parseCampusMapReadTask(input.task);
  const question = task.kind === 'place' ? `查校園地點${task.query}的位置` : '下一堂課教室在哪裡';
  const request = crossServiceRequest(question, input.now, input.binding.schoolId);
  if (!request || !request.operations.length || request.operations.length > 2 ||
      request.operations.some(operation => operation.kind === 'map-location'
        ? operation.serviceId !== 'map'
        : operation.kind !== 'read' || !['get_schedule', 'get_campus_map'].includes(operation.tool || '')))
    throw new V2Error(422, 'INVALID_INPUT');
  input.signal.throwIfAborted();
  const started = Date.now();
  const tools = createTools(input.adapter, input.binding, input.secret, input.now, false);
  const result = await bounded(signal => runCrossService({
    request, tools, binding: input.binding, now: input.now, signal,
  }), input.signal, 14000);
  input.signal.throwIfAborted();
  if (result.cards.length || result.taskPlan.steps.some(step => step.cardIds?.length))
    throw new V2Error(503, 'MAP_READ_UNSAFE');
  const taskRetry = issueTaskRetry({ question, request, plan: result.taskPlan, binding: input.binding,
    secret: input.secret, now: input.now + Math.max(0, Date.now() - started), parsedAt: input.now });
  return { version: 2, ...result, ...(taskRetry ? { taskRetry } : {}),
    modelCalls: 0, usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 }, simulation: input.adapter.simulation };
}
