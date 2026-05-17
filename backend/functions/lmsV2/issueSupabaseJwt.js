/**
 * issueSupabaseJwt — Firebase Callable
 * ───────────────────────────────────────────────────────────
 * 把 Firebase ID Token 換成 Supabase 可接受的 JWT。
 *
 * 流程:
 *   1. Callable 收到 idToken (或讓 callable 自帶 context.auth)
 *   2. 用 Firebase Admin SDK 驗證 idToken
 *   3. 確認 / 建立 Supabase profiles 對應列 (firebase_uid → supabase user.id)
 *   4. 用 SUPABASE_JWT_SECRET (HS256) 簽一個 access_token
 *   5. 回傳 { accessToken, refreshToken, expiresAt }
 *
 * 部署前置:
 *   - 在 firebase functions config / .env 寫入:
 *       SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, SUPABASE_JWT_SECRET
 *   - npm i jose @supabase/supabase-js (jose 已在依賴內)
 *
 * 安全:
 *   - access_token 短效 (default 1 hr)
 *   - role 固定為 "authenticated";角色決定權留給 Supabase RLS
 *   - 不簽 service_role 等高權限 token
 */

'use strict';

const { onCall, HttpsError } = require('firebase-functions/v2/https');
const { defineSecret } = require('firebase-functions/params');
const admin = require('firebase-admin');
const { SignJWT } = require('jose');

const SUPABASE_URL_SECRET = defineSecret('SUPABASE_URL');
const SUPABASE_SERVICE_ROLE_KEY_SECRET = defineSecret('SUPABASE_SERVICE_ROLE_KEY');
const SUPABASE_JWT_SECRET_SECRET = defineSecret('SUPABASE_JWT_SECRET');

const JWT_TTL_SECONDS = 60 * 60; // 1 hour

/**
 * 確保 Supabase profiles 表內存在對應該 Firebase uid 的列。
 * 若不存在,用 service_role 建立一筆 (user.id = uuid v4 / 或復用 firebase uid 雜湊)。
 */
async function ensureSupabaseUser({ supabaseUrl, serviceKey, firebaseUid, email, displayName }) {
  // 使用 supabase-js admin client
  // eslint-disable-next-line global-require
  const { createClient } = require('@supabase/supabase-js');
  const admin = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  // 1. 試著查既有 mapping
  const { data: existing, error: selErr } = await admin
    .from('profiles')
    .select('user_id')
    .eq('firebase_uid', firebaseUid)
    .maybeSingle();
  if (selErr) {
    throw new HttpsError('internal', `profile lookup failed: ${selErr.message}`);
  }
  if (existing && existing.user_id) return existing.user_id;

  // 2. 不存在 → 用 admin.auth.admin.createUser 建立
  const { data: created, error: createErr } = await admin.auth.admin.createUser({
    email: email || `${firebaseUid}@firebase.local`,
    email_confirm: true,
    user_metadata: {
      firebase_uid: firebaseUid,
      display_name: displayName || '',
      provider: 'firebase-bridge',
    },
  });
  if (createErr || !created?.user?.id) {
    // 若已存在(email collision),改查 email
    if (email) {
      const { data: list } = await admin.auth.admin.listUsers({ page: 1, perPage: 1 });
      const found = (list?.users ?? []).find(u => u.email === email);
      if (found?.id) {
        await admin.from('profiles').upsert({
          user_id: found.id,
          firebase_uid: firebaseUid,
          display_name: displayName || '',
        }, { onConflict: 'user_id' });
        return found.id;
      }
    }
    throw new HttpsError('internal', `create user failed: ${createErr?.message || 'unknown'}`);
  }

  const userId = created.user.id;
  // 3. 寫 mapping
  const { error: upsertErr } = await admin.from('profiles').upsert({
    user_id: userId,
    firebase_uid: firebaseUid,
    display_name: displayName || '',
    email: email || null,
  }, { onConflict: 'user_id' });
  if (upsertErr) {
    // 不致命 — 後續再補
    // eslint-disable-next-line no-console
    console.warn('[issueSupabaseJwt] profile upsert failed:', upsertErr.message);
  }
  return userId;
}

exports.issueSupabaseJwt = onCall(
  {
    region: 'asia-east1',
    secrets: [
      SUPABASE_URL_SECRET,
      SUPABASE_SERVICE_ROLE_KEY_SECRET,
      SUPABASE_JWT_SECRET_SECRET,
    ],
    cors: true,
  },
  async (request) => {
    if (!request.auth || !request.auth.uid) {
      throw new HttpsError('unauthenticated', 'must be signed in');
    }

    const supabaseUrl = process.env.SUPABASE_URL || SUPABASE_URL_SECRET.value();
    const serviceKey =
      process.env.SUPABASE_SERVICE_ROLE_KEY || SUPABASE_SERVICE_ROLE_KEY_SECRET.value();
    const jwtSecret =
      process.env.SUPABASE_JWT_SECRET || SUPABASE_JWT_SECRET_SECRET.value();

    if (!supabaseUrl || !serviceKey || !jwtSecret) {
      throw new HttpsError(
        'failed-precondition',
        'Supabase secrets not configured. Set SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY / SUPABASE_JWT_SECRET',
      );
    }

    if (!admin.apps.length) admin.initializeApp();
    const fbUser = await admin.auth().getUser(request.auth.uid);

    const userId = await ensureSupabaseUser({
      supabaseUrl,
      serviceKey,
      firebaseUid: fbUser.uid,
      email: fbUser.email || '',
      displayName: fbUser.displayName || '',
    });

    const nowSec = Math.floor(Date.now() / 1000);
    const expSec = nowSec + JWT_TTL_SECONDS;

    const accessToken = await new SignJWT({
      sub: userId,
      role: 'authenticated',
      aud: 'authenticated',
      email: fbUser.email || undefined,
      app_metadata: { provider: 'firebase-bridge' },
      user_metadata: {
        firebase_uid: fbUser.uid,
        display_name: fbUser.displayName || '',
      },
    })
      .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
      .setIssuedAt(nowSec)
      .setExpirationTime(expSec)
      .sign(new TextEncoder().encode(jwtSecret));

    // refresh_token 暫時用相同 token (短期方案)。
    // 長期應在 Supabase 建立 refresh token row。
    return {
      accessToken,
      refreshToken: accessToken,
      expiresAt: expSec * 1000,
      supabaseUserId: userId,
      ttl: JWT_TTL_SECONDS,
    };
  },
);
