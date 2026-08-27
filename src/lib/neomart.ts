import { createClient } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";

let legacyProductsClient: ReturnType<typeof createClient> | undefined;

function getLegacyProductsClient() {
  if (!legacyProductsClient) {
    const url = import.meta.env.VITE_LEGACY_SUPABASE_URL;
    const key = import.meta.env.VITE_LEGACY_SUPABASE_ANON_KEY;
    if (!url || !key) throw new Error("Missing legacy products Supabase environment variables.");
    legacyProductsClient = createClient(url, key);
  }
  return legacyProductsClient;
}

export interface Product {
  id: number;
  name: string;
  name_en?: string;
  short_description?: string;
  short_description_en?: string;
  description?: string;
  description_en?: string;
  ingredients?: string;
  ingredients_en?: string;
  usage?: string;
  usage_en?: string;
  benefits?: string;
  benefits_en?: string;
  warnings?: string;
  warnings_en?: string;
  brand_en?: string;
  category_en?: string;
  price: number;
  discounted_price?: number;
  is_discounted?: boolean;
  discount_percent?: number;
  main_image_url?: string;
  images?: string[];
  category?: string;
  brand?: string;
  tags?: string[];
  stock?: number;
  rating?: number;
  skin_problems?: string[];
  routine_type?: string;
}

export function productName(product: Product, language: "ar" | "en") {
  return language === "en" ? product.name_en?.trim() || product.name : product.name;
}

export function productShortDescription(product: Product, language: "ar" | "en") {
  return language === "en"
    ? product.short_description_en?.trim() || product.short_description
    : product.short_description;
}

export function productDescription(product: Product, language: "ar" | "en") {
  return language === "en"
    ? product.description_en?.trim() || product.description
    : product.description;
}

export function productField(
  product: Product,
  field: "ingredients" | "usage" | "benefits" | "warnings",
  language: "ar" | "en",
) {
  if (language === "en") {
    return (product[`${field}_en` as keyof Product] as string | undefined) || product[field];
  }
  return product[field];
}

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

export interface ChatResponse {
  reply: string;
  products?: Product[];
}

export async function askNeomart(messages: ChatMessage[]): Promise<ChatResponse> {
  // Route through the application Edge Function using the configured provider setting.
  const { data, error } = await supabase.functions.invoke("neo-chat", { body: { messages } });
  if (error) throw new Error(error.message);
  if (!data) throw new Error("empty_response");
  return data as ChatResponse;
}

export async function fetchAllProducts(): Promise<Product[]> {
  const { data, error } = await getLegacyProductsClient()
    .from("products")
    .select("*")
    .order("id", { ascending: true })
    .limit(500);
  if (error) return [];
  return (data ?? []) as Product[];
}

export async function updateOrderStatus(params: {
  email: string;
  password: string;
  order_code: string;
  status: string;
}): Promise<{ ok?: boolean; error?: string }> {
  const { data, error } = await supabase.functions.invoke("update-order-status", { body: params });
  if (error) return { error: error.message };
  return data as { ok?: boolean; error?: string };
}

export async function fetchAllOrders(): Promise<OrderRow[]> {
  const { data, error } = await supabase
    .from("orders")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(500);
  if (error) return [];
  return (data ?? []) as unknown as OrderRow[];
}

export async function getAiProvider(): Promise<"lovable" | "openrouter"> {
  const { data } = await supabase
    .from("app_settings")
    .select("value")
    .eq("key", "ai_provider")
    .maybeSingle();
  return data?.value === "openrouter" ? "openrouter" : "lovable";
}

export async function setAiProvider(params: {
  email: string;
  password: string;
  provider: "lovable" | "openrouter";
}) {
  const { data, error } = await supabase.functions.invoke("set-ai-provider", { body: params });
  if (error) return { error: error.message };
  return data as { ok?: boolean; provider?: string; error?: string };
}

export async function fetchProduct(id: number | string): Promise<Product | null> {
  const { data, error } = await getLegacyProductsClient()
    .from("products")
    .select("*")
    .eq("id", String(id))
    .maybeSingle();
  if (error) throw error;
  return data as Product | null;
}

export interface OrderItem {
  product_id: number;
  name: string;
  name_en?: string;
  price: number;
  quantity: number;
  image?: string;
  short_description?: string;
  short_description_en?: string;
  description?: string;
  description_en?: string;
}

export interface OrderPayload {
  order_code: string;
  customer_name: string;
  customer_phone: string;
  governorate: string;
  area: string;
  landmark?: string;
  notes?: string;
  items: OrderItem[];
  subtotal: number;
  shipping: number;
  total: number;
  payment_method: string;
}

export async function createOrder(
  payload: OrderPayload,
): Promise<{ ok: boolean; order_code: string; via: "edge" }> {
  const { data, error } = await supabase.functions.invoke("create-order", { body: payload });
  if (error || !data?.ok) throw new Error(error?.message || data?.error || "تعذّر إرسال الطلب");
  return { ok: true, order_code: payload.order_code, via: "edge" };
}

export interface OrderRow {
  order_code: string;
  customer_name: string;
  customer_phone: string;
  governorate?: string;
  area?: string;
  landmark?: string;
  notes?: string;
  items: OrderItem[];
  subtotal: number;
  shipping: number;
  total: number;
  payment_method: string;
  order_status: string;
  created_at: string;
}

function normalizeOrderItems(value: unknown): OrderItem[] {
  if (Array.isArray(value)) return value as OrderItem[];
  if (typeof value !== "string") return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? (parsed as OrderItem[]) : [];
  } catch {
    return [];
  }
}

function normalizeOrder(row: unknown): OrderRow {
  const order = row as OrderRow & { items?: unknown };
  return { ...order, items: normalizeOrderItems(order.items) };
}

export async function listOrdersByPhone(phone: string, orderCode: string): Promise<OrderRow[]> {
  const { data, error } = await supabase.rpc("get_order_by_code_and_phone", {
    p_order_code: orderCode,
    p_customer_phone: phone,
  });
  if (error) return [];
  return (data ?? []).map(normalizeOrder);
}

export async function fetchOrder(orderCode: string): Promise<OrderRow | null> {
  const { data, error } = await supabase
    .from("orders")
    .select("*")
    .eq("order_code", orderCode)
    .maybeSingle();
  if (error) return null;
  return data ? normalizeOrder(data) : null;
}

export function formatIQD(n: number, language: "ar" | "en" = "ar"): string {
  return language === "en"
    ? `${new Intl.NumberFormat("en-IQ").format(n)} IQD`
    : `${new Intl.NumberFormat("ar-IQ").format(n)} د.ع`;
}

// 5-character alphanumeric code (uppercase, unambiguous)
export function generateOrderCode(): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let out = "";
  for (let i = 0; i < 5; i++) out += alphabet[Math.floor(Math.random() * alphabet.length)];
  return out;
}
