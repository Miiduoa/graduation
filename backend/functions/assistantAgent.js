const nodeCrypto = require('crypto');
const { zodToJsonSchema } = require('zod-to-json-schema');

const DEFAULT_PROVIDER_ORDER = ['groq', 'gemini'];
const DEFAULT_GROQ_MODEL = 'llama-3.3-70b-versatile';
const MAX_WEB_SOURCES = 4;
const WEB_TIMEOUT_MS = 7000;

const PERSONAL_INTENTS = new Set([
  'assignment_status',
  'assignment_planning',
  'study_summary',
  'credit_audit',
  'grades_analysis',
  'personal_schedule',
  'leave_request',
  'leave_status',
]);

const CAMPUS_INTERNAL_INTENTS = new Set(['announcements', 'events', 'menus', 'pois']);

const SAFE_AGENT_ACTIONS = new Set([
  'search_web',
  'get_schedule',
  'list_assignments',
  'draft_message',
  'create_reminder_draft',
  'navigate',
  'queue_action',
  'open_url',
  'schedule_reminder',
  'split_assignment',
  'start_navigation',
  'review_ai_suggestion',
]);

const SENSITIVE_AGENT_ACTIONS = new Set([
  'draft_message',
  'create_reminder_draft',
  'queue_action',
  'schedule_reminder',
  'split_assignment',
  'submit_draft',
  'check_in',
  'review_ai_suggestion',
]);

function env(name, fallback = '') {
  return String(process.env[name] ?? fallback).trim();
}

function parseProviderOrder(value = env('ASSISTANT_MODEL_PROVIDERS')) {
  const items = value
    .split(',')
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean);
  return items.length > 0 ? items : DEFAULT_PROVIDER_ORDER;
}

function createRequestId() {
  if (typeof nodeCrypto.randomUUID === 'function') return nodeCrypto.randomUUID();
  return nodeCrypto.randomBytes(16).toString('hex');
}

function hashUserId(uid, schoolId = '') {
  if (!uid) return null;
  return nodeCrypto.createHash('sha256').update(`${schoolId}:${uid}`).digest('hex').slice(0, 24);
}

function normalizeText(value) {
  return String(value ?? '')
    .toLowerCase()
    .replace(/<[^>]+>/g, '')
    .replace(/&quot;/g, '"')
    .replace(/&#039;|&apos;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\s+/g, ' ')
    .trim();
}

function truncate(value, maxLength = 700) {
  const text = String(value ?? '').trim();
  if (text.length <= maxLength) return text;
  return `${text.slice(0, maxLength - 1).trim()}…`;
}

function tokenizeQuery(query) {
  const normalized = normalizeText(query).replace(/[^\p{L}\p{N}\s]/gu, ' ');
  const tokens = new Set(
    normalized
      .split(/\s+/)
      .map((token) => token.trim())
      .filter((token) => token.length >= 2),
  );

  const cjkSegments = normalized.match(/[\u4e00-\u9fff]{2,}/g) ?? [];
  for (const segment of cjkSegments) {
    tokens.add(segment);
    for (let index = 0; index < segment.length - 1; index += 1) {
      tokens.add(segment.slice(index, index + 2));
    }
  }

  return Array.from(tokens).slice(0, 32);
}

function scoreText(query, value) {
  const haystack = normalizeText(value);
  if (!haystack) return 0;
  let score = 0;
  for (const token of tokenizeQuery(query)) {
    if (haystack.includes(token.toLowerCase())) {
      score += token.length >= 3 ? 3 : 1.5;
    }
  }
  if (/\d/.test(haystack)) score += 0.5;
  return score;
}

function rankKnowledgeChunks(query, chunks, limit = 6) {
  if (!Array.isArray(chunks) || chunks.length === 0) return [];
  return chunks
    .map((chunk) => ({
      ...chunk,
      score: scoreText(
        query,
        [
          chunk.title,
          chunk.summary,
          chunk.text,
          Array.isArray(chunk.tags) ? chunk.tags.join(' ') : '',
        ].join('\n'),
      ),
    }))
    .filter((chunk) => chunk.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}

function resolvePermissionScope(intent, hasAuth) {
  if (!hasAuth) return 'public';
  if (PERSONAL_INTENTS.has(intent)) {
    return intent === 'credit_audit' || intent === 'grades_analysis'
      ? 'academic_private'
      : 'user_private';
  }
  return 'school_public';
}

function shouldUseServerWebSearch(rawText, intent) {
  if (PERSONAL_INTENTS.has(intent)) return false;
  const text = normalizeText(rawText);
  if (!text) return false;
  const explicitExternal =
    /連網|搜尋|查網路|公開來源|google maps|wikipedia|維基|現任|即時.*(班次|天氣)|今天.*天氣|天氣|下雨|帶傘|路線|怎麼去|如何到|搭.*公車/i.test(
      text,
    );
  if (CAMPUS_INTERNAL_INTENTS.has(intent)) return explicitExternal;
  return explicitExternal || /最新|目前/i.test(text);
}

function normalizeAssistantAction(action, permissionScope = 'school_public') {
  if (!action || typeof action !== 'object') return null;
  const actionName = String(action.action || '').trim();
  if (!SAFE_AGENT_ACTIONS.has(actionName)) return null;

  const requiresConfirmation =
    action.requiresConfirmation === true || SENSITIVE_AGENT_ACTIONS.has(actionName);
  return {
    label: String(action.label || actionName).slice(0, 80),
    action: actionName,
    params: action.params && typeof action.params === 'object' ? action.params : {},
    requiresConfirmation,
    sensitivity: action.sensitivity || (requiresConfirmation ? 'medium' : 'low'),
    permissionScope,
    evidenceRefs: Array.isArray(action.evidenceRefs) ? action.evidenceRefs : [],
    status: requiresConfirmation ? 'pending_confirmation' : 'proposed',
  };
}

function normalizeAssistantActions(actions, permissionScope = 'school_public') {
  if (!Array.isArray(actions)) return [];
  return actions.map((action) => normalizeAssistantAction(action, permissionScope)).filter(Boolean);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function parseRetryAfter(headers, attempt) {
  const raw = headers?.get?.('retry-after');
  const parsed = Number(raw);
  if (Number.isFinite(parsed) && parsed > 0) return parsed * 1000;
  return Math.min(8000, 1000 * 2 ** attempt);
}

async function fetchJson(
  url,
  { fetchImpl = globalThis.fetch, timeoutMs = WEB_TIMEOUT_MS, ...options } = {},
) {
  if (typeof fetchImpl !== 'function') return null;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(url, {
      ...options,
      signal: controller.signal,
      headers: {
        Accept: 'application/json',
        'Accept-Language': 'zh-TW,zh-Hant;q=0.9,zh;q=0.8,en;q=0.5',
        'User-Agent': 'CampusAssistant/1.0',
        ...(options.headers || {}),
      },
    });
    if (!response.ok) return null;
    return await response.json();
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

function buildMapDirectionsUrl(origin, destination) {
  const params = new URLSearchParams({
    api: '1',
    origin,
    destination,
    travelmode: 'transit',
  });
  return `https://www.google.com/maps/dir/?${params.toString()}`;
}

function routeAnswer(query) {
  if (!/(怎麼去|如何到|怎麼到|路線|搭.*公車|導航|交通)/.test(query)) return null;
  const cleaned = query
    .replace(/^(請問|幫我|搜尋|查詢)/, '')
    .replace(/[？?。！!]/g, '')
    .trim();
  const explicit = cleaned.match(/(?:從|自)([^到去，。？！?]{2,24})(?:到|去)([^，。？！?]{2,30})/);
  const origin = explicit?.[1]?.replace(/(怎麼|如何|要|想)$/g, '').trim() || '靜宜大學';
  const destination =
    explicit?.[2]?.trim() ||
    cleaned
      .replace(/^(我)?(要|想)?(怎麼|如何)(去|到)/, '')
      .replace(/(怎麼走|路線|導航|交通)/g, '')
      .trim();

  if (!destination || destination.length < 2) return null;
  const url = buildMapDirectionsUrl(origin, destination);
  const sources = [
    {
      title: 'Google Maps 大眾運輸路線',
      url,
      source: 'Google Maps',
      snippet: `從 ${origin} 到 ${destination} 的即時大眾運輸路線。`,
    },
  ];

  if (
    /靜宜|静宜|providence/i.test(origin) &&
    /台中車站|臺中車站|台中火車站|臺中火車站/.test(destination)
  ) {
    sources.unshift({
      title: '臺中市公車即時動態：300 靜宜大學 - 臺中車站',
      url: 'https://citybus-free.taichung.gov.tw/driving-map?route=300',
      source: '臺中市公車即時動態',
      snippet: '300 路線為靜宜大學 - 臺中車站，可查往臺中車站方向的即時到站資訊。',
    });
  }

  return {
    content: [
      `我幫你準備了即時路線查詢：${origin} → ${destination}`,
      '',
      sources.length > 1
        ? '靜宜大學到臺中車站可先看 300 路公車，再用 Google Maps 比較即時轉乘。'
        : '我目前沒有付費地圖 API，所以不會在聊天裡硬編即時班次或票價。請打開路線連結確認最新交通狀況。',
      '',
      url,
      '',
      `查詢時間：${new Date().toLocaleString('zh-TW', { timeZone: 'Asia/Taipei' })}`,
      `資料來源：${sources.map((source) => source.source).join('、')}`,
    ].join('\n'),
    sources: sources.slice(0, MAX_WEB_SOURCES),
    confidence: sources.length > 1 ? 'high' : 'medium',
    suggestions: ['查公車到站', '改出發地', '推薦午餐'],
  };
}

function normalizeWeatherLocation(query) {
  if (/靜宜|静宜|沙鹿/.test(query)) {
    return { name: '台中市沙鹿區靜宜大學', latitude: 24.226, longitude: 120.563 };
  }
  if (/台中|臺中/.test(query)) {
    return { name: '台中市', latitude: 24.1477, longitude: 120.6736 };
  }
  return { name: '台中市沙鹿區靜宜大學', latitude: 24.226, longitude: 120.563 };
}

function describeWeather(code) {
  if (code == null) return '天氣狀態未提供';
  if (code === 0) return '晴朗';
  if ([1, 2, 3].includes(code)) return '多雲到晴';
  if ([45, 48].includes(code)) return '有霧';
  if ([51, 53, 55, 56, 57].includes(code)) return '毛毛雨';
  if ([61, 63, 65, 66, 67].includes(code)) return '降雨';
  if ([80, 81, 82].includes(code)) return '陣雨';
  if ([95, 96, 99].includes(code)) return '雷雨';
  return `天氣代碼 ${code}`;
}

async function weatherAnswer(query, options = {}) {
  if (!/(天氣|氣溫|下雨|帶傘|雨具|天候)/.test(query)) return null;
  const location = normalizeWeatherLocation(query);
  const params = new URLSearchParams({
    latitude: String(location.latitude),
    longitude: String(location.longitude),
    current: 'temperature_2m,relative_humidity_2m,precipitation,rain,weather_code,wind_speed_10m',
    timezone: 'Asia/Taipei',
  });
  const data = await fetchJson(
    `https://api.open-meteo.com/v1/forecast?${params.toString()}`,
    options,
  );
  const current = data?.current;
  if (!current) return null;

  const rain = current.rain ?? current.precipitation ?? 0;
  const source = {
    title: 'Open-Meteo Current Weather',
    url: `https://open-meteo.com/en/docs?latitude=${location.latitude}&longitude=${location.longitude}`,
    source: 'Open-Meteo',
    updatedAt: current.time,
    snippet: `${location.name}：${describeWeather(current.weather_code)}，${current.temperature_2m ?? '?'}°C，降雨 ${rain}mm`,
  };

  return {
    content: [
      `我剛剛連網查到 ${location.name} 的即時天氣：`,
      '',
      `- 狀況：${describeWeather(current.weather_code)}`,
      `- 溫度：${current.temperature_2m ?? '未提供'}°C`,
      `- 濕度：${current.relative_humidity_2m ?? '未提供'}%`,
      `- 降雨：${rain}mm`,
      `- 風速：${current.wind_speed_10m ?? '未提供'} km/h`,
      '',
      rain > 0
        ? '目前有降雨資料，建議帶傘。'
        : '目前降雨量不高，但天氣仍可能變化，出門前可以再確認一次。',
      '',
      `查詢時間：${new Date().toLocaleString('zh-TW', { timeZone: 'Asia/Taipei' })}`,
      '資料來源：Open-Meteo',
    ].join('\n'),
    sources: [source],
    confidence: 'high',
    suggestions: ['再查一次天氣', '查公車', '推薦午餐'],
  };
}

async function wikipediaSources(query, options = {}) {
  const params = new URLSearchParams({
    action: 'query',
    list: 'search',
    srsearch: query,
    format: 'json',
    origin: '*',
    srlimit: '3',
  });
  const data = await fetchJson(`https://zh.wikipedia.org/w/api.php?${params.toString()}`, options);
  const entries = data?.query?.search ?? [];
  return entries.slice(0, 3).map((entry) => ({
    title: entry.title || 'Wikipedia',
    url: `https://zh.wikipedia.org/wiki/${encodeURIComponent(String(entry.title || '').replace(/\s/g, '_'))}`,
    source: 'Wikipedia 中文',
    updatedAt: entry.timestamp,
    snippet: normalizeText(entry.snippet),
  }));
}

async function duckDuckGoSources(query, options = {}) {
  const params = new URLSearchParams({
    q: query,
    format: 'json',
    no_html: '1',
    skip_disambig: '1',
    no_redirect: '1',
    t: 'campus-assistant',
  });
  const data = await fetchJson(`https://api.duckduckgo.com/?${params.toString()}`, options);
  const sources = [];
  if (data?.Answer) {
    sources.push({
      title: data.Heading || 'DuckDuckGo Instant Answer',
      url: data.AbstractURL || 'https://duckduckgo.com/',
      snippet: normalizeText(data.Answer),
      source: 'DuckDuckGo',
    });
  }
  if (data?.AbstractText) {
    sources.push({
      title: data.Heading || 'DuckDuckGo 摘要',
      url: data.AbstractURL || 'https://duckduckgo.com/',
      snippet: normalizeText(data.AbstractText),
      source: data.AbstractSource || 'DuckDuckGo',
    });
  }
  return sources;
}

function buildGroundedWebSummary(query, sources) {
  const usefulSources = sources.filter((source) => source?.snippet).slice(0, MAX_WEB_SOURCES);
  if (usefulSources.length === 0) return null;

  const evidence = usefulSources
    .map((source, index) => `來源 ${index + 1}：${truncate(source.snippet, 180)}`)
    .join('\n');
  return {
    content: [
      `我用公開來源查詢「${truncate(query, 80)}」後，整理如下：`,
      '',
      truncate(usefulSources[0].snippet, 280),
      '',
      evidence,
      '',
      `查詢時間：${new Date().toLocaleString('zh-TW', { timeZone: 'Asia/Taipei' })}`,
      `資料來源：${usefulSources.map((source) => source.source).join('、')}`,
    ].join('\n'),
    sources: usefulSources,
    confidence: 'medium',
    suggestions: ['再查一次', '看來源', '換個問法'],
  };
}

async function answerWithServerWebSearch(query, options = {}) {
  const route = routeAnswer(query);
  if (route) return route;

  const weather = await weatherAnswer(query, options);
  if (weather) return weather;

  const [wiki, ddg] = await Promise.all([
    wikipediaSources(query, options),
    duckDuckGoSources(query, options),
  ]);
  return buildGroundedWebSummary(query, [...wiki, ...ddg]);
}

function zodSchemaToOpenAiParameters(schema) {
  if (!schema || typeof schema !== 'object') {
    return { type: 'object', properties: {} };
  }
  try {
    const json = zodToJsonSchema(schema, { target: 'openApi3', $refStrategy: 'none' });
    delete json.$schema;
    return json;
  } catch {
    return { type: 'object', properties: {} };
  }
}

/**
 * OpenAI / Groq Chat Completions 的 tools 陣列（function calling）。
 * @param {Array<{ name: string, description?: string, inputSchema?: import('zod').ZodTypeAny }>} toolsList
 */
function buildToolDefinitions(toolsList) {
  return (toolsList || []).map((t) => ({
    type: 'function',
    function: {
      name: t.name,
      description: t.description || t.name,
      parameters: t.inputSchema ? zodSchemaToOpenAiParameters(t.inputSchema) : { type: 'object', properties: {} },
    },
  }));
}

function buildAgentSystemPrompt({
  schoolId,
  actorRole,
  permissionScope,
  structuredContext = {},
  knowledgeChunks = [],
  webAnswer = null,
  toolPromptSection = '',
  writeFewShotBlock = '',
}) {
  const contextText = JSON.stringify(structuredContext, (_key, value) => {
    if (typeof value === 'string') return truncate(value, 700);
    return value;
  });
  const knowledgeText = knowledgeChunks
    .slice(0, 6)
    .map(
      (chunk, index) =>
        `[K${index + 1}] ${chunk.title || chunk.sourceType || chunk.sourceId || 'knowledge'}\n${truncate(chunk.summary || chunk.text, 900)}`,
    )
    .join('\n\n');
  const webText = webAnswer
    ? webAnswer.sources
        .slice(0, MAX_WEB_SOURCES)
        .map(
          (source, index) =>
            `[W${index + 1}] ${source.title}\n${truncate(source.snippet, 500)}\n${source.url}`,
        )
        .join('\n\n')
    : '';

  const toolBlock = toolPromptSection
    ? [
        '',
        '推理策略：',
        '1. 先判斷問題需要哪些資料（可能不只一個工具）。',
        '2. 若需要多個工具，先呼叫最基礎的（例如課表），再依結果決定下一步。',
        '3. 若某工具回傳空結果，可換查詢策略（例如改用 searchCampusDocs 全文檢索）。',
        '4. 遇到缺口時要先自我突破：整理 attemptedTools、failedBecause、desiredCapability，呼叫 reflectOnGap 取得 breakthrough；若 breakthrough.suggestedTools 有尚未嘗試的工具且回合允許，優先重試。',
        '5. 若所有工具仍無法回答、且屬校園相關，呼叫 reflectOnGap 後要說明已記錄缺口、下一步學習計畫與目前無該資料；禁止編造數據。',
        '',
        '可使用工具（名稱與用途；實際呼叫以 API tools 為準）：',
        toolPromptSection,
        '寫入／提交類操作須由使用者確認後由系統執行，請勿宣稱已直接完成。',
      ].join('\n')
    : '';

  return [
    '你是「小靜」，一個可上架使用的校園 AI 代理。',
    '你不能宣稱自己和 Codex、ChatGPT 或任何前沿模型有相同參數量；只能說明可透過後端模型、RAG、工具和回饋改善能力。',
    '回答必須用繁體中文，直接、可執行，避免空泛自我介紹。',
    '所有會寫入、通知、預約、提交、付款或影響他人的動作，都只能產生待確認草稿，不可說已直接完成。',
    '只能使用已提供的授權資料與公開 web evidence；沒有資料就明說，不要編造課表、作業、成績、班次、價格或即時狀態。',
    '你的第一優先是回答使用者訊息中最明確的問題。',
    '只有在使用者問題很籠統（例如「幫我整理一下今天」「今天怎樣」）時，才主動產生今日摘要或簡報。',
    '若使用者問的是單一查詢（例如：還沒還的書、某一門課、某一份作業），請專注回答該問題，不要額外附上與問題無關的長篇摘要。',
    '當所有工具都無法解決、且問題明顯屬於校園相關時，不能只說「我不知道」；要先呼叫 reflectOnGap，根據 breakthrough 回傳的工具建議與 learningSteps 說明下一步會如何學會。',
    '回答若使用來源，請在文字中簡短提到來源名稱。',
    '',
    `schoolId=${schoolId || 'unknown'} actorRole=${actorRole || 'student'} permissionScope=${permissionScope || 'public'}`,
    '',
    '授權結構化資料 JSON：',
    truncate(contextText, 5000),
    knowledgeText ? `\n可檢索知識：\n${knowledgeText}` : '',
    webText ? `\n公開網路證據：\n${webText}` : '',
    toolBlock,
    writeFewShotBlock ? truncate(String(writeFewShotBlock), 3500) : '',
  ]
    .filter(Boolean)
    .join('\n');
}

function toOpenAiCompatBody(messages, model, tools = []) {
  const body = {
    model,
    messages,
    max_tokens: Number(env('ASSISTANT_MODEL_MAX_TOKENS', '900')),
    temperature: Number(env('ASSISTANT_MODEL_TEMPERATURE', '0.4')),
    stream: false,
  };
  if (tools.length > 0) {
    body.tools = tools;
    body.tool_choice = 'auto';
  }
  return body;
}

async function callOpenAiCompatChat({
  fetchImpl = globalThis.fetch,
  provider,
  baseUrl,
  apiKey,
  model,
  messages,
  tools = [],
}) {
  if (!apiKey || !model || typeof fetchImpl !== 'function') return null;
  let lastError = null;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const response = await fetchImpl(`${baseUrl.replace(/\/+$/, '')}/chat/completions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(toOpenAiCompatBody(messages, model, tools)),
    });

    if (response.status === 429 || response.status >= 500) {
      lastError = {
        status: response.status,
        retryAfterMs: parseRetryAfter(response.headers, attempt),
      };
      await sleep(lastError.retryAfterMs);
      continue;
    }

    if (!response.ok) {
      const body = await response.text().catch(() => '');
      throw new Error(`${provider} failed: HTTP ${response.status} ${body.slice(0, 160)}`);
    }

    const data = await response.json();
    const message = data?.choices?.[0]?.message;
    const rawToolCalls = message?.tool_calls;
    const toolCalls =
      Array.isArray(rawToolCalls) && rawToolCalls.length > 0 ? rawToolCalls : null;
    const content =
      message?.content != null && String(message.content).length > 0 ? String(message.content) : '';
    return {
      provider,
      model,
      content,
      toolCalls,
      usage: data?.usage || null,
    };
  }

  throw new Error(`${provider} rate limited or unavailable: ${lastError?.status || 'unknown'}`);
}

async function callGeminiGenerate({ fetchImpl = globalThis.fetch, apiKey, model, messages }) {
  if (!apiKey || !model || typeof fetchImpl !== 'function') return null;
  const system = messages
    .filter((message) => message.role === 'system')
    .map((message) => message.content)
    .join('\n\n');
  const contents = messages
    .filter((message) => message.role !== 'system')
    .map((message) => ({
      role: message.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: String(message.content || '') }],
    }));

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`;
  const response = await fetchImpl(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      systemInstruction: system ? { parts: [{ text: system }] } : undefined,
      contents,
      generationConfig: {
        temperature: Number(env('ASSISTANT_MODEL_TEMPERATURE', '0.4')),
        maxOutputTokens: Number(env('ASSISTANT_MODEL_MAX_TOKENS', '900')),
      },
    }),
  });

  if (response.status === 429) {
    await sleep(parseRetryAfter(response.headers, 0));
    return null;
  }
  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new Error(`gemini failed: HTTP ${response.status} ${body.slice(0, 160)}`);
  }

  const data = await response.json();
  return {
    provider: 'gemini',
    model,
    content: data?.candidates?.[0]?.content?.parts?.map((part) => part.text || '').join('') || '',
    usage: data?.usageMetadata || null,
  };
}

async function callAssistantModel({
  messages,
  toolDefs,
  fetchImpl = globalThis.fetch,
  providerOrder = parseProviderOrder(),
}) {
  const errors = [];

  if (Array.isArray(toolDefs) && toolDefs.length > 0) {
    try {
      const result = await callOpenAiCompatChat({
        fetchImpl,
        provider: 'groq',
        baseUrl: env('GROQ_BASE_URL', 'https://api.groq.com/openai/v1'),
        apiKey: env('GROQ_API_KEY'),
        model: env('GROQ_MODEL', env('OPENAI_COMPAT_MODEL', DEFAULT_GROQ_MODEL)),
        messages,
        tools: toolDefs,
      });
      if (result && (result.toolCalls?.length > 0 || result.content)) {
        return { ...result, errors };
      }
    } catch (error) {
      errors.push({ provider: 'groq', message: error?.message || String(error) });
    }
    return {
      provider: 'none',
      model: null,
      content: '',
      toolCalls: null,
      usage: null,
      errors,
    };
  }

  for (const provider of providerOrder) {
    try {
      if (provider === 'groq') {
        const result = await callOpenAiCompatChat({
          fetchImpl,
          provider: 'groq',
          baseUrl: env('GROQ_BASE_URL', 'https://api.groq.com/openai/v1'),
          apiKey: env('GROQ_API_KEY'),
          model: env('GROQ_MODEL', env('OPENAI_COMPAT_MODEL', DEFAULT_GROQ_MODEL)),
          messages,
          tools: [],
        });
        if (result?.content) return { ...result, errors };
      }

      if (provider === 'gemini') {
        const result = await callGeminiGenerate({
          fetchImpl,
          apiKey: env('GEMINI_API_KEY') || env('GOOGLE_API_KEY'),
          model: env('GEMINI_MODEL', 'gemini-2.5-flash'),
          messages,
        });
        if (result?.content) return { ...result, errors };
      }
    } catch (error) {
      errors.push({ provider, message: error?.message || String(error) });
    }
  }

  return {
    provider: 'none',
    model: null,
    content: '',
    usage: null,
    errors,
  };
}

/**
 * requiresConfirmation 的工具不列入 toolDefs，僅能由 executeAgentWrite 在使用者確認後執行。
 * 含 tool 角色之對話僅 Groq OpenAI 相容 API 能可靠續寫；最後一輪若歷史含 tool 則只用 groq。
 */
async function callAssistantModelWithTools({
  messages,
  toolCtx,
  fetchImpl = globalThis.fetch,
  providerOrder = parseProviderOrder(),
  maxRounds = 3,
}) {
  const { tools, runTool } = require('./agent/tools/registry');
  const toolDefs = buildToolDefinitions(tools.filter((t) => !t.requiresConfirmation));
  const { buildCardsFromToolTrace } = require('./agent/cardBuilders');

  const toolsInvoked = [];
  const toolCallsTrace = [];
  function recordToolName(name) {
    const n = name && String(name).trim();
    if (!n || toolsInvoked.includes(n)) return;
    toolsInvoked.push(n);
  }
  function recordToolCall(name, args, output) {
    toolCallsTrace.push({ name, args, output });
  }

  let currentMessages = [...messages];

  for (let round = 0; round < maxRounds; round += 1) {
    const result = await callAssistantModel({
      messages: currentMessages,
      toolDefs,
      fetchImpl,
      providerOrder,
    });

    if (!result.toolCalls || result.toolCalls.length === 0) {
      const transcriptMessages = [...currentMessages];
      if (result.content) {
        transcriptMessages.push({ role: 'assistant', content: result.content });
      }
      const cards = buildCardsFromToolTrace(toolCallsTrace);
      return { ...result, transcriptMessages, toolsInvoked, toolCallsTrace, cards };
    }

    const assistantMsg = {
      role: 'assistant',
      content: result.content || null,
      tool_calls: result.toolCalls,
    };

    const toolResults = await Promise.all(
      result.toolCalls.map(async (call) => {
        const name = call?.function?.name;
        recordToolName(name);
        let args = {};
        try {
          const raw = call?.function?.arguments;
          args = raw && String(raw).trim() ? JSON.parse(raw) : {};
        } catch {
          args = {};
        }
        try {
          if (!name) throw new Error('missing tool name');
          const output = await runTool(name, toolCtx, args);
          recordToolCall(name, args, output);
          return {
            role: 'tool',
            tool_call_id: call.id,
            content: JSON.stringify(output),
          };
        } catch (e) {
          const errOut = { error: String(e?.message || e) };
          recordToolCall(name, args, errOut);
          return {
            role: 'tool',
            tool_call_id: call.id,
            content: JSON.stringify(errOut),
          };
        }
      }),
    );

    currentMessages = [...currentMessages, assistantMsg, ...toolResults];
  }

  const finalOrder = currentMessages.some((m) => m.role === 'tool') ? ['groq'] : providerOrder;
  const finalResult = await callAssistantModel({
    messages: currentMessages,
    toolDefs: undefined,
    fetchImpl,
    providerOrder: finalOrder,
  });
  const transcriptMessages = [...currentMessages];
  if (finalResult.content) {
    transcriptMessages.push({ role: 'assistant', content: finalResult.content });
  }
  const cards = buildCardsFromToolTrace(toolCallsTrace);
  return { ...finalResult, transcriptMessages, toolsInvoked, toolCallsTrace, cards };
}

module.exports = {
  SAFE_AGENT_ACTIONS,
  SENSITIVE_AGENT_ACTIONS,
  answerWithServerWebSearch,
  buildAgentSystemPrompt,
  buildToolDefinitions,
  callAssistantModel,
  callAssistantModelWithTools,
  createRequestId,
  hashUserId,
  normalizeAssistantAction,
  normalizeAssistantActions,
  parseProviderOrder,
  rankKnowledgeChunks,
  resolvePermissionScope,
  shouldUseServerWebSearch,
};
