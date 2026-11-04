import {
  catalog,
  fingerprint,
  ensureScope,
  intent,
  school,
  parseQuestion,
  entry,
  record,
  AssistantError,
} from './publicContext';
import { Confirmations } from './confirmation';
import { effectivePermissions } from './permissions';
import { validateResult, type Provider } from './provider';
export type Actor = { account: string; sessionHash: string; ip: string };
export class AssistantService {
  private buckets = new Map<string, number[]>();
  private busy = false;
  constructor(
    private provider: Provider,
    private now = Date.now,
    private confirmations = new Confirmations(),
  ) {}
  private limit(key: string, window: number, max: number) {
    const time = this.now();
    if (this.buckets.size > 10000) {
      for (const [id, times] of this.buckets)
        if (times.every((t) => t <= time - 3600000)) this.buckets.delete(id);
      if (this.buckets.size > 10000) throw new AssistantError('RATE_LIMITED', 429);
    }
    const times = (this.buckets.get(key) ?? []).filter((t) => t > time - window);
    if (times.length >= max) throw new AssistantError('RATE_LIMITED', 429);
    times.push(time);
    this.buckets.set(key, times);
  }
  async run(action: string, raw: unknown, actor: Actor): Promise<unknown> {
    if (action === 'execute' || action === 'enqueue')
      throw new AssistantError('ASSISTANT_WRITE_UNAVAILABLE', 403);
    this.limit('ip:' + actor.ip, 60000, 30);
    if (action === 'capability')
      return {
        enabled: true,
        provider: this.provider.name,
        ready: this.provider.ready,
        simulation: this.provider.name === 'fake',
        tools: ['publicServiceDirectory'],
        permissions: effectivePermissions(),
        catalog,
      };
    const input = record(
      raw,
      action === 'preview'
        ? ['schoolId', 'question', 'intent']
        : ['schoolId', 'intent', 'confirmation', 'consent'],
    );
    const schoolId = school(input.schoolId);
    const selected =
      action === 'preview' && input.question !== undefined
        ? parseQuestion(input.question)
        : intent(input.intent);
    ensureScope(selected, schoolId);
    if (input.question !== undefined && input.intent !== undefined)
      throw new AssistantError('INVALID_INPUT', 422);
    const binding = {
      stage: action === 'route' ? 'route' : 'ask',
      schoolId,
      intent: selected,
      fingerprint: fingerprint + ':' + entry(selected, schoolId).source,
      provider: this.provider.name,
      model: this.provider.model,
      session: actor.sessionHash,
    };
    if (action === 'preview')
      return {
        schoolId,
        intent: selected,
        summary: entry(selected, schoolId).summary,
        confirmation: this.confirmations.sign(binding),
        simulation: this.provider.name === 'fake',
      };
    if (input.consent !== true) throw new AssistantError('CONSENT_REQUIRED', 422);
    this.confirmations.verify(input.confirmation, binding);
    if (action === 'route') return { schoolId, intent: selected, ...entry(selected, schoolId) };
    if (action !== 'ask') throw new AssistantError('NOT_FOUND', 404);
    this.limit('minute:' + actor.account, 60000, 5);
    this.limit('hour:' + actor.account, 3600000, 20);
    if (!this.provider.ready) throw new AssistantError('PROVIDER_UNAVAILABLE');
    if (this.busy) throw new AssistantError('PROVIDER_BUSY', 429);
    this.busy = true;
    try {
      const sources = catalog
        .filter((item) => item.id === selected)
        .map(({ id, label, summary }) => ({ id, label, summary }));
      validateResult(await this.provider.ask({ intent: selected, sources }), selected);
      return {
        schoolId,
        intent: selected,
        answer: entry(selected, schoolId).summary,
        confirmation: this.confirmations.sign({ ...binding, stage: 'route' }),
        simulation: this.provider.name === 'fake',
      };
    } finally {
      this.busy = false;
    }
  }
}
