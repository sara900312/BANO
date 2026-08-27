import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { Lock, LogOut, RefreshCw, Sparkles } from "lucide-react";
import {
  fetchAllOrders,
  updateOrderStatus,
  formatIQD,
  getAiProvider,
  setAiProvider,
  type OrderRow,
} from "@/lib/neomart";
import { OrderStatusBadge } from "@/components/OrderStatusBadge";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/Lewis-Ban-9003-Lewis-Ban-9003-Lewis-Ban-9003-Lewis-Ban-9003")({
  head: () => ({ meta: [{ title: "المخزن" }, { name: "robots", content: "noindex,nofollow" }] }),
  component: WarehousePage,
});

const STATUSES = ["pending", "confirmed", "preparing", "shipping", "delivered", "cancelled"] as const;
const STATUS_LABELS: Record<string, string> = {
  pending: "قيد المراجعة",
  confirmed: "مؤكّد",
  preparing: "قيد التحضير",
  shipping: "قيد التوصيل",
  delivered: "تم التسليم",
  cancelled: "ملغى",
};

interface Creds { email: string; password: string; }

function WarehousePage() {
  const [creds, setCreds] = useState<Creds | null>(null);
  if (!creds) return <LoginForm onAuth={setCreds} />;
  return <Dashboard creds={creds} onLogout={() => setCreds(null)} />;
}

function LoginForm({ onAuth }: { onAuth: (c: Creds) => void }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const navigate = useNavigate();

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setError("");
    // Validate by attempting a no-op set (calls admin-auth function)
    const res = await setAiProvider({ email, password, provider: (await getAiProvider()) });
    setBusy(false);
    if (res.error) { setError("بيانات الدخول غير صحيحة"); return; }
    onAuth({ email, password });
  }

  return (
    <div dir="rtl" className="min-h-screen flex items-center justify-center px-4">
      <form onSubmit={submit} className="w-full max-w-sm glass border border-border/50 rounded-3xl p-6 flex flex-col gap-4">
        <div className="flex flex-col items-center gap-2">
          <div className="w-14 h-14 rounded-2xl bg-primary/10 flex items-center justify-center">
            <Lock className="w-6 h-6 text-primary" />
          </div>
          <h1 className="text-lg font-bold">دخول المخزن</h1>
          <p className="text-xs text-muted-foreground">هذه الصفحة خاصة بالمشرف فقط</p>
        </div>
        <input
          type="email" placeholder="البريد الإلكتروني" value={email} onChange={(e) => setEmail(e.target.value)}
          className="bg-card border border-border/50 rounded-xl px-4 py-2.5 text-sm outline-none focus:border-primary/60" required
        />
        <input
          type="password" placeholder="كلمة المرور" value={password} onChange={(e) => setPassword(e.target.value)}
          className="bg-card border border-border/50 rounded-xl px-4 py-2.5 text-sm outline-none focus:border-primary/60" required
        />
        {error && <p className="text-xs text-destructive text-center">{error}</p>}
        <button disabled={busy} className="bg-primary text-primary-foreground rounded-xl py-2.5 text-sm font-bold disabled:opacity-60">
          {busy ? "جاري التحقق..." : "دخول"}
        </button>
        <button type="button" onClick={() => navigate({ to: "/" })} className="text-xs text-muted-foreground hover:text-foreground">
          العودة للصفحة الرئيسية
        </button>
      </form>
    </div>
  );
}

function Dashboard({ creds, onLogout }: { creds: Creds; onLogout: () => void }) {
  const qc = useQueryClient();
  const { data: orders = [], isLoading, refetch } = useQuery<OrderRow[]>({
    queryKey: ["wh-orders"],
    queryFn: fetchAllOrders,
    refetchInterval: 15_000,
  });

  const { data: provider = "lovable" } = useQuery({
    queryKey: ["ai-provider"],
    queryFn: getAiProvider,
  });

  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [search, setSearch] = useState("");

  // Realtime for admin
  useEffect(() => {
    const channel = supabase.channel("wh-orders")
      .on("postgres_changes", { event: "*", schema: "public", table: "orders" }, () => {
        qc.invalidateQueries({ queryKey: ["wh-orders"] });
      })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [qc]);

  const filtered = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return orders.filter((o) => {
      if (statusFilter !== "all" && o.order_status !== statusFilter) return false;
      if (!needle) return true;
      return (
        o.order_code.toLowerCase().includes(needle) ||
        o.customer_name.toLowerCase().includes(needle) ||
        o.customer_phone.toLowerCase().includes(needle)
      );
    });
  }, [orders, statusFilter, search]);

  async function changeStatus(order_code: string, status: string) {
    const res = await updateOrderStatus({ ...creds, order_code, status });
    if (res.error) alert("فشل تحديث الحالة: " + res.error);
    else refetch();
  }

  async function toggleProvider() {
    const next: "lovable" | "openrouter" = provider === "lovable" ? "openrouter" : "lovable";
    const res = await setAiProvider({ ...creds, provider: next });
    if (res.error) alert("فشل التبديل: " + res.error);
    else qc.invalidateQueries({ queryKey: ["ai-provider"] });
  }

  return (
    <div dir="rtl" className="min-h-screen max-w-6xl mx-auto flex flex-col">
      <header className="sticky top-0 z-10 glass border-b border-border/50 px-4 py-3 flex items-center justify-between">
        <button onClick={onLogout} className="flex items-center gap-1 text-sm text-muted-foreground hover:text-destructive">
          <LogOut className="w-4 h-4" />
          خروج
        </button>
        <h1 className="text-sm font-bold">لوحة المخزن</h1>
        <button onClick={() => refetch()} className="text-muted-foreground hover:text-foreground" aria-label="تحديث">
          <RefreshCw className="w-4 h-4" />
        </button>
      </header>

      <div className="px-4 py-4 flex flex-col gap-4">
        {/* AI provider switch */}
        <div className="glass border border-border/50 rounded-2xl p-4 flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center">
              <Sparkles className="w-5 h-5 text-primary" />
            </div>
            <div>
              <h2 className="text-sm font-bold">مزوّد الذكاء الاصطناعي</h2>
              <p className="text-xs text-muted-foreground">
                الحالي: {provider === "openrouter" ? "OpenRouter" : "Lovable AI"}
              </p>
            </div>
          </div>
          <button
            onClick={toggleProvider}
            className={`relative w-14 h-8 rounded-full transition ${provider === "openrouter" ? "bg-primary" : "bg-muted"}`}
            aria-label="تبديل مزوّد الذكاء"
          >
            <span
              className={`absolute top-1 w-6 h-6 rounded-full bg-white shadow transition-all ${
                provider === "openrouter" ? "start-1" : "end-1"
              }`}
            />
          </button>
        </div>

        {/* Filters */}
        <div className="flex flex-col sm:flex-row gap-2">
          <input
            value={search} onChange={(e) => setSearch(e.target.value)}
            placeholder="ابحث برمز الطلب، الاسم، أو الهاتف"
            className="flex-1 bg-card border border-border/50 rounded-xl px-4 py-2 text-sm outline-none focus:border-primary/60"
          />
          <select
            value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}
            className="bg-card border border-border/50 rounded-xl px-4 py-2 text-sm outline-none"
          >
            <option value="all">كل الحالات</option>
            {STATUSES.map((s) => <option key={s} value={s}>{STATUS_LABELS[s]}</option>)}
          </select>
        </div>

        {isLoading && <p className="text-sm text-muted-foreground text-center py-4">جاري التحميل...</p>}
        {!isLoading && filtered.length === 0 && (
          <p className="text-sm text-muted-foreground text-center py-8">لا توجد طلبات</p>
        )}

        <div className="flex flex-col gap-3 pb-8">
          {filtered.map((o) => (
            <div key={o.order_code} className="glass border border-border/50 rounded-2xl p-4 flex flex-col gap-3">
              <div className="flex items-center justify-between gap-2 flex-wrap">
                <div className="flex flex-col">
                  <span className="text-xs text-muted-foreground">{o.order_code}</span>
                  <span className="text-sm font-bold">{o.customer_name}</span>
                  <span className="text-xs text-muted-foreground">{o.customer_phone}</span>
                </div>
                <div className="flex flex-col items-end gap-1">
                  <OrderStatusBadge status={o.order_status} />
                  <span className="text-sm font-bold gradient-text">{formatIQD(o.total)}</span>
                </div>
              </div>
              <div className="flex flex-col gap-1 text-xs text-muted-foreground">
                <span>{new Date(o.created_at).toLocaleString("ar-IQ")}</span>
                {(o.governorate || o.area) && <span>{[o.governorate, o.area, o.landmark].filter(Boolean).join(" - ")}</span>}
                <span>{o.items?.length ?? 0} منتج</span>
              </div>
              <div className="flex items-center gap-2">
                <label className="text-xs text-muted-foreground">تغيير الحالة:</label>
                <select
                  value={o.order_status}
                  onChange={(e) => changeStatus(o.order_code, e.target.value)}
                  className="flex-1 bg-card border border-border/50 rounded-lg px-3 py-1.5 text-xs outline-none"
                >
                  {STATUSES.map((s) => <option key={s} value={s}>{STATUS_LABELS[s]}</option>)}
                </select>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
