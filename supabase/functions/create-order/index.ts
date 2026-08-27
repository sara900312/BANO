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
    if (!SUPABASE_URL || !SERVICE_KEY) return json({ error: "server_not_configured" }, 500);

    const body = await req.json().catch(() => null);
    if (!body || !body.order_code || !body.customer_name || !body.customer_phone) {
      return json({ error: "missing_required_fields" }, 400);
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
      console.error("insert error", error);
      return json({ error: error.message }, 500);
    }

    // Telegram notification (best-effort)
    const TG_TOKEN = Deno.env.get("TELEGRAM_BOT_TOKEN");
    const TG_CHAT = Deno.env.get("TELEGRAM_CHAT_ID");
    if (TG_TOKEN && TG_CHAT) {
      try {
        const fmt = (n: number) => new Intl.NumberFormat("en-US").format(n);
        const lines = (body.items ?? [])
          .map((it: { name: string; quantity: number; price: number }) =>
            `• ${it.name} ×${it.quantity} — ${fmt(it.price * it.quantity)} IQD`)
          .join("\n");
        const address = [body.governorate, body.area, body.landmark].filter(Boolean).join(" - ");
        const msg =
          `🛒 طلب جديد\n\n` +
          `رمز الطلب: ${body.order_code}\n` +
          `الاسم: ${body.customer_name}\n` +
          `الهاتف: ${body.customer_phone}\n` +
          `العنوان: ${address}\n` +
          (body.notes ? `ملاحظات: ${body.notes}\n` : "") +
          `\nالمنتجات:\n${lines}\n\n` +
          `المجموع الفرعي: ${fmt(body.subtotal ?? 0)} IQD\n` +
          `التوصيل: ${fmt(body.shipping ?? 0)} IQD\n` +
          `الإجمالي: ${fmt(body.total ?? 0)} IQD\n` +
          `الدفع: ${body.payment_method === "cod" ? "عند الاستلام" : body.payment_method}`;

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
      console.warn("telegram secrets missing; skipping notification");
    }

    return json({ ok: true, order: data });
  } catch (err) {
    console.error("fatal", err);
    return json({ error: err instanceof Error ? err.message : String(err) }, 500);
  }
});
