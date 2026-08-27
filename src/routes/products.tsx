import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { ArrowRight, ArrowUp, Search } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { fetchAllProducts, type Product } from "@/lib/neomart";
import { useLocale } from "@/lib/i18n";
import { ProductCard } from "@/components/ProductCard";

export const Route = createFileRoute("/products")({
  head: () => ({
    meta: [
      { title: "المنتجات — NEOMART" },
      { name: "description", content: "تصفحي كل منتجات الجمال والعناية بالبشرة في NEOMART حسب الفئة." },
    ],
  }),
  component: ProductsPage,
});

const CATEGORY_LABELS: Record<string, { ar: string; en: string }> = {
  all: { ar: "الكل", en: "All" },
  beauty_tools: { ar: "أدوات التجميل", en: "Beauty tools" },
  body_care: { ar: "العناية بالجسم", en: "Body care" },
  hair_care: { ar: "العناية بالشعر", en: "Hair care" },
  makeup: { ar: "المكياج", en: "Makeup" },
  nail_care: { ar: "العناية بالأظافر", en: "Nail care" },
  skincare: { ar: "العناية بالبشرة", en: "Skincare" },
  fragrance: { ar: "العطور", en: "Fragrance" },
  men: { ar: "للرجال", en: "Men" },
  kids: { ar: "للأطفال", en: "Kids" },
};

function categoryLabel(c: string, language: "ar" | "en") {
  return CATEGORY_LABELS[c]?.[language] ?? c.replace(/_/g, " ");
}

function ProductsPage() {
  const navigate = useNavigate();
  const { language, direction, text } = useLocale();
  const [q, setQ] = useState("");
  const [cat, setCat] = useState<string>("all");
  const [showScrollTop, setShowScrollTop] = useState(false);

  useEffect(() => {
    const updateScrollTopVisibility = () => setShowScrollTop(window.scrollY > 240);
    updateScrollTopVisibility();
    window.addEventListener("scroll", updateScrollTopVisibility, { passive: true });
    return () => window.removeEventListener("scroll", updateScrollTopVisibility);
  }, []);

  const { data: products = [], isLoading } = useQuery<Product[]>({
    queryKey: ["all-products"],
    queryFn: fetchAllProducts,
    staleTime: 60_000,
  });

  const categories = useMemo(() => {
    const set = new Set<string>();
    products.forEach((p) => p.category && set.add(p.category));
    return ["all", ...Array.from(set).sort()];
  }, [products]);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return products.filter((p) => {
      if (cat !== "all" && p.category !== cat) return false;
      if (!needle) return true;
      return [
        p.name,
        p.name_en,
        p.short_description,
        p.short_description_en,
        p.category,
        p.category_en,
        p.brand,
        p.brand_en,
      ].some((value) => value?.toLowerCase().includes(needle));
    });
  }, [products, q, cat]);

  return (
    <div dir={direction} className="min-h-screen max-w-6xl mx-auto flex flex-col">
      <header className="sticky top-0 z-10 glass border-b border-border/50 px-4 py-3 flex items-center justify-between gap-3">
        <button onClick={() => navigate({ to: "/" })} className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
          <ArrowRight className="w-4 h-4 rtl:rotate-180" />
          {text("رجوع", "Back")}
        </button>
        <h1 className="text-sm font-bold">{text("كل المنتجات", "All products")}</h1>
        <div className="w-10" />
      </header>

      <div className="px-4 py-4 flex flex-col gap-4">
        <div className="flex items-center gap-2 bg-card rounded-full border border-border/50 px-4 py-2 focus-within:border-primary/60">
          <Search className="w-4 h-4 text-muted-foreground" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder={text("ابحثي عن منتج، فئة، أو ماركة...", "Search for a product, category, or brand...")}
            className="flex-1 bg-transparent outline-none text-sm py-1"
          />
        </div>

        <div className="-mx-1 flex snap-x snap-mandatory gap-2 overflow-x-auto px-1 pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {categories.map((c) => (
            <button
              key={c}
              onClick={() => setCat(c)}
              className={`shrink-0 snap-start whitespace-nowrap px-4 py-1.5 rounded-full text-xs font-bold border transition ${
                cat === c
                  ? "bg-primary text-primary-foreground border-primary"
                  : "bg-card text-muted-foreground border-border/50 hover:border-primary/40"
              }`}
            >
              {categoryLabel(c, language)}
            </button>
          ))}
        </div>

        {isLoading && <p className="text-sm text-muted-foreground text-center py-8">{text("جاري تحميل المنتجات...", "Loading products...")}</p>}
        {!isLoading && filtered.length === 0 && (
          <p className="text-sm text-muted-foreground text-center py-8">{text("لا توجد منتجات مطابقة", "No matching products")}</p>
        )}

        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3 pb-8">
          {filtered.map((p) => (
            <ProductCard key={p.id} product={p} />
          ))}
        </div>
      </div>

      {showScrollTop && (
        <button
          type="button"
          onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}
          className="fixed bottom-24 end-4 z-30 flex h-12 w-12 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-soft transition hover:opacity-90 active:scale-95"
          aria-label={text("العودة إلى أعلى المنتجات", "Back to top of products")}
        >
          <ArrowUp className="h-5 w-5" />
        </button>
      )}
    </div>
  );
}
