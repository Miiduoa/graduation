'use strict';

const GROQ_MODEL = 'openai/gpt-oss-120b';
const GROQ_BASE_URL = 'https://api.groq.com/openai/v1';
const GROQ_CHAT_URL = `${GROQ_BASE_URL}/chat/completions`;
const DEADLINE_MS = 20_000;
const MAX_MESSAGE_CHARS = 4000;
const MAX_MESSAGES = 20;
const MAX_TOTAL_MESSAGE_CHARS = 16_000;
const MAX_TOKENS = 900;
const MAX_RESPONSE_BYTES = 64 * 1024;
const MAX_RESPONSE_CONTENT_CHARS = 8000;
const MAX_RETRY_AFTER_SECONDS = 60;

/** Configuration declaration only; this does not verify an account's billing tier. */
function resolveFreeCloudPolicy(env = process.env) {
  const baseUrl = env.GROQ_BASE_URL;
  if (
    env.CAMPUS_AGENT_GROQ_FREE_TIER_CONFIRMED !== 'true' ||
    env.GROQ_MODEL !== GROQ_MODEL ||
    typeof env.GROQ_API_KEY !== 'string' ||
    !env.GROQ_API_KEY.trim() ||
    (baseUrl != null &&
      baseUrl !== '' &&
      baseUrl !== GROQ_BASE_URL &&
      baseUrl !== `${GROQ_BASE_URL}/`)
  ) {
    return { status: 'unavailable', reason: 'not_configured' };
  }
  return { status: 'configured', provider: 'groq', model: GROQ_MODEL };
}

function getFreeCloudReadiness(env = process.env) {
  return resolveFreeCloudPolicy(env).status === 'configured';
}

function projectMessages(messages) {
  if (!Array.isArray(messages) || messages.length === 0 || messages.length > MAX_MESSAGES)
    return null;
  let total = 0;
  const projected = [];
  for (const message of messages) {
    if (
      !message ||
      !['system', 'user', 'assistant'].includes(message.role) ||
      typeof message.content !== 'string' ||
      message.content.length > MAX_MESSAGE_CHARS
    )
      return null;
    total += message.content.length;
    if (total > MAX_TOTAL_MESSAGE_CHARS) return null;
    projected.push({ role: message.role, content: message.content });
  }
  return projected;
}

function retryAfterSeconds(headers) {
  const raw = headers?.get?.('retry-after');
  if (typeof raw !== 'string' || !raw.trim()) return undefined;
  const seconds = /^\d+(?:\.\d+)?$/.test(raw.trim())
    ? Number(raw)
    : (Date.parse(raw) - Date.now()) / 1000;
  if (!Number.isFinite(seconds) || seconds <= 0) return undefined;
  return Math.min(MAX_RETRY_AFTER_SECONDS, Math.ceil(seconds));
}

function cancelBody(body) {
  try {
    Promise.resolve(body?.cancel?.()).catch(() => {});
  } catch {
    // Cleanup must not extend the request deadline.
  }
}

/**
 * All model traffic goes through one guarded transport. deps.env controls the
 * policy snapshot, not process.env: the legacy adapter still reads its own env.
 * A differing legacy endpoint/model is rejected; globals are never overwritten.
 * This function does not execute tool calls or assert data-disclosure consent.
 */
async function requestFreeCloudPlan({ messages, signal } = {}, deps = {}) {
  const env = deps.env ?? process.env;
  const policy = resolveFreeCloudPolicy(env);
  if (policy.status !== 'configured') return policy;
  const projectedMessages = projectMessages(messages);
  if (!projectedMessages) return { status: 'unavailable', reason: 'invalid_response' };
  if (signal?.aborted) return { status: 'unavailable', reason: 'canceled' };

  const apiKey = env.GROQ_API_KEY.trim();
  const fetchImpl = deps.fetchImpl ?? globalThis.fetch;
  const controller = new AbortController();
  let closed = false;
  let attempted = false;
  let responseAccepted = false;
  let failure = null;
  let resolveStopped;
  const stopped = new Promise((resolve) => {
    resolveStopped = resolve;
  });
  const stopError = new Error('Free cloud request stopped');

  function stop(reason, extra = {}) {
    if (!failure) {
      failure = { status: 'unavailable', reason, ...extra };
      resolveStopped();
      controller.abort();
    }
    return stopError;
  }

  async function bounded(promise) {
    const result = await Promise.race([
      Promise.resolve(promise).then(
        (value) => ({ value }),
        (error) => ({ error }),
      ),
      stopped.then(() => ({ stopped: true })),
    ]);
    if (result.stopped || failure || closed) throw stopError;
    if ('error' in result) throw result.error;
    return result.value;
  }

  const timer = setTimeout(() => stop('timeout'), DEADLINE_MS);
  const onAbort = () => stop('canceled');
  signal?.addEventListener('abort', onAbort, { once: true });
  // Cover cancellation between the first check and listener registration.
  if (signal?.aborted) onAbort();

  async function readBody(response) {
    const declared = response.headers?.get?.('content-length');
    if (declared != null && (!/^\d+$/.test(declared) || Number(declared) > MAX_RESPONSE_BYTES)) {
      cancelBody(response.body);
      throw stop('invalid_response');
    }
    if (response.body?.getReader) {
      const reader = response.body.getReader();
      const chunks = [];
      let size = 0;
      try {
        for (;;) {
          const { value, done } = await bounded(reader.read());
          if (done) break;
          size += value?.byteLength || 0;
          if (size > MAX_RESPONSE_BYTES) throw stop('invalid_response');
          if (value?.byteLength) chunks.push(Buffer.from(value));
        }
        return Buffer.concat(chunks).toString('utf8');
      } finally {
        if (failure || closed) cancelBody(reader);
        try {
          reader.releaseLock?.();
        } catch {
          /* a canceled read may still be pending */
        }
      }
    }
    if (typeof response.text !== 'function') throw stop('invalid_response');
    const text = await bounded(response.text());
    if (typeof text !== 'string' || Buffer.byteLength(text, 'utf8') > MAX_RESPONSE_BYTES) {
      throw stop('invalid_response');
    }
    return text;
  }

  async function guardedFetch(url, init = {}) {
    if (failure || closed) throw stopError;
    if (attempted || String(url) !== GROQ_CHAT_URL || init.method !== 'POST') {
      throw stop('provider_error');
    }
    let body;
    try {
      body = JSON.parse(init.body);
    } catch {
      throw stop('invalid_response');
    }
    const outboundMessages = projectMessages(body?.messages);
    if (
      body?.model !== GROQ_MODEL ||
      !outboundMessages ||
      JSON.stringify(outboundMessages) !== JSON.stringify(projectedMessages) ||
      ['tools', 'tool_choice', 'functions', 'function_call', 'response_format'].some(
        (key) => key in body,
      ) ||
      body.stream !== false ||
      !Number.isInteger(body.max_tokens) ||
      body.max_tokens < 1 ||
      !Number.isFinite(body.temperature) ||
      body.temperature < 0 ||
      body.temperature > 2
    )
      throw stop('invalid_response');
    attempted = true;
    let response;
    try {
      const pendingResponse = Promise.resolve().then(() => {
        if (failure || closed) throw stopError;
        return fetchImpl(GROQ_CHAT_URL, {
          method: 'POST',
          redirect: 'error',
          signal: controller.signal,
          headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            model: GROQ_MODEL,
            messages: projectedMessages,
            max_tokens: Math.min(body.max_tokens, MAX_TOKENS),
            temperature: body.temperature,
            stream: false,
          }),
        });
      });
      // A transport ignoring AbortSignal may still return a body after timeout.
      pendingResponse.then(
        (late) => {
          if (failure || closed) cancelBody(late?.body);
        },
        () => {},
      );
      response = await bounded(pendingResponse);
    } catch {
      throw failure ? stopError : stop('provider_error');
    }
    if (
      !response ||
      response.redirected ||
      (response.url && response.url !== GROQ_CHAT_URL) ||
      (response.status >= 300 && response.status < 400)
    ) {
      cancelBody(response?.body);
      throw stop('provider_error');
    }
    if (response.status === 429) {
      const retryAfter = retryAfterSeconds(response.headers);
      cancelBody(response.body);
      throw stop('rate_limited', retryAfter == null ? {} : { retryAfterSeconds: retryAfter });
    }
    if (!response.ok || response.status < 200 || response.status >= 300) {
      cancelBody(response.body);
      throw stop('provider_error');
    }
    try {
      const text = await readBody(response);
      const data = JSON.parse(text);
      const message = data?.choices?.[0]?.message;
      if (
        typeof message?.content !== 'string' ||
        !message.content.trim() ||
        message.content.length > MAX_RESPONSE_CONTENT_CHARS ||
        (message.tool_calls != null &&
          (!Array.isArray(message.tool_calls) || message.tool_calls.length > 0)) ||
        message.function_call != null
      )
        throw stop('invalid_response');
      responseAccepted = true;
      return new Response(text, { status: 200, headers: { 'Content-Type': 'application/json' } });
    } catch {
      throw failure ? stopError : stop('invalid_response');
    }
  }

  try {
    const modelCall = deps.modelCall ?? require('../assistantAgent').callAssistantModel;
    const result = await bounded(
      Promise.resolve().then(() => {
        if (failure || closed) throw stopError;
        return modelCall({
          messages: projectedMessages,
          fetchImpl: guardedFetch,
          providerOrder: ['groq'],
        });
      }),
    );
    if (
      !responseAccepted ||
      result?.provider !== 'groq' ||
      result.model !== GROQ_MODEL ||
      typeof result.content !== 'string' ||
      !result.content.trim() ||
      result.content.length > MAX_RESPONSE_CONTENT_CHARS ||
      (result.toolCalls != null &&
        (!Array.isArray(result.toolCalls) || result.toolCalls.length > 0))
    )
      return { status: 'unavailable', reason: 'invalid_response' };
    return { status: 'ok', content: result.content, provider: 'groq', model: GROQ_MODEL };
  } catch {
    return failure ?? { status: 'unavailable', reason: 'provider_error' };
  } finally {
    closed = true;
    clearTimeout(timer);
    signal?.removeEventListener('abort', onAbort);
    controller.abort();
  }
}

module.exports = {
  requestFreeCloudPlan,
  resolveFreeCloudPolicy,
  getFreeCloudReadiness,
  GROQ_MODEL,
  GROQ_CHAT_URL,
  DEADLINE_MS,
  MAX_MESSAGE_CHARS,
  MAX_RESPONSE_BYTES,
  MAX_TOKENS,
};
