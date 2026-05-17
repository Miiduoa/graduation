import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.8';

const OPENAI_CHAT_URL = 'https://api.openai.com/v1/chat/completions';
const OPENAI_TRANSCRIBE_URL = 'https://api.openai.com/v1/audio/transcriptions';

const DEFAULT_DAILY_LIMIT = Number.parseInt(Deno.env.get('AI_MATERIAL_DAILY_LIMIT') ?? '30', 10) || 30;
const TRANSCRIBE_MAX_BYTES = Number.parseInt(
  Deno.env.get('AI_MATERIAL_TRANSCRIBE_MAX_BYTES') ?? '20971520',
  10,
) || 20_971_520;

/**
 * 簡易 PII redaction：屏蔽 email、台灣身分證、手機號、長數字串。
 * 用於送入 LLM 上下文前；不取代正規 DPIA。
 */
function redactPii(s: string): string {
  if (!s) return s;
  return s
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '[REDACTED_EMAIL]')
    .replace(/\b[A-Z][12]\d{8}\b/g, '[REDACTED_ID]')
    .replace(/\b09\d{2}[- ]?\d{3}[- ]?\d{3}\b/g, '[REDACTED_PHONE]')
    .replace(/\b\d{4}[- ]?\d{4}[- ]?\d{4}[- ]?\d{4}\b/g, '[REDACTED_CARD]')
    .replace(/\b\d{10,}\b/g, '[REDACTED_NUM]');
}

async function loadCompliancePolicy(admin: ReturnType<typeof createClient>) {
  const { data } = await admin
    .from('ai_compliance_policies')
    .select('*')
    .eq('id', 'default')
    .maybeSingle();
  return data as
    | {
        enabled: boolean;
        daily_user_limit: number;
        pii_redaction_required: boolean;
        cross_border_storage_allowed: boolean;
        cross_border_region: string | null;
      }
    | null;
}

type Body = {
  material_id?: string;
  /** 教師可提供短稿／逐字稿協助摘要；自動轉寫成功時會併入摘要上下文。 */
  teacher_note?: string;
  /** 必須為 true：確認已瞭解將把影音送往雲端供轉寫／切段摘要。 */
  user_consented?: boolean;
  /** 選填：Storage 物件之簽名 URL（由下層 `createSignedUrl` 生成）。僅同源 Supabase 主機可接受，避免 SSRF。 */
  signed_media_url?: string;
};

function transcriptionFilename(mime: string): string {
  const m = mime.toLowerCase();
  if (m.includes('mp4')) return 'clip.mp4';
  if (m.includes('webm')) return 'clip.webm';
  if (m.includes('mpeg')) return 'clip.mp3';
  if (m.includes('wav')) return 'clip.wav';
  if (m.includes('m4a')) return 'clip.m4a';
  return 'clip.bin';
}

function mediaLooksTranscribable(mime: string): boolean {
  const m = mime.toLowerCase();
  return m.startsWith('audio/') || m.startsWith('video/');
}

function mediaUrlSharesSupabaseHost(mediaUrl: string, supabaseUrl: string): boolean {
  try {
    const mu = new URL(mediaUrl);
    const su = new URL(supabaseUrl);
    if (mu.protocol !== 'https:' || su.protocol !== 'https:') return false;
    return mu.hostname.toLowerCase() === su.hostname.toLowerCase();
  } catch {
    return false;
  }
}

async function transcribeSignedMedia(
  signedUrl: string,
  mime: string,
  openaiKey: string,
): Promise<string | null> {
  const head = await fetch(signedUrl, { method: 'HEAD' }).catch(() => null as Response | null);
  const lenHdr = head?.headers.get('content-length');
  if (lenHdr) {
    const n = Number.parseInt(lenHdr, 10);
    if (Number.isFinite(n) && n > TRANSCRIBE_MAX_BYTES) {
      console.warn('[material-ai-pipeline] media too large for transcription:', n);
      return null;
    }
  }

  const mediaRes = await fetch(signedUrl);
  if (!mediaRes.ok) {
    console.warn('[material-ai-pipeline] failed to fetch media', mediaRes.status);
    return null;
  }
  const buf = await mediaRes.arrayBuffer();
  if (buf.byteLength > TRANSCRIBE_MAX_BYTES) {
    console.warn('[material-ai-pipeline] media body exceeds cap');
    return null;
  }

  const blob = new Blob([buf], { type: mime || undefined });
  const fd = new FormData();
  fd.append('file', blob, transcriptionFilename(mime));
  fd.append(
    'model',
    Deno.env.get('OPENAI_TRANSCRIPTION_MODEL')?.trim() || 'whisper-1',
  );

  const trRes = await fetch(OPENAI_TRANSCRIBE_URL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${openaiKey}` },
    body: fd,
  });
  const trJson = await trRes.json().catch(() => ({}));
  if (!trRes.ok) {
    console.warn('[material-ai-pipeline] transcription api error', trJson);
    return null;
  }
  const text = typeof trJson?.text === 'string' ? trJson.text.trim() : '';
  return text || null;
}

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

  if (!url || !anon || !serviceKey) {
    return new Response(JSON.stringify({ error: 'Missing Supabase env' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const jwt = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '').trim();
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

  const mid = typeof payload.material_id === 'string' ? payload.material_id.trim() : '';
  const note = typeof payload.teacher_note === 'string' ? payload.teacher_note.trim().slice(0, 8000) : '';
  if (!mid) {
    return new Response(JSON.stringify({ error: 'material_id required' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const admin = createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: mat } = await admin
    .from('course_materials')
    .select('id, title, course_id, external_url, mime_type')
    .eq('id', mid)
    .maybeSingle();

  const courseId = typeof mat?.course_id === 'string' ? mat.course_id : '';
  if (!courseId) {
    return new Response(JSON.stringify({ error: 'Material not found' }), {
      status: 404,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const { data: crs } = await admin.from('courses').select('ai_media_enabled').eq('id', courseId).maybeSingle();
  if (crs && crs.ai_media_enabled === false) {
    return new Response(JSON.stringify({ error: 'AI media disabled for course' }), {
      status: 403,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const { data: cm } = await admin
    .from('course_members')
    .select('role')
    .eq('course_id', courseId)
    .eq('user_id', user.id)
    .maybeSingle();

  const r = (cm?.role as string | undefined) ?? '';
  if (!(r === 'teacher' || r === 'assistant')) {
    return new Response(JSON.stringify({ error: 'Forbidden: course staff only' }), {
      status: 403,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  if (payload.user_consented !== true) {
    return new Response(JSON.stringify({ error: 'user_consented must be true' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
    });
  }

  // ── 合規組態：enabled/quota/PII/跨境 ───────────────────────────
  const policy = await loadCompliancePolicy(admin);
  if (policy && policy.enabled === false) {
    return new Response(JSON.stringify({ error: 'AI pipeline disabled by policy' }), {
      status: 403,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
    });
  }

  const dailyLimit = policy?.daily_user_limit ?? DEFAULT_DAILY_LIMIT;
  const piiRedactRequired = policy?.pii_redaction_required ?? true;

  const today = new Date().toISOString().slice(0, 10);
  const { data: usageRow } = await admin
    .from('ai_usage_daily')
    .select('requests')
    .eq('user_id', user.id)
    .eq('usage_date', today)
    .maybeSingle();
  const cur = typeof usageRow?.requests === 'number' ? usageRow.requests : 0;
  if (cur >= dailyLimit) {
    // Quota 超限：寫一筆告警 outbox（供 Datadog/Slack 監控）
    await admin.from('alert_dispatch_outbox').insert({
      kind: 'ai_quota_exceeded',
      payload: {
        user_id: user.id,
        usage_today: cur,
        quota: dailyLimit,
        date: today,
      },
    });
    return new Response(JSON.stringify({ error: `Daily AI limit (${dailyLimit}) exceeded` }), {
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

  const title = typeof mat?.title === 'string' ? mat.title : '教材';
  const ext = typeof mat?.external_url === 'string' ? mat.external_url.trim() : '';
  const mime = typeof mat?.mime_type === 'string' ? mat.mime_type : '';
  const signedMedia =
    typeof payload.signed_media_url === 'string' ? payload.signed_media_url.trim() : '';

  let segments: { startSec: number; endSec: number; excerpt: string; summary: string }[] = [];
  let subtitleVtt: string | null = null;
  let modelUsed = 'none';
  let stub = false;
  let whisperTranscript: string | null = null;

  if (!openaiKey) {
    stub = true;
    segments = [
      {
        startSec: 0,
        endSec: 30,
        excerpt: '【示範占位】未設定 OPENAI_API_KEY；若要啟用 Whisper 類轉寫請加金鑰後重送。',
        summary: '占位摘要：部署 Edge 並填入金鑰。',
      },
    ];
    subtitleVtt = `WEBVTT\n\n00:00:00.000 --> 00:00:02.000\n(Stub) ${title}\n`;
  } else {
    if (
      signedMedia &&
      mediaLooksTranscribable(mime) &&
      mediaUrlSharesSupabaseHost(signedMedia, url)
    ) {
      whisperTranscript = await transcribeSignedMedia(signedMedia, mime || 'audio/mpeg', openaiKey);
    }

    const sys =
      '你是教學影音助理。輸出 STRICT JSON 陣列物件，欄位：startSec,endSec,excerpt,summary（繁中）。' +
      '若有逐字稿，段落秒數請盡量與講稿語意對齊；否則可合理假設。3~8 段。勿包 Markdown。' +
      '若輸入中含 [REDACTED_*] 標記表示已被屏蔽 PII，請維持標記不要還原。';
    const safeTranscript = piiRedactRequired
      ? whisperTranscript
        ? redactPii(whisperTranscript)
        : whisperTranscript
      : whisperTranscript;
    const safeNote = piiRedactRequired ? redactPii(note) : note;
    const tw =
      safeTranscript && safeTranscript.length > 0
        ? `語音／影片自動轉寫（截取前 6500 字）：\n${safeTranscript.slice(0, 6500)}\n`
        : '';
    const userMsg = `教材標題：${title}\nMIME：${mime || '—'}\n外部 URL：${ext || '—'}\n${tw}教師補充：${
      safeNote || '（無）'
    }\n`;

    const oaiRes = await fetch(OPENAI_CHAT_URL, {
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
        temperature: 0.35,
        max_tokens: 1200,
      }),
    });

    const oaiJson = await oaiRes.json().catch(() => ({}));
    if (!oaiRes.ok) {
      return new Response(JSON.stringify({ error: 'OpenAI error', detail: oaiJson }), {
        status: 502,
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
      });
    }

    const content = oaiJson?.choices?.[0]?.message?.content;
    const raw = typeof content === 'string' ? content.trim() : '';
    try {
      const parsed = JSON.parse(raw) as unknown;
      if (Array.isArray(parsed)) {
        segments = parsed
          .map((row) => ({
            startSec: Number((row as Record<string, unknown>).startSec ?? 0),
            endSec: Number((row as Record<string, unknown>).endSec ?? 0),
            excerpt: String((row as Record<string, unknown>).excerpt ?? ''),
            summary: String((row as Record<string, unknown>).summary ?? ''),
          }))
          .slice(0, 8);
      }
    } catch {
      segments = [
        {
          startSec: 0,
          endSec: 60,
          excerpt: raw.slice(0, 400),
          summary: '無法解析為 JSON 陣列，已改以截斷原文顯示。',
        },
      ];
    }

    if (segments.length === 0) {
      segments.push({
        startSec: 0,
        endSec: 10,
        excerpt: '無有效分段',
        summary: '請補充 teacher_note 以供模型推論',
      });
    }

    const vttLines = ['WEBVTT', ''];
    const stamp = (sec: number) => {
      const s = Math.max(0, Math.floor(sec));
      const h = Math.floor(s / 3600);
      const mi = Math.floor((s % 3600) / 60);
      const r = s % 60;
      const p = (n: number) => String(n).padStart(2, '0');
      return `${p(h)}:${p(mi)}:${p(r)}.000`;
    };
    for (const s of segments) {
      const t0 = stamp(s.startSec);
      const t1 = stamp(Math.max(s.startSec + 1, s.endSec));
      vttLines.push(`${t0} --> ${t1}`);
      vttLines.push(s.excerpt.replace(/\n+/g, ' ').slice(0, 500));
      vttLines.push('');
    }
    subtitleVtt = vttLines.join('\n');
    const chatModel = String(Deno.env.get('OPENAI_MODEL') ?? 'gpt-4o-mini');
    modelUsed = whisperTranscript
      ? `${Deno.env.get('OPENAI_TRANSCRIPTION_MODEL')?.trim() || 'whisper-1'}+${chatModel}`
      : chatModel;
  }

  const { error: upErr } = await admin.from('material_ai_enrichment').upsert(
    {
      material_id: mid,
      course_id: courseId,
      status: 'ready',
      subtitle_vtt: subtitleVtt,
      segments,
      model_used: modelUsed,
      error_detail: stub
        ? 'stub_no_openai_key'
        : mediaLooksTranscribable(mime) && !!signedMedia && !whisperTranscript
          ? 'transcribe_missing_or_failed'
          : null,
      created_by: user.id,
      pii_redacted: piiRedactRequired,
      region_stored: policy?.cross_border_region ?? null,
      cross_border_flag: !!(policy?.cross_border_storage_allowed && policy?.cross_border_region),
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'material_id' },
  );

  if (upErr) {
    return new Response(JSON.stringify({ error: upErr.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  return new Response(
    JSON.stringify({
      ok: true,
      usage_count_today: typeof cntRaw === 'number' ? cntRaw : Number(cntRaw),
      stub,
      transcribed: Boolean(whisperTranscript?.length),
      transcript_preview:
        whisperTranscript && whisperTranscript.length ? whisperTranscript.slice(0, 240) : null,
      segments,
      subtitle_preview: subtitleVtt ? subtitleVtt.slice(0, 400) : null,
    }),
    {
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
    },
  );
});
