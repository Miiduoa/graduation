import { writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { V2Error, bytes, type History, type Model, type Obj } from './contracts';
import {
  fakeModel,
  fixtureAdapter,
  fixtureBinding,
  fixtureConfirm,
  FIXTURE_NOW,
  FIXTURE_SECRET,
  questions,
} from './fixtures';
import { GROQ_URL, groqModel } from './groq';
import { run } from './runner';
const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
export async function preview(args = process.argv.slice(2)) {
  const options = Object.fromEntries(
    args.map((a) => {
      if (!/^--(model|cases|output)=/.test(a)) throw new Error('Unknown argument');
      return a.slice(2).split(/=(.*)/).slice(0, 2);
    }),
  );
  const mode = options.model || 'fake';
  if (!['fake', 'groq'].includes(mode)) throw new Error('model must be fake or groq');
  if (options.cases && options.cases !== 'all') throw new Error('cases must be all');
  if (mode === 'groq' && !process.env.GROQ_API_KEY) throw new Error('GROQ_API_KEY is required');
  const network = globalThis.fetch;
  const deny: typeof fetch = async (url, init) => {
    if (mode !== 'groq' || String(url) !== GROQ_URL || init?.redirect !== 'error')
      throw new Error('Preview network denied');
    return network(url, init);
  };
  globalThis.fetch = deny;
  const lines: string[] = [];
  let memory: History = [];
  let nextCallAt = 0,
    minuteStart = 0,
    minuteTokens = 0;
  const groq = groqModel(mode === 'groq' ? process.env.GROQ_API_KEY : undefined, deny);
  const throttled: Model = async (input) => {
    const reservation =
      bytes({ messages: input.messages, tools: input.tools }) + input.max_completion_tokens + 128;
    const now = Date.now();
    const until = Math.max(now, nextCallAt);
    if (now < minuteStart + 61000 && minuteTokens + reservation > 7000)
      throw new V2Error(429, 'PREVIEW_TOKEN_BUDGET', 60);
    while (Date.now() < until) {
      input.signal.throwIfAborted();
      await wait(Math.min(10000, until - Date.now()));
    }
    input.signal.throwIfAborted();
    if (Date.now() >= minuteStart + 61000) {
      minuteStart = Date.now();
      minuteTokens = 0;
    }
    minuteTokens += reservation;
    nextCallAt = Date.now() + 2100;
    const result = await groq(input);
    minuteTokens += result.usage.total_tokens - reservation;
    return result;
  };
  try {
    for (let i = 0; i < questions.length; i++) {
      if (mode === 'groq' && i > 0) {
        for (let pause = 0; pause < 7; pause++) await wait(pause === 6 ? 1000 : 10000);
      }
      const fixture = fixtureAdapter();
      const binding = { ...fixtureBinding, conversationId: i === 7 ? 'case-3' : 'case-' + (i + 1) };
      const toolSequence: { name: string; args: Obj }[] = [];
      const base = fixture.adapter;
      const scripted = mode === 'fake' ? fakeModel(i) : throttled;
      let attempts = 0;
      const consumed = { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 };
      const model: Model = async (input) => {
        attempts++;
        const result = await scripted(input);
        for (const key of ['prompt_tokens', 'completion_tokens', 'total_tokens'] as const)
          consumed[key] += result.usage[key];
        for (const call of result.message.tool_calls || []) {
          try {
            toolSequence.push({
              name: call.function.name,
              args: JSON.parse(call.function.arguments) as Obj,
            });
          } catch {
            toolSequence.push({ name: call.function.name, args: { invalid: true } });
          }
        }
        return result;
      };
      try {
        const result = await run({
          question: questions[i],
          history: i === 7 ? memory : [],
          binding,
          adapter: base,
          model,
          secret: FIXTURE_SECRET,
          writes: true,
          retry429: mode === 'groq',
          signal: new AbortController().signal,
          now: FIXTURE_NOW,
          log: () => {},
        });
        if (i === 2)
          memory = [
            { role: 'user', content: questions[i] },
            { role: 'assistant', content: result.answer },
          ];
        const confirmed: unknown[] = [];
        if (i === 7 && result.cards[0]) {
          confirmed.push(await fixtureConfirm(binding, result.cards[0], base));
          confirmed.push(await fixtureConfirm(binding, result.cards[0], base));
        }
        const record = {
          caseId: i + 1,
          question: questions[i],
          tools: toolSequence,
          toolSteps: result.steps,
          modelCalls: result.modelCalls,
          usage: result.usage,
          finalAnswer: result.answer,
          actionCards: result.cards.map(({ token: _token, ...card }) => {
            void _token;
            return card;
          }),
          confirmationResults: confirmed,
          fixtureWriteResults: fixture
            .snapshot()
            .records.filter((r) => r.id.startsWith('av2_'))
            .map((r) => ({
              mutationId: r.id,
              title: r.title,
              date: r.date,
              startTime: r.startTime,
              endTime: r.endTime,
            })),
          fixtureWrites: fixture.writes.length,
          eventCount: fixture.snapshot().records.filter((r) => r.id.startsWith('av2_')).length,
          simulation: true,
          stopReason: result.stopReason,
        };
        lines.push(JSON.stringify(record));
      } catch (e) {
        lines.push(
          JSON.stringify({
            caseId: i + 1,
            question: questions[i],
            error: (e as { code?: string }).code || 'PREVIEW_FAILED',
            modelCalls: attempts,
            usage: consumed,
            finalAnswer: '查詢未完成',
            actionCards: [],
            fixtureWriteResults: fixture
              .snapshot()
              .records.filter((r) => r.id.startsWith('av2_'))
              .map((r) => ({
                mutationId: r.id,
                title: r.title,
                date: r.date,
                startTime: r.startTime,
                endTime: r.endTime,
              })),
            fixtureWrites: fixture.writes.length,
            tools: toolSequence,
            simulation: true,
          }),
        );
      }
    }
    const output = lines.join('\n') + '\n';
    if (options.output) await writeFile(options.output, output, { mode: 0o600 });
    else process.stdout.write(output);
    return lines.map((line) => JSON.parse(line) as Obj);
  } finally {
    globalThis.fetch = network;
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  preview().catch(() => {
    process.stderr.write('Preview failed (configuration or fixture error).\n');
    process.exitCode = 1;
  });
}
