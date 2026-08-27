// send-fcm-notification: FCM v1 push to all devices for a phone number.
// Body: { phone, order_code, status }
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { create, getNumericDate } from "https://deno.land/x/djwt@v3.0.2/mod.ts";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...CORS, "Content-Type": "application/json" } });

const STATUS_AR: Record<string, { title: string; body: (code: string) => string }> = {
  pending:   { title: "NEOMART", body: (c) => `طلبك ${c} قيد المراجعة` },
  confirmed: { title: "NEOMART", body: (c) => `تم تأكيد طلبك ${c}` },
  preparing: { title: "NEOMART", body: (c) => `طلبك ${c} قيد التحضير` },
  shipping:  { title: "NEOMART", body: (c) => `طلبك ${c} في الطريق إليك` },
  shipped:   { title: "NEOMART", body: (c) => `طلبك ${c} في الطريق إليك` },
  delivered: { title: "NEOMART", body: (c) => `تم تسليم طلبك ${c} — شكراً لتسوّقك` },
  cancelled: { title: "NEOMART", body: (c) => `تم إلغاء طلبك ${c}` },
};

// Convert PEM PKCS#8 to CryptoKey
async function importServiceAccountKey(pem: string): Promise<CryptoKey> {
  const clean = pem.replace(/\\n/g, "\n")
    .replace(/-----BEGIN PRIVATE KEY-----/g, "")
    .replace(/-----END PRIVATE KEY-----/g, "")
    .replace(/\s+/g, "");
  const bin = Uint8Array.from(atob(clean), (c) => c.charCodeAt(0));
  return await crypto.subtle.importKey(
    "pkcs8",
    bin.buffer,
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"],
  );
}

let cachedToken: { token: string; exp: number } | null = null;

async function getAccessToken(): Promise<string> {
  if (cachedToken && cachedToken.exp - 60 > Math.floor(Date.now() / 1000)) return cachedToken.token;
  const clientEmail = Deno.env.get("FCM_CLIENT_EMAIL")!;
  const privateKey = Deno.env.get("FCM_PRIVATE_KEY")!;
  const key = await importServiceAccountKey(privateKey);
  const iat = getNumericDate(0);
  const exp = getNumericDate(60 * 60);
  const jwt = await create(
    { alg: "RS256", typ: "JWT" },
    {
      iss: clientEmail,
      scope: "https://www.googleapis.com/auth/firebase.messaging",
      aud: "https://oauth2.googleapis.com/token",
      iat,
      exp,
    },
    key,
  );
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: jwt,
    }),
  });
  if (!res.ok) throw new Error(`oauth token failed: ${res.status} ${await res.text()}`);
  const data = await res.json();
  cachedToken = { token: data.access_token, exp };
  return data.access_token;
}

async function sendOne(
  projectId: string,
  accessToken: string,
  token: string,
  title: string,
  body: string,
  data: Record<string, string>,
): Promise<{ ok: boolean; status: number; error?: string; invalidToken?: boolean }> {
  const url = `https://fcm.googleapis.com/v1/projects/${projectId}/messages:send`;
  const payload = {
    message: {
      token,
      notification: { title, body },
      data,
      android: {
        priority: "HIGH",
        notification: { click_action: "FCM_PLUGIN_ACTIVITY", channel_id: "orders" },
      },
      apns: {
        payload: { aps: { sound: "default", "content-available": 1 } },
      },
      webpush: {
        fcm_options: { link: `/orders/${data.order_code}` },
      },
    },
  };
  const res = await fetch(url, {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (res.ok) return { ok: true, status: res.status };
  const errText = await res.text();
  const invalid = res.status === 404 ||
    /UNREGISTERED|INVALID_ARGUMENT|registration-token-not-registered/i.test(errText);
  return { ok: false, status: res.status, error: errText, invalidToken: invalid };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  try {
    const { phone, order_code, status } = await req.json();
    if (!phone || !order_code || !status) return json({ error: "missing_fields" }, 400);

    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const projectId = Deno.env.get("FCM_PROJECT_ID")!;
    const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

    // Duplicate suppression via unique(order_code, status)
    const { error: logInsertErr } = await supabase
      .from("notification_logs")
      .insert({ order_code, status, phone, detail: { stage: "start" } });
    if (logInsertErr && /duplicate/i.test(logInsertErr.message)) {
      return json({ ok: true, skipped: "duplicate" });
    }

    const { data: devices, error: devErr } = await supabase
      .from("customer_devices")
      .select("id, device_token, platform")
      .eq("phone", phone);
    if (devErr) throw devErr;
    if (!devices || devices.length === 0) {
      await supabase.from("notification_logs")
        .update({ detail: { reason: "no_devices" } })
        .eq("order_code", order_code).eq("status", status);
      return json({ ok: true, sent: 0, reason: "no_devices" });
    }

    const meta = STATUS_AR[status] ?? { title: "NEOMART", body: (c: string) => `تحديث لطلبك ${c}` };
    const title = meta.title;
    const body = meta.body(order_code);
    const data = { order_code, status, screen: "/orders" };

    const accessToken = await getAccessToken();
    const invalidTokens: string[] = [];
    let success = 0;
    let failure = 0;
    const results: unknown[] = [];

    for (const d of devices) {
      let attempt = 0;
      let res = await sendOne(projectId, accessToken, d.device_token, title, body, data);
      while (!res.ok && !res.invalidToken && attempt < 2 && (res.status >= 500 || res.status === 429)) {
        attempt++;
        await new Promise((r) => setTimeout(r, 300 * attempt));
        res = await sendOne(projectId, accessToken, d.device_token, title, body, data);
      }
      if (res.ok) success++;
      else {
        failure++;
        if (res.invalidToken) invalidTokens.push(d.device_token);
      }
      results.push({ token_id: d.id, ok: res.ok, status: res.status, invalid: res.invalidToken });
    }

    if (invalidTokens.length > 0) {
      await supabase.from("customer_devices").delete().in("device_token", invalidTokens);
    }

    await supabase.from("notification_logs")
      .update({
        success_count: success,
        failure_count: failure,
        detail: { results, removed_invalid: invalidTokens.length },
      })
      .eq("order_code", order_code).eq("status", status);

    return json({ ok: true, sent: success, failed: failure, removed: invalidTokens.length });
  } catch (err) {
    console.error("send-fcm-notification error", err);
    return json({ error: err instanceof Error ? err.message : String(err) }, 500);
  }
});
