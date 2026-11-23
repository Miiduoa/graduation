import {
  canonical, fail, type Adapter, type Binding, type EventArgs,
} from './contracts';
import { operationSignal } from './operation';
import {
  parsePublicEventGuard, parsePublicEventResult, parsePublicEventTarget,
  type PublicEventGuard, type PublicEventTarget,
} from './publicEvent';

/** A selection is only a source identity. All calendar fields come from a fresh read. */
export async function readSelectedPublicEvent(
  adapter: Adapter, binding: Binding, requested: PublicEventTarget, now: number,
) {
  const target = parsePublicEventTarget(requested);
  if (target.schoolId !== binding.schoolId) return fail('FORBIDDEN_SCOPE', 403);
  operationSignal()?.throwIfAborted();
  if (!adapter.publicEvent) return fail('CAMPUS_EVENT_UNAVAILABLE', 503);
  const result = parsePublicEventResult(await adapter.publicEvent(target), target, now);
  operationSignal()?.throwIfAborted();
  if (result.status === 'unavailable') {
    switch (result.unavailable) {
      case 'NOT_FOUND': return fail('CAMPUS_EVENT_CHANGED', 409);
      case 'MISSING_END_TIME': return fail('CAMPUS_EVENT_TIME_REQUIRED', 409);
      case 'EVENT_NOT_FUTURE': return fail('CAMPUS_EVENT_START_PASSED', 409);
      case 'INVALID_EVENT': return fail('CAMPUS_EVENT_TIME_UNSUPPORTED', 409);
      default: return fail('CAMPUS_EVENT_UNAVAILABLE', 503);
    }
  }
  return result;
}

/** A changed public source cannot authorize writing the old event preview. */
export async function verifyPublicEventGuard(
  adapter: Adapter, binding: Binding, rawGuard: PublicEventGuard, event: EventArgs, now: number,
) {
  const guard = parsePublicEventGuard(rawGuard);
  const current = await readSelectedPublicEvent(adapter, binding, guard.target, now);
  if (guard.fingerprint !== current.fingerprint || canonical(event) !== canonical(current.args))
    return fail('CAMPUS_EVENT_CHANGED', 409);
}
