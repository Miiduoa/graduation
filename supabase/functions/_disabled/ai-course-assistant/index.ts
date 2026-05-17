import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.8';

const OPENAI_URL = 'https://api.openai.com/v1/chat/completions';
const DAILY_LIMIT = 30;

type Body = {
  course_id?: string;
  prompt?: string;
  context?: string;
};

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, {
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
      },
    });
  }

  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'POST only' }), {
      status: 405,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const url = Deno.env.get('SUPABASE_URL') ?? '';
  const anon = Deno.env.get('SUPABASE_ANON_KEY') ?? '';
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
  const openaiKey = Deno.env.get('OPENAI_API_KEY') ?? '';

  if (!url || !anon || !serviceKey || !openaiKey) {
    return new Response(JSON.stringify({ error: 'Missing env (SUPABASE_* or OPENAI_API_KEY)' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const authHeader = req.headers.get('Authorization') ?? '';
  const jwt = authHeader.replace(/^Bearer\s+/i, '').trim();
  if (!jwt) {
    return new Response(JSON.stringify({ error: 'Missing JWT' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const userClient = createClient(url, anon, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${jwt}` } },
  });

  const {
    data: { user },
    error: userErr,
  } = await userClient.auth.getUser(jwt);

  if (userErr || !user) {
    return new Response(JSON.stringify({ error: 'Invalid JWT' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  let payload: Body;
  try {
    payload = (await req.json()) as Body;
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const courseId = typeof payload.course_id === 'string' ? payload.course_id.trim() : '';
  const prompt = typeof payload.prompt === 'string' ? payload.prompt.trim() : '';
  const extraCtx = typeof payload.context === 'string' ? payload.context.trim().slice(0, 12000) : '';

  if (!courseId || !prompt) {
    return new Response(JSON.stringify({ error: 'course_id and prompt required' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const admin = createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: member, error: memErr } = await admin
    .from('course_members')
    .select('role')
    .eq('course_id', courseId)
    .eq('user_id', user.id)
    .maybeSingle();

  if (memErr || !member) {
    return new Response(JSON.stringify({ error: 'Forbidden: not a course member' }), {
      status: 403,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const today = new Date().toISOString().slice(0, 10);

  const { data: usageRow } = await admin
    .from('ai_usage_daily')
    .select('requests')
    .eq('user_id', user.id)
    .eq('usage_date', today)
    .maybeSingle();

  const cur = typeof usageRow?.requests === 'number' ? usageRow.requests : 0;
  if (cur >= DAILY_LIMIT) {
    return new Response(JSON.stringify({ error: `Daily AI limit (${DAILY_LIMIT}) exceeded` }), {
      status: 429,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
    });
  }

  const { data: cntRaw, error: cntErr } = await admin.rpc('increment_ai_usage', { p_uid: user.id });
  if (cntErr) {
    return new Response(JSON.stringify({ error: cntErr.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const cnt = typeof cntRaw === 'number' ? cntRaw : Number(cntRaw);

  const sys =
    '你是協助線上課程學習的助教。請依使用者問題作答；若上下文不足請說明限制。請使用繁體中文，簡潔有條理。';

  const userMsg =
    extraCtx.length > 0
      ? `【使用者問題】\n${prompt}\n\n【使用者提供的上下文片段】\n${extraCtx}`
      : `【使用者問題】\n${prompt}`;

  const oaiRes = await fetch(OPENAI_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${openaiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: Deno.env.get('OPENAI_MODEL') ?? 'gpt-4o-mini',
      messages: [
        { role: 'system', content: sys },
        { role: 'user', content: userMsg },
      ],
      temperature: 0.4,
      max_tokens: 900,
    }),
  });

  const oaiJson = await oaiRes.json().catch(() => ({}));

  if (!oaiRes.ok) {
    return new Response(JSON.stringify({ error: 'OpenAI error', detail: oaiJson }), {
      status: 502,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
    });
  }

  const reply =
    oaiJson?.choices?.[0]?.message?.content ??
    (typeof oaiJson === 'object' ? JSON.stringify(oaiJson) : String(oaiJson));

  return new Response(JSON.stringify({ reply, usage_count_today: cnt }), {
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
    },
  });
});
