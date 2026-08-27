// Warehouse-only: update an order's status. Verifies admin credentials, then updates via service role.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });
}

const ALLOWED = ["pending", "confirmed", "preparing", "shipping", "delivered", "cancelled"];

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  try {
    const body = await req.json().catch(() => null);
    if (!body) return json({ error: "invalid_body" }, 400);
    const { email, password, order_code, status } = body as Record<string, string>;
    const adminEmail = Deno.env.get("ADMIN_EMAIL");
    const adminPassword = Deno.env.get("ADMIN_PASSWORD");

    if (!adminEmail || !adminPassword || email !== adminEmail || password !== adminPassword) {
      return json({ error: "unauthorized" }, 401);
    }
    if (!order_code || !ALLOWED.includes(status)) {
      return json({ error: "invalid_input" }, 400);
    }

    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

    const { data, error } = await supabase
      .from("orders")
      .update({ order_status: status })
      .eq("order_code", order_code)
      .select()
      .single();

    if (error) return json({ error: error.message }, 500);

    // Telegram note to admin
    const TG_TOKEN = Deno.env.get("TELEGRAM_BOT_TOKEN");
    const TG_CHAT = Deno.env.get("TELEGRAM_CHAT_ID");
    if (TG_TOKEN && TG_CHAT) {
      try {
        await fetch(`https://api.telegram.org/bot${TG_TOKEN}/sendMessage`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            chat_id: TG_CHAT,
            text: `🔄 تحديث حالة الطلب\nرمز: ${order_code}\nالحالة الجديدة: ${status}`,
          }),
        });
      } catch (e) {
        console.error("telegram error", e);
      }
    }

    // Push notification to customer devices via FCM edge function
    try {
      const phone = (data as { customer_phone?: string }).customer_phone;
      if (phone) {
        await fetch(`${SUPABASE_URL}/functions/v1/send-fcm-notification`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${SERVICE_KEY}`,
          },
          body: JSON.stringify({ phone, order_code, status }),
        });
      }
    } catch (e) {
      console.error("fcm invoke error", e);
    }

    return json({ ok: true, order: data });
  } catch (err) {
    console.error("fatal", err);
    return json({ error: err instanceof Error ? err.message : String(err) }, 500);
  }
});
