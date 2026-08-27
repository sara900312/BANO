// Deploy to Supabase project emobathinfpylwjdcfbo as function name: create-order.
// Secrets to set (Project Settings → Edge Functions → Secrets):
//   TELEGRAM_BOT_TOKEN
//   TELEGRAM_CHAT_ID
// SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are injected automatically.

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

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  try {
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
    const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!SUPABASE_URL || !SERVICE_KEY) {
      return json({ error: "Server not configured (missing Supabase env)" }, 500);
    }

    const body = await req.json().catch(() => null);
    if (!body || !body.order_code || !body.customer_name || !body.customer_phone) {
      return json({ error: "Missing required order fields" }, 400);
    }

    const supabase = createClient(SUPABASE_URL, SERVICE_KEY);
    const { data, error } = await supabase
      .from("orders")
      .insert({
        order_code: body.order_code,
        customer_name: body.customer_name,
        customer_phone: body.customer_phone,
        governorate: body.governorate ?? null,
        area: body.area ?? null,
        landmark: body.landmark ?? null,
        notes: body.notes ?? null,
        items: body.items ?? [],
        subtotal: body.subtotal ?? 0,
        shipping: body.shipping ?? 0,
        total: body.total ?? 0,
        payment_method: body.payment_method ?? "cod",
        order_status: "pending",
      })
      .select()
      .single();

    if (error) {
      console.error("orders insert error", error);
      return json({ error: error.message }, 500);
    }

    // Telegram notification (fire-and-forget; never blocks order success)
    const TG_TOKEN = Deno.env.get("TELEGRAM_BOT_TOKEN");
    const TG_CHAT = Deno.env.get("TELEGRAM_CHAT_ID");
    if (TG_TOKEN && TG_CHAT) {
      const fmt = (n: number) => new Intl.NumberFormat("en-US").format(n);
      const lines = (body.items ?? []).map((it: { name: string; quantity: number }) =>
        `• ${it.name} ×${it.quantity}`,
      ).join("\n");
      const now = new Date();
      const dd = String(now.getUTCDate()).padStart(2, "0");
      const mm = String(now.getUTCMonth() + 1).padStart(2, "0");
      const yyyy = now.getUTCFullYear();
      const hh = String(now.getUTCHours()).padStart(2, "0");
      const mi = String(now.getUTCMinutes()).padStart(2, "0");
      const msg =
        `🛒 New Order\n\n` +
        `Order Code: ${body.order_code}\n` +
        `Customer: ${body.customer_name}\n` +
        `Phone: ${body.customer_phone}\n` +
        `Address: ${[body.governorate, body.area, body.landmark].filter(Boolean).join(" - ")}\n` +
        (body.notes ? `Notes: ${body.notes}\n` : "") +
        `\nProducts:\n${lines}\n\n` +
        `Subtotal: ${fmt(body.subtotal ?? 0)} IQD\n` +
        `Shipping: ${fmt(body.shipping ?? 0)} IQD\n` +
        `Total: ${fmt(body.total ?? 0)} IQD\n` +
        `Payment: ${body.payment_method === "cod" ? "Cash On Delivery" : body.payment_method}\n` +
        `Date: ${dd}/${mm}/${yyyy}\nTime: ${hh}:${mi}`;

      try {
        const tgRes = await fetch(`https://api.telegram.org/bot${TG_TOKEN}/sendMessage`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ chat_id: TG_CHAT, text: msg }),
        });
        if (!tgRes.ok) console.error("telegram failed", tgRes.status, await tgRes.text());
      } catch (e) {
        console.error("telegram error", e);
      }
    } else {
      console.warn("Telegram secrets not set; skipping notification.");
    }

    return json({ ok: true, order: data });
  } catch (err) {
    console.error("create-order fatal", err);
    return json({ error: err instanceof Error ? err.message : String(err) }, 500);
  }
});
