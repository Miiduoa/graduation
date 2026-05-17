import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.8';

type UserRow = {
  email?: string;
  display_name?: string;
};

Deno.serve(async (req: Request) => {
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'POST only' }), {
      status: 405,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const secret = Deno.env.get('EXTERNAL_DIRECTORY_SECRET') ?? '';
  const bearer = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '').trim();
  if (!secret || bearer !== secret) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const url = Deno.env.get('SUPABASE_URL') ?? '';
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
  if (!url || !serviceKey) {
    return new Response(JSON.stringify({ error: 'Missing Supabase env' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  let body: { users?: UserRow[] };
  try {
    body = (await req.json()) as { users?: UserRow[] };
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const users = Array.isArray(body.users) ? body.users : [];
  const admin = createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  let invited = 0;
  let skipped = 0;
  const errors: string[] = [];

  for (const row of users) {
    const email = typeof row.email === 'string' ? row.email.trim().toLowerCase() : '';
    if (!email) {
      skipped++;
      continue;
    }

    const displayName = typeof row.display_name === 'string' ? row.display_name.trim() : undefined;

    const { error } = await admin.auth.admin.inviteUserByEmail(email, {
      data: displayName ? { display_name: displayName } : undefined,
    });

    if (error) {
      if (error.message?.includes('already registered') || error.status === 422) {
        skipped++;
      } else {
        errors.push(`${email}: ${error.message}`);
        skipped++;
      }
      continue;
    }

    invited++;
  }

  return new Response(JSON.stringify({ ok: true, invited, skipped, errors }), {
    headers: { 'Content-Type': 'application/json' },
  });
});
