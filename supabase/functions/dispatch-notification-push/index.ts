import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.8';

const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';

type NotificationRow = {
  id: string;
  user_id: string;
  title: string;
  body: string;
  push_dispatch_attempts?: number | null;
};

/** Chunk Expo messages (doc recommends batches). */
function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

function truncate(s: string | null | undefined, max: number): string | null {
  if (s == null || s === '') return null;
  if (s.length <= max) return s;
  return s.slice(0, max - 1) + '…';
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

  const expectedSecret = Deno.env.get('NOTIFICATION_DISPATCH_SECRET') ?? '';
  const authHeader = req.headers.get('Authorization') ?? '';
  const bearer = authHeader.replace(/^Bearer\s+/i, '').trim();

  if (!expectedSecret || bearer !== expectedSecret) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
  const expoAccessToken = Deno.env.get('EXPO_ACCESS_TOKEN') ?? '';

  if (!supabaseUrl || !serviceKey) {
    return new Response(JSON.stringify({ error: 'Missing Supabase env' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const admin = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const maxAttemptsRaw = Deno.env.get('PUSH_DISPATCH_MAX_ATTEMPTS');
  const parsedMax = Number.parseInt(maxAttemptsRaw ?? '', 10);
  const pushMaxAttempts = Number.isFinite(parsedMax) && parsedMax > 0 ? parsedMax : 10;

  const { data: pending, error: fetchErr } = await admin
    .from('notifications')
    .select('id, user_id, title, body, push_dispatch_attempts')
    .is('push_dispatched_at', null)
    .is('push_dispatch_abandoned_at', null)
    .order('created_at', { ascending: true })
    .limit(50);

  if (fetchErr) {
    return new Response(JSON.stringify({ error: fetchErr.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const rows = (pending ?? []) as NotificationRow[];
  const results: {
    id: string;
    tokens: number;
    expoOk: boolean;
    markedDispatched: boolean;
    logStatus?: string;
  }[] = [];

  const expoHeaders: Record<string, string> = {
    Accept: 'application/json',
    'Accept-encoding': 'gzip, deflate',
    'Content-Type': 'application/json',
  };
  if (expoAccessToken) {
    expoHeaders.Authorization = `Bearer ${expoAccessToken}`;
  }

  for (const n of rows) {
    const writeLog = async (args: {
      status: 'success' | 'failed';
      http_status: number | null;
      error_detail?: string | null;
      expo_ticket_sample?: unknown;
    }) => {
      const ins = await admin.from('notification_push_logs').insert({
        notification_id: n.id,
        status: args.status,
        http_status: args.http_status ?? null,
        error_detail: truncate(args.error_detail ?? null, 512),
        expo_ticket_sample: args.expo_ticket_sample ?? null,
      });
      if (ins.error) {
        console.error('notification_push_logs insert failed', ins.error.message);
      }
    };

    const { data: tokRows } = await admin.from('push_tokens').select('token').eq('user_id', n.user_id);

    const tokenList = (tokRows ?? []).map((t: { token: string }) => t.token).filter(Boolean);

    let expoOk = true;
    let lastHttp: number | null = null;
    let lastBodySnippet: string | null = null;
    let ticketSample: unknown = null;

    if (tokenList.length === 0) {
      expoOk = true;
    } else {
      const messages = tokenList.map((to: string) => ({
        to,
        title: n.title,
        body: n.body ?? '',
        sound: 'default',
        priority: 'high',
      }));

      for (const batch of chunk(messages, 90)) {
        const expoRes = await fetch(EXPO_PUSH_URL, {
          method: 'POST',
          headers: expoHeaders,
          body: JSON.stringify(batch),
        });
        lastHttp = expoRes.status;
        expoOk = expoOk && expoRes.ok;
        const bodyText = await expoRes.text();
        lastBodySnippet = truncate(bodyText, 4096);

        try {
          const parsed = JSON.parse(bodyText) as { data?: unknown[] };
          if (parsed && Array.isArray(parsed.data)) {
            ticketSample = parsed.data.slice(0, 5);
          }
        } catch {
          ticketSample = { parseError: true, snippet: truncate(bodyText, 400) };
        }

        if (!expoRes.ok) {
          try {
            console.error('Expo push HTTP error', bodyText.slice(0, 500));
          } catch {
            console.error('Expo push HTTP error', expoRes.status);
          }
        }
      }
    }

    const markedDispatched =
      tokenList.length === 0 || expoOk;

    if (markedDispatched) {
      await admin.from('notifications').update({ push_dispatched_at: new Date().toISOString() }).eq('id', n.id);

      await writeLog({
        status: 'success',
        http_status: lastHttp ?? (tokenList.length === 0 ? null : 200),
        error_detail:
          tokenList.length === 0 ? 'skipped_no_tokens' : null,
        expo_ticket_sample: ticketSample ?? null,
      });
    } else if (tokenList.length > 0) {
      const { data: prevRow } = await admin
        .from('notifications')
        .select('push_dispatch_attempts')
        .eq('id', n.id)
        .maybeSingle();
      const prevAttempts =
        typeof prevRow?.push_dispatch_attempts === 'number' ? prevRow.push_dispatch_attempts : 0;
      const nextAttempts = prevAttempts + 1;
      const exhausted = nextAttempts >= pushMaxAttempts;
      await admin
        .from('notifications')
        .update({
          push_dispatch_attempts: nextAttempts,
          push_dispatch_error: exhausted
            ? `達重試上限（${pushMaxAttempts}）；已標記放棄，請於後台 DLQ 處理`
            : 'Expo Push HTTP failure（將於下次排程重試）',
          ...(exhausted ? { push_dispatch_abandoned_at: new Date().toISOString() } : {}),
        })
        .eq('id', n.id);

      await writeLog({
        status: 'failed',
        http_status: lastHttp,
        error_detail:
          exhausted
            ? truncate(`Retry exhausted (${pushMaxAttempts})`, 512)
            : (lastBodySnippet ?? 'Expo push HTTP failure'),
        expo_ticket_sample: ticketSample ?? null,
      });
    }

    results.push({
      id: n.id,
      tokens: tokenList.length,
      expoOk,
      markedDispatched,
      logStatus: markedDispatched ? 'success' : 'failed',
    });
  }

  return new Response(
    JSON.stringify({
      ok: true,
      processed: rows.length,
      push_max_attempts: pushMaxAttempts,
      results,
    }),
    {
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      },
    },
  );
});
