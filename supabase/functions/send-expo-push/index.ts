import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.8';

type PushPayload = {
  title: string;
  body?: string;
  /** Expo push tokens (ExponentPushToken[...]) */
  tokens: string[];
};

const EXPO_PUSH_URL = "https://exp.host/--/api/v2/push/send";

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, {
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
      },
    });
  }

  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "POST only" }), {
      status: 405,
      headers: { "Content-Type": "application/json" },
    });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  const expoAccessToken = Deno.env.get("EXPO_ACCESS_TOKEN") ?? "";

  if (!supabaseUrl || !serviceKey) {
    return new Response(JSON.stringify({ error: "Missing Supabase env" }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }

  const authHeader = req.headers.get("Authorization") ?? "";
  const jwt = authHeader.replace(/^Bearer\s+/i, "").trim();
  if (!jwt) {
    return new Response(JSON.stringify({ error: "Missing Authorization bearer JWT" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }

  const admin = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: userData, error: userErr } = await admin.auth.getUser(jwt);
  if (userErr || !userData.user) {
    return new Response(JSON.stringify({ error: "Invalid JWT" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }

  const { data: prof } = await admin.from("profiles").select("role").eq("id", userData.user.id).maybeSingle();
  if (prof?.role !== "admin") {
    return new Response(JSON.stringify({ error: "Admin only" }), {
      status: 403,
      headers: { "Content-Type": "application/json" },
    });
  }

  let payload: PushPayload;
  try {
    payload = (await req.json()) as PushPayload;
  } catch {
    return new Response(JSON.stringify({ error: "Invalid JSON" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  if (!payload.title || !Array.isArray(payload.tokens) || payload.tokens.length === 0) {
    return new Response(JSON.stringify({ error: "title + tokens[] required" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const messages = payload.tokens.map((to) => ({
    to,
    title: payload.title,
    body: payload.body ?? "",
    sound: "default",
    priority: "high",
  }));

  const headers: Record<string, string> = {
    Accept: "application/json",
    "Accept-encoding": "gzip, deflate",
    "Content-Type": "application/json",
  };
  if (expoAccessToken) {
    headers.Authorization = `Bearer ${expoAccessToken}`;
  }

  const expoRes = await fetch(EXPO_PUSH_URL, {
    method: "POST",
    headers,
    body: JSON.stringify(messages),
  });

  const expoJson = await expoRes.json();

  return new Response(JSON.stringify({ ok: expoRes.ok, expo: expoJson }), {
    status: expoRes.ok ? 200 : 502,
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
    },
  });
});
