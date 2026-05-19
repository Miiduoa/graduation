// course-export-worker：認領 course_export_packages 任務並寫 manifest（IMSCC stub）
// 對應 migration 20260520150000；正式 IMSCC 1.3 manifest 規格實作另案，
// 本 stub 至少把 manifest summary 寫回 DB，使端到端 happy path 通。

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.8';

Deno.serve(async (req: Request) => {
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'POST only' }), {
      status: 405,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const secret = Deno.env.get('COURSE_EXPORT_WORKER_SECRET') ?? '';
  const bearer = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '').trim();
  if (!secret || bearer !== secret) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401, headers: { 'Content-Type': 'application/json' },
    });
  }

  const url = Deno.env.get('SUPABASE_URL') ?? '';
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
  if (!url || !serviceKey) {
    return new Response(JSON.stringify({ error: 'Missing env' }), { status: 500 });
  }

  const admin = createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  // 1. 認領
  const { data: job, error: cErr } = await admin.rpc('course_export_jobs_claim_next');
  if (cErr) {
    return new Response(JSON.stringify({ error: cErr.message }), { status: 500 });
  }
  if (!job) {
    return new Response(JSON.stringify({ ok: true, processed: 0 }), {
      headers: { 'Content-Type': 'application/json' },
    });
  }

  try {
    // 2. 蒐集課程內容
    const { data: course } = await admin
      .from('courses').select('id, title, description').eq('id', job.course_id).maybeSingle();

    const { data: units } = await admin
      .from('course_units').select('id, title, sort_order').eq('course_id', job.course_id);

    const { data: materials } = await admin
      .from('course_materials').select('id, title, external_url, storage_path, mime_type').eq('course_id', job.course_id);

    const { data: assignments } = await admin
      .from('assignments').select('id, title, description, due_at, max_points').eq('course_id', job.course_id);

    const { data: quizzes } = await admin
      .from('quizzes').select('id, title').eq('course_id', job.course_id);

    const summary = {
      course: course ?? null,
      counts: {
        units: units?.length ?? 0,
        materials: materials?.length ?? 0,
        assignments: assignments?.length ?? 0,
        quizzes: quizzes?.length ?? 0,
      },
      generated_at: new Date().toISOString(),
      format: job.format,
      manifest_xml_hint:
        job.format === 'imscc'
          ? 'IMS CC 1.3 imsmanifest.xml 結構：<manifest><metadata/><organizations/><resources/></manifest>'
          : null,
    };

    // 3. 寫入 Storage（bucket: course-exports；需事先建立並僅 admin 可讀）
    const storagePath = `${job.id}/${job.format}-${Date.now()}.json`;
    const { error: upErr } = await admin.storage
      .from('course-exports')
      .upload(storagePath, new Blob([JSON.stringify(summary, null, 2)], { type: 'application/json' }), {
        contentType: 'application/json', upsert: true,
      });
    if (upErr) throw upErr;

    // 4. 標完成
    const { error: doneErr } = await admin.rpc('course_export_jobs_complete', {
      p_id: job.id, p_status: 'ready',
      p_storage_path: `course-exports/${storagePath}`,
      p_manifest: summary, p_error: null,
    });
    if (doneErr) throw doneErr;

    return new Response(JSON.stringify({ ok: true, job_id: job.id, format: job.format }), {
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (e) {
    await admin.rpc('course_export_jobs_complete', {
      p_id: job.id, p_status: 'failed', p_storage_path: null,
      p_manifest: null, p_error: (e as Error)?.message ?? 'unknown',
    });
    return new Response(JSON.stringify({ error: (e as Error)?.message ?? 'unknown' }), {
      status: 500, headers: { 'Content-Type': 'application/json' },
    });
  }
});
