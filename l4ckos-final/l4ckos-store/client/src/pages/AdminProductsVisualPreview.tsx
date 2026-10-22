import { useEffect, useMemo, useRef, useState } from "react";
import { PRODUCT_CATEGORIES, getCategoryLabel } from "../lib/productCategories";
import { useIsMobile } from "../hooks/useIsMobile";
import { AdminSidebarProfile } from "../components/admin/AdminSidebarProfile";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../components/ui/select";
import "../components/admin/AdminOrdersVisualPreview.css";
import "../components/admin/AdminProductsVisualPreview.css";

type Variant = { name: string; sku: string; price: string; stock: string; color?: string; size?: string };
type PreviewImage = { id: string; src: string; name: string; color: string | null; alt?: string; imageThumbnailUrl?: string | null; imageDetailUrl?: string | null; imageBannerUrl?: string | null };
type Product = { id: number; name: string; category: string; price: number; stock: number; image?: string; images?: PreviewImage[]; colors: string[]; sizes: string[]; variants: Variant[]; description: string; updated: string };
type Mode = "list" | "create" | "edit";
type Filter = "all" | "withStock" | "outOfStock" | "lowStock" | "withoutImage" | "withVariants";
type Draft = { name: string; category: string; price: string; stock: string; colors: string; sizes: string; sizeType: string; imageUrl: string; variants: Variant[]; description: string };
type QuickEdit = { id: number; field: "price" | "stock"; value: string; variants: string[] };

const seedProducts: Product[] = [
  { id: 128, name: "Camiseta L4CKOS — Essential", category: "camisas", price: 8990, stock: 18, image: "/images/camisa.png", colors: ["Preto", "Branco"], sizes: ["P", "M", "G", "GG"], variants: [{ name: "Essential Preto P", sku: "ESS-PT-P", price: "89.90", stock: "4" }, { name: "Essential Preto M", sku: "ESS-PT-M", price: "89.90", stock: "6" }, { name: "Essential Branco M", sku: "ESS-BR-M", price: "89.90", stock: "5" }, { name: "Essential Branco G", sku: "ESS-BR-G", price: "89.90", stock: "3" }], description: "Camiseta de algodão para uso diário.", updated: "18 out, 2026" },
  { id: 127, name: "Camiseta Clã 14 Bis", category: "camisas", price: 9990, stock: 4, image: "/images/hero/camiseta-cla-14-bis-recorte.png", colors: ["Preto"], sizes: ["P", "M", "G"], variants: [{ name: "Clã 14 Bis P", sku: "14B-PT-P", price: "99.90", stock: "1" }, { name: "Clã 14 Bis M", sku: "14B-PT-M", price: "99.90", stock: "2" }, { name: "Clã 14 Bis G", sku: "14B-PT-G", price: "99.90", stock: "1" }], description: "Edição Clã 14 Bis.", updated: "17 out, 2026" },
  { id: 126, name: "Shoulder bag L4CKOS", category: "acessorios", price: 15990, stock: 0, colors: ["Preto"], sizes: [], variants: [{ name: "Shoulder bag Preto", sku: "SB-PT", price: "159.90", stock: "0" }], description: "", updated: "15 out, 2026" },
  { id: 125, name: "Moletom L4CKOS — Static", category: "uniformes", price: 18990, stock: 12, image: "/images/camisa.png", colors: ["Preto", "Cinza"], sizes: ["M", "G", "GG"], variants: [{ name: "Static Preto M", sku: "ST-PT-M", price: "189.90", stock: "5" }, { name: "Static Preto G", sku: "ST-PT-G", price: "189.90", stock: "4" }, { name: "Static Cinza G", sku: "ST-CZ-G", price: "189.90", stock: "3" }], description: "Moletom de peso médio.", updated: "12 out, 2026" },
  { id: 124, name: "Insígnia L4CKOS", category: "insignias", price: 2490, stock: 32, colors: [], sizes: [], variants: [], description: "", updated: "10 out, 2026" },
];

const filters: Array<{ key: Filter; label: string }> = [
  { key: "all", label: "Todos os produtos" }, { key: "withStock", label: "Com estoque" },
  { key: "outOfStock", label: "Sem estoque" }, { key: "lowStock", label: "Estoque baixo" },
  { key: "withoutImage", label: "Sem imagem" }, { key: "withVariants", label: "Com variantes" },
];
const colorSwatches: Record<string, string> = {
  preto: "#080808", branco: "#f3f3f3", "off-white": "#e8e4da", verde: "#39734d",
  azul: "#35618e", cinza: "#858585", caqui: "#a39468",
  vermelho: "#e8002a", vinho: "#702938", bege: "#c4b99c", marrom: "#654a3b",
  amarelo: "#e2bd3f", rosa: "#d97891", "rosa-bebe": "#efa8b8", roxo: "#76509a", laranja: "#de7b32",
  lilas: "#a987c4", lavanda: "#a987c4", violeta: "#76509a", magenta: "#c13d85",
  turquesa: "#35a6a0", agua: "#66b8b0", "verde-agua": "#43a8a2", esmeralda: "#087443", "verde-escuro": "#28583c", "verde-claro": "#79a86b",
  "azul-marinho": "#182e4d", "azul-royal": "#315db0", "azul-claro": "#76a9d6", "azul-petroleo": "#276a70",
  "cinza-claro": "#b9b9b9", "cinza-escuro": "#4c4c4c", mostarda: "#c39b28", coral: "#dc786b",
  nude: "#c9a98e", terracota: "#b85f46", areia: "#bca982", dourado: "#b79542", prata: "#aeb4ba",
  creme: "#e9ddbf", gelo: "#dfe5e8", "verde-oliva": "#697344", "verde-musgo": "#526345",
};
const normalizeColorName = (value: string) => value.trim().toLocaleLowerCase("pt-BR").normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/\s+/g, "-");
const splitUniqueValues = (value: string) => {
  const seen = new Set<string>();
  return value.split(",").map(item => item.trim()).filter(item => {
    const key = normalizeColorName(item);
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
};
const recognizedColorHex = (name: string) => colorSwatches[normalizeColorName(name)] ?? null;
const uniqueColorNames = (values: string[]) => {
  const seen = new Set<string>();
  return values.map(value => value.trim()).filter(value => {
    const key = normalizeColorName(value);
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
};
const sizeSuggestions = { alpha: ["PP", "P", "M", "G", "GG", "XG"], numeric: ["36", "38", "40", "42", "44", "46"], custom: [] as string[] };
const navigation = [
  { group: "Visão geral", items: ["Dashboard / KPIs"] },
  { group: "Operação", items: ["Pedidos", "Produtos", "Clientes", "Lotes / Pré-venda"] },
  { group: "Comercial", items: ["Promoções", "Cupons", "Avaliações"] },
  { group: "Sistema", items: ["Relatórios", "Auditoria", "Backup", "Configurações"] },
];
const money = (cents: number) => new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(cents / 100);
const blankDraft = (): Draft => ({ name: "", category: "", price: "", stock: "0", colors: "", sizes: "", sizeType: "alpha", imageUrl: "", variants: [], description: "" });
const variantOptionKey = (color: string, size: string) => `${normalizeColorName(color)}|${size.trim().toLocaleLowerCase("pt-BR")}`;
const inferVariantOptions = (variant: Variant, colors: string[], sizes: string[]): Variant => {
  const name = normalizeColorName(variant.name);
  const found = colors.flatMap(color => sizes.map(size => ({ color, size, suffix: `${normalizeColorName(color)}-${normalizeColorName(size)}` })))
    .sort((left, right) => right.suffix.length - left.suffix.length)
    .find(option => name.endsWith(option.suffix));
  if (found) return { ...variant, color: found.color, size: found.size };
  const colorOnly = [...colors].sort((left, right) => right.length - left.length).find(color => name.endsWith(normalizeColorName(color)));
  if (colorOnly) return { ...variant, color: colorOnly, size: "" };
  const sizeOnly = [...sizes].sort((left, right) => right.length - left.length).find(size => name.endsWith(normalizeColorName(size)));
  return sizeOnly ? { ...variant, color: "", size: sizeOnly } : { ...variant, color: "", size: "" };
};
const isImageSource = (value: string) => value.startsWith("/images/") || /^https?:\/\//i.test(value) || /^blob:/i.test(value);
const imageNameFromSource = (src: string) => src.split(/[/?#]/).filter(Boolean).at(-1) || "Imagem do produto";
function toggleDraftValue<K extends "colors" | "sizes">(draft: Draft, field: K, value: string, change: <T extends keyof Draft>(key: T, value: Draft[T]) => void) {
  const current = uniqueColorNames(draft[field].split(","));
  const key = normalizeColorName(value);
  const selected = current.some(item => normalizeColorName(item) === key);
  change(field, (selected ? current.filter(item => normalizeColorName(item) !== key) : [...current, value]).join(", "));
}
const readMoney = (value: string) => {
  const raw = value.trim().replace(/[^\d.,-]/g, "");
  if (!raw) return NaN;
  const normalized = raw.includes(",") && raw.includes(".") ? raw.replace(/\./g, "").replace(",", ".") : raw.replace(",", ".");
  return Number(normalized);
};
const getCounts = (products: Product[]) => ({
  all: products.length,
  withStock: products.filter(product => product.stock > 0).length,
  outOfStock: products.filter(product => product.stock === 0).length,
  lowStock: products.filter(product => product.stock > 0 && product.stock <= 5).length,
  withoutImage: products.filter(product => !product.image).length,
  withVariants: products.filter(product => product.variants.length > 0).length,
});
const matchesFilter = (product: Product, filter: Filter) => {
  if (filter === "all") return true;
  if (filter === "withStock") return product.stock > 0;
  if (filter === "outOfStock") return product.stock === 0;
  if (filter === "lowStock") return product.stock > 0 && product.stock <= 5;
  if (filter === "withoutImage") return !product.image;
  return product.variants.length > 0;
};

export default function AdminProductsVisualPreview() {
  const [products, setProducts] = useState(seedProducts);
  const [mode, setMode] = useState<Mode>("list");
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [draft, setDraft] = useState<Draft>(blankDraft);
  const [variantArchive, setVariantArchive] = useState<Variant[]>([]);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [menuOpen, setMenuOpen] = useState(false);
  const [toast, setToast] = useState("");
  const [quickEdit, setQuickEdit] = useState<QuickEdit | null>(null);
  const [localImage, setLocalImage] = useState("");
  const [galleryImages, setGalleryImages] = useState<PreviewImage[]>([]);
  const [galleryUrlInput, setGalleryUrlInput] = useState("");
  const objectUrls = useRef<string[]>([]);
  const menuRef = useRef<HTMLElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const listRef = useRef<HTMLElement>(null);
  const mobile = useIsMobile(900);
  const selected = products.find(product => product.id === selectedId) ?? null;
  const counts = useMemo(() => getCounts(products), [products]);
  const filteredProducts = useMemo(() => products.filter(product => {
    const needle = search.trim().toLocaleLowerCase("pt-BR");
    const textMatches = !needle || [product.name, getCategoryLabel(product.category), String(product.id)].some(value => value.toLocaleLowerCase("pt-BR").includes(needle));
    return textMatches && matchesFilter(product, filter);
  }), [filter, products, search]);

  useEffect(() => {
    if (!menuOpen || !mobile) return;
    const oldOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    menuRef.current?.querySelector<HTMLButtonElement>("button[aria-current=page]")?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") { setMenuOpen(false); triggerRef.current?.focus(); }
      if (event.key === "Tab" && menuRef.current) {
        const items = Array.from(menuRef.current.querySelectorAll<HTMLElement>("button:not(:disabled)"));
        if (event.shiftKey && document.activeElement === items[0]) { event.preventDefault(); items.at(-1)?.focus(); }
        if (!event.shiftKey && document.activeElement === items.at(-1)) { event.preventDefault(); items[0]?.focus(); }
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => { document.body.style.overflow = oldOverflow; document.removeEventListener("keydown", onKeyDown); };
  }, [menuOpen, mobile]);

  useEffect(() => () => { objectUrls.current.forEach(URL.revokeObjectURL); }, []);

  const showMessage = (message: string) => { setToast(message); window.setTimeout(() => setToast(""), 2400); };
  const changeDraft = <K extends keyof Draft>(field: K, value: Draft[K]) => setDraft(previous => ({ ...previous, [field]: value }));
  const clearLocalImages = () => { objectUrls.current.forEach(URL.revokeObjectURL); objectUrls.current = []; setLocalImage(""); setGalleryImages([]); };
  const openCreate = () => { clearLocalImages(); setDraft(blankDraft()); setVariantArchive([]); setSelectedId(null); setMode("create"); };
  const openEdit = (product: Product) => {
    clearLocalImages(); setSelectedId(product.id); setMode("edit");
    setVariantArchive([]);
    const colors = [...product.colors];
    const sizes = [...product.sizes];
    setGalleryImages((product.images ?? []).map((image, index) => ({ ...image, id: image.id || `${product.id}-image-${index}` })));
    setGalleryUrlInput("");
    setDraft({ name: product.name, category: product.category, price: (product.price / 100).toFixed(2), stock: String(product.stock), colors: colors.join(", "), sizes: sizes.join(", "), sizeType: "alpha", imageUrl: product.image ?? "", variants: product.variants.map(variant => inferVariantOptions(variant, colors, sizes)), description: product.description });
  };
  const openQuickEdit = (product: Product, field: QuickEdit["field"]) => setQuickEdit({ id: product.id, field, value: field === "price" ? (product.price / 100).toFixed(2) : String(product.stock), variants: product.variants.map(variant => variant.stock) });
  const saveQuickEdit = () => {
    if (!quickEdit) return;
    const current = products.find(product => product.id === quickEdit.id);
    if (!current) return;
    if (quickEdit.field === "price") {
      const amount = readMoney(quickEdit.value);
      if (!Number.isFinite(amount) || amount < 0) { showMessage("Informe um preço válido, igual ou maior que zero"); return; }
      setProducts(previous => previous.map(product => product.id === current.id ? { ...product, price: Math.round(amount * 100), updated: "agora" } : product));
    } else {
      if (current.variants.length) {
        const quantities = quickEdit.variants.map(value => Number(value));
        if (quantities.some(value => !Number.isInteger(value) || value < 0)) { showMessage("Cada estoque de variante precisa ser um inteiro igual ou maior que zero"); return; }
        const updatedVariants = current.variants.map((variant, index) => ({ ...variant, stock: String(quantities[index] ?? 0) }));
        setProducts(previous => previous.map(product => product.id === current.id ? { ...product, variants: updatedVariants, stock: quantities.reduce((sum, value) => sum + value, 0), updated: "agora" } : product));
      } else {
        const quantity = Number(quickEdit.value);
        if (!Number.isInteger(quantity) || quantity < 0) { showMessage("O estoque precisa ser um inteiro igual ou maior que zero"); return; }
        setProducts(previous => previous.map(product => product.id === current.id ? { ...product, stock: quantity, updated: "agora" } : product));
      }
    }
    setQuickEdit(null);
    showMessage("Alteração demonstrativa aplicada somente nesta prévia");
  };
  const generateVariants = () => {
    const name = draft.name.trim() || "Produto";
    const colorList = splitUniqueValues(draft.colors);
    const sizeList = splitUniqueValues(draft.sizes);
    const combinations = colorList.length && sizeList.length
      ? colorList.flatMap(color => sizeList.map(size => ({ color, size })))
      : sizeList.length ? sizeList.map(size => ({ color: "", size }))
        : colorList.map(color => ({ color, size: "" }));
    const availableByKey = new Map<string, Variant>();
    const unclassified: Variant[] = [];
    [...draft.variants, ...variantArchive].forEach(variant => {
      if (!variant.color && !variant.size) { unclassified.push(variant); return; }
      const key = variantOptionKey(variant.color ?? "", variant.size ?? "");
      if (!availableByKey.has(key)) availableByKey.set(key, variant);
      else unclassified.push(variant);
    });
    const generated = combinations.map(({ color, size }) => {
      const key = variantOptionKey(color, size);
      const preserved = availableByKey.get(key);
      availableByKey.delete(key);
      const variantName = [name, color, size].filter(Boolean).join(" ");
      const fallbackSku = [color, size].filter(Boolean).join("-").toUpperCase();
      return { name: variantName, sku: preserved?.sku ?? fallbackSku, price: preserved?.price ?? draft.price ?? "0", stock: preserved?.stock ?? "0", color, size };
    });
    setVariantArchive([...unclassified, ...availableByKey.values()]);
    changeDraft("variants", generated);
    showMessage("Combinações atualizadas; dados existentes foram preservados e novas linhas começam com estoque zero");
  };
  const selectImageFiles = (files: FileList | null, gallery = false) => {
    if (!files) return;
    const allFiles = Array.from(files);
    const selectedFiles = gallery ? allFiles : allFiles.slice(0, 1);
    selectedFiles.forEach(file => {
      const url = URL.createObjectURL(file);
      objectUrls.current.push(url);
      if (gallery) setGalleryImages(previous => [...previous, { id: url, src: url, name: file.name, color: null }]);
      else {
        const currentCover = localImage || (isImageSource(draft.imageUrl) ? draft.imageUrl : "");
        if (currentCover && !galleryImages.some(image => image.src === currentCover)) {
          setGalleryImages(previous => previous.some(image => image.src === currentCover) ? previous : [...previous, { id: `cover-${Date.now()}`, src: currentCover, name: imageNameFromSource(draft.imageUrl.replace(/^Arquivo local:\s*/, "")), color: null }]);
        }
        setLocalImage(url);
        changeDraft("imageUrl", `Arquivo local: ${file.name}`);
      }
    });
  };
  const setGalleryImageAsCover = (imageId: string) => {
    const selectedImage = galleryImages.find(image => image.id === imageId);
    if (!selectedImage || selectedImage.color) return;
    const currentCover = localImage || (isImageSource(draft.imageUrl) ? draft.imageUrl : "");
    const nextImages = galleryImages.filter(image => image.id !== imageId);
    if (currentCover && currentCover !== selectedImage.src && !nextImages.some(image => image.src === currentCover)) {
      nextImages.splice(galleryImages.findIndex(image => image.id === imageId), 0, { id: `cover-${Date.now()}`, src: currentCover, name: imageNameFromSource(draft.imageUrl.replace(/^Arquivo local:\s*/, "")), color: null });
    }
    setGalleryImages(nextImages);
    if (selectedImage.src.startsWith("blob:")) {
      setLocalImage(selectedImage.src);
      changeDraft("imageUrl", `Arquivo local: ${selectedImage.name}`);
    } else {
      setLocalImage("");
      changeDraft("imageUrl", selectedImage.src);
    }
  };
  const reorderGalleryImage = (imageId: string, direction: -1 | 1) => {
    const currentIndex = galleryImages.findIndex(image => image.id === imageId);
    if (currentIndex < 0) return;
    const current = galleryImages[currentIndex];
    const group = galleryImages.map((image, index) => ({ image, index })).filter(({ image }) => normalizeColorName(image.color ?? "") === normalizeColorName(current.color ?? ""));
    const position = group.findIndex(({ index }) => index === currentIndex);
    const target = group[position + direction];
    if (!target) return;
    const next = [...galleryImages];
    [next[currentIndex], next[target.index]] = [next[target.index], next[currentIndex]];
    setGalleryImages(next);
  };
  const addGalleryUrls = () => {
    const coverSource = localImage || (isImageSource(draft.imageUrl) ? draft.imageUrl : "");
    const candidates = galleryUrlInput.split(/[\n,]+/).map(value => value.trim()).filter(value => isImageSource(value) && value !== coverSource);
    if (!candidates.length) { showMessage("Informe uma URL de imagem válida"); return; }
    setGalleryImages(previous => {
      const known = new Set(previous.map(image => image.src));
      return [...previous, ...candidates.filter(src => !known.has(src)).map(src => ({ id: `url-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, src, name: imageNameFromSource(src), color: null }))];
    });
    setGalleryUrlInput("");
  };
  const removeGalleryImage = (imageId: string) => setGalleryImages(previous => previous.filter(image => image.id !== imageId));
  const changeCoverUrl = (value: string) => {
    if (localImage && !galleryImages.some(image => image.src === localImage)) {
      setGalleryImages(previous => [...previous, { id: localImage, src: localImage, name: imageNameFromSource(draft.imageUrl.replace(/^Arquivo local:\s*/, "")), color: null }]);
    }
    setLocalImage("");
    changeDraft("imageUrl", value);
  };
  const filterTo = (next: Filter) => {
    setFilter(next);
    window.requestAnimationFrame(() => listRef.current?.scrollIntoView({ behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "start" }));
  };

  return <div className="l4-admin-preview l4-orders-preview l4-products-preview">
    {menuOpen && mobile ? <button className="orders-menu-backdrop" type="button" aria-label="Fechar navegação" onClick={() => { setMenuOpen(false); triggerRef.current?.focus(); }} /> : null}
    <aside className={`orders-sidebar${menuOpen ? " is-open" : ""}`} id="products-preview-navigation" ref={menuRef} aria-label="Navegação administrativa" inert={mobile && !menuOpen}>
      <div className="l4-admin-brand"><strong>L4CKOS</strong><span>GESTÃO</span><small>PRÉVIA VISUAL</small></div>
      <button type="button" className="orders-menu-close" onClick={() => { setMenuOpen(false); triggerRef.current?.focus(); }}>Fechar menu</button>
      <nav className="orders-nav-scroll" aria-label="Seções da gestão">{navigation.map(group => <div className="orders-nav-group" key={group.group}><h2>{group.group}</h2>{group.items.map(item => item === "Produtos" ? <button key={item} type="button" aria-current="page">{item}</button> : <span className="orders-nav-inactive" key={item}>{item}</span>)}</div>)}</nav>
      <AdminSidebarProfile name="Luna Administradora" email="admin.demo@example.test" preview />
    </aside>
    <main className="orders-main-column">
      <button ref={triggerRef} type="button" className="orders-mobile-menu-trigger" aria-expanded={menuOpen} aria-controls="products-preview-navigation" onClick={() => setMenuOpen(true)}>☰ <span>Menu administrativo</span></button>
      <div className="orders-preview-banner"><span><strong>L4CKOS / GESTÃO</strong><span className="orders-preview-divider">/</span> Prévia de Produtos e Estoque</span><span className="orders-preview-fake-label">AMBIENTE LOCAL · DADOS FICTÍCIOS</span></div>
      <div className="orders-preview-heading products-heading"><div><p className="orders-preview-eyebrow">Operação · Catálogo</p><h1>{mode === "create" ? "Novo produto" : mode === "edit" ? "Editar produto" : "Produtos e estoque"}</h1></div>{mode === "list" ? <button className="products-primary" type="button" onClick={openCreate}>Novo produto</button> : <button className="products-secondary" type="button" onClick={() => { clearLocalImages(); setMode("list"); }}>Voltar à lista</button>}</div>

      {mode === "list" ? <>
        <section className="products-metrics" aria-label="Filtros rápidos do catálogo" role="group">
          {filters.map(item => <button type="button" key={item.key} data-filter={item.key} aria-pressed={filter === item.key} onClick={() => filterTo(item.key)} className={`products-metric${filter === item.key ? " is-active" : ""}`}><strong>{counts[item.key]}</strong><span>{item.label}</span></button>)}
        </section>
        <section ref={listRef} className="products-list-panel" aria-label="Listagem de produtos">
          <div className="products-list-head"><div><h2>Catálogo</h2><span aria-live="polite">{filteredProducts.length} de {products.length} produtos</span></div><label className="products-search"><span aria-hidden="true">⌕</span><input aria-label="Buscar produtos" value={search} onChange={event => setSearch(event.target.value)} placeholder="Buscar por nome, categoria ou ID" />{search ? <button type="button" aria-label="Limpar busca" onClick={() => setSearch("")}>×</button> : null}</label><button type="button" className="products-clear-filters" onClick={() => { setSearch(""); setFilter("all"); }} disabled={!search && filter === "all"}>Limpar filtros</button></div>
          <div className="products-table-scroll"><div className="products-table" role="table" aria-label="Produtos fictícios"><div className="products-table-header" role="row"><span role="columnheader">Produto</span><span role="columnheader">Categoria</span><span role="columnheader">Preço</span><span role="columnheader">Estoque</span><span role="columnheader">Variantes</span><span role="columnheader">Ações</span></div>
            {filteredProducts.map(product => <div className="products-row" role="row" key={product.id}>
              <button className="products-product" type="button" onClick={() => openEdit(product)} aria-label={`Editar ${product.name}`} role="cell"><span className="products-thumb">{product.image ? <img src={product.image} alt="" /> : <span>Sem imagem</span>}</span><span className="products-product-name"><strong>{product.name}</strong><small>#{product.id} · Atualizado {product.updated}</small></span></button>
              <span className="products-category" role="cell">{getCategoryLabel(product.category)}</span>
              <button className="products-value-button" type="button" role="cell" aria-label={`Editar preço de ${product.name}: ${money(product.price)}`} onClick={() => openQuickEdit(product, "price")}>{money(product.price)}<span aria-hidden="true">Editar</span></button>
              <button className={`products-value-button products-stock${product.stock === 0 ? " is-empty" : product.stock <= 5 ? " is-low" : ""}`} type="button" role="cell" aria-label={`Editar estoque de ${product.name}: ${product.stock} unidades${product.variants.length ? ", por variante" : ""}`} onClick={() => openQuickEdit(product, "stock")}>{product.stock === 0 ? "Sem estoque" : product.stock <= 5 ? `${product.stock} · Baixo` : product.stock}<span aria-hidden="true">{product.variants.length ? "Por variante" : "Editar"}</span></button>
              <span className="products-variants" role="cell">{product.variants.length} {product.variants.length === 1 ? "variante" : "variantes"}<small>{product.colors.join(", ")}{product.sizes.length ? ` · ${product.sizes.join(", ")}` : ""}</small></span>
              <div className="products-row-actions" role="cell"><button type="button" onClick={() => openEdit(product)}>Editar</button><button type="button" onClick={() => showMessage("Salvamento rápido demonstrativo; use o preço ou estoque da linha")}>Salvar rápido</button><button type="button" onClick={() => showMessage("Ações administrativas desativadas na prévia")}>Mais ações</button></div>
              {quickEdit?.id === product.id ? <QuickEditPanel product={product} edit={quickEdit} setEdit={setQuickEdit} onSave={saveQuickEdit} onCancel={() => setQuickEdit(null)} /> : null}
            </div>)}
            {filteredProducts.length === 0 ? <p className="products-empty">Nenhum produto corresponde à busca e aos filtros.</p> : null}
          </div></div>
          <p className="products-preview-note">Dados fictícios. Ajustes são temporários nesta tela e não são enviados ou persistidos.</p>
        </section>
      </> : <ProductEditor mode={mode} product={selected} draft={draft} changeDraft={changeDraft} localImage={localImage} galleryImages={galleryImages} archivedVariants={variantArchive} galleryUrlInput={galleryUrlInput} setGalleryUrlInput={setGalleryUrlInput} onFiles={selectImageFiles} onGalleryImagesChange={setGalleryImages} onSetCover={setGalleryImageAsCover} onImageUrlChange={changeCoverUrl} onGenerateVariants={generateVariants} onReorderImage={reorderGalleryImage} onRemoveImage={removeGalleryImage} onAddGalleryUrls={addGalleryUrls} onCancel={() => { clearLocalImages(); setMode("list"); }} onSave={() => showMessage("Salvamento indisponível na prévia visual")} onInfo={showMessage} />}
      {toast ? <div className="products-toast" role="status">{toast}</div> : null}
    </main>
  </div>;
}

function QuickEditPanel({ product, edit, setEdit, onSave, onCancel }: { product: Product; edit: QuickEdit; setEdit: React.Dispatch<React.SetStateAction<QuickEdit | null>>; onSave: () => void; onCancel: () => void }) {
  return <form className="products-quick-editor" role="cell" onSubmit={event => { event.preventDefault(); onSave(); }}>
    <strong>{edit.field === "price" ? `Editar preço · ${product.name}` : product.variants.length ? `Estoque por variante · ${product.name}` : `Editar estoque · ${product.name}`}</strong>
    {edit.field === "price" ? <label>Preço (R$)<input autoFocus inputMode="decimal" value={edit.value} onChange={event => setEdit(previous => previous ? { ...previous, value: event.target.value } : previous)} aria-label="Novo preço" /></label>
      : product.variants.length ? <div className="products-variant-quick-fields">{product.variants.map((variant, index) => <label key={variant.sku || index}><span>{variant.name}<small>{variant.sku}</small></span><input inputMode="numeric" value={edit.variants[index] ?? "0"} onChange={event => setEdit(previous => previous ? { ...previous, variants: previous.variants.map((value, position) => position === index ? event.target.value : value) } : previous)} aria-label={`Estoque da variante ${variant.name}`} /></label>)}</div>
        : <label>Quantidade disponível<input autoFocus inputMode="numeric" value={edit.value} onChange={event => setEdit(previous => previous ? { ...previous, value: event.target.value } : previous)} aria-label="Nova quantidade em estoque" /></label>}
    <div><button type="submit" className="products-primary">Confirmar alteração</button><button type="button" className="products-secondary" onClick={onCancel}>Cancelar</button></div>
  </form>;
}

function ProductEditor({ mode, product, draft, changeDraft, localImage, galleryImages, archivedVariants, galleryUrlInput, setGalleryUrlInput, onFiles, onGalleryImagesChange, onSetCover, onImageUrlChange, onGenerateVariants, onReorderImage, onRemoveImage, onAddGalleryUrls, onCancel, onSave, onInfo }: {
  mode: Exclude<Mode, "list">; product: Product | null; draft: Draft; changeDraft: <K extends keyof Draft>(field: K, value: Draft[K]) => void; localImage: string; galleryImages: PreviewImage[]; archivedVariants: Variant[]; galleryUrlInput: string; setGalleryUrlInput: (value: string) => void; onFiles: (files: FileList | null, gallery?: boolean) => void; onGalleryImagesChange: React.Dispatch<React.SetStateAction<PreviewImage[]>>; onSetCover: (imageId: string) => void; onImageUrlChange: (value: string) => void; onGenerateVariants: () => void; onReorderImage: (imageId: string, direction: -1 | 1) => void; onRemoveImage: (imageId: string) => void; onAddGalleryUrls: () => void; onCancel: () => void; onSave: () => void; onInfo: (message: string) => void;
}) {
  const [customColorHex, setCustomColorHex] = useState<Record<string, string>>({});
  const [colorsEditing, setColorsEditing] = useState(false);
  const [colorsInputChanged, setColorsInputChanged] = useState(false);
  const price = readMoney(draft.price);
  const stock = Number(draft.stock);
  const parsedVariants = draft.variants;
  const variantsValid = parsedVariants.length > 0
    ? parsedVariants.every(item => item.name.trim() && (!item.price.trim() || Number.isFinite(readMoney(item.price)) && readMoney(item.price) >= 0) && /^\d+$/.test(item.stock.trim()))
    : draft.colors.trim() === "" && draft.sizes.trim() === "" && Number.isInteger(stock) && stock >= 0;
  const colors = uniqueColorNames(colorsEditing && colorsInputChanged ? draft.colors.split(",").slice(0, -1) : splitUniqueValues(draft.colors));
  const sizes = splitUniqueValues(draft.sizes);
  const [previewColor, setPreviewColor] = useState(colors[0] ?? "");
  const [previewSize, setPreviewSize] = useState(sizes[0] ?? "");
  useEffect(() => {
    if (!colors.some(color => normalizeColorName(color) === normalizeColorName(previewColor))) setPreviewColor(colors[0] ?? "");
  }, [draft.colors]);
  useEffect(() => {
    if (!sizes.some(size => size.toLocaleLowerCase() === previewSize.toLocaleLowerCase())) setPreviewSize(sizes[0] ?? "");
  }, [draft.sizes]);
  const mainImageSource = localImage || (isImageSource(draft.imageUrl) ? draft.imageUrl : "");
  const colorGalleryImages = galleryImages.filter(image => previewColor && normalizeColorName(image.color ?? "") === normalizeColorName(previewColor));
  const generalGalleryImages = galleryImages.filter(image => !image.color);
  const previewGallery = [...colorGalleryImages, ...(mainImageSource ? [{ id: "__cover__", src: mainImageSource, name: imageNameFromSource(draft.imageUrl.replace(/^Arquivo local:\s*/, "")), color: null }] : []), ...generalGalleryImages.filter(image => image.id !== "__cover__")];
  const [selectedPreviewImageId, setSelectedPreviewImageId] = useState("__cover__");
  const selectedPreviewImage = previewGallery.find(image => image.id === selectedPreviewImageId);
  const imageSource = selectedPreviewImage?.src || colorGalleryImages[0]?.src || mainImageSource || generalGalleryImages[0]?.src || "";
  useEffect(() => {
    setSelectedPreviewImageId(colorGalleryImages[0]?.id ?? (mainImageSource ? "__cover__" : generalGalleryImages[0]?.id ?? ""));
  }, [previewColor, galleryImages, mainImageSource]);
  const selectedVariant = parsedVariants.find(variant => normalizeColorName(variant.color ?? "") === normalizeColorName(previewColor) && (variant.size ?? "").toLocaleLowerCase() === previewSize.toLocaleLowerCase())
    ?? (colors.length === 0 && sizes.length === 0 && parsedVariants.length === 1 ? parsedVariants[0] : undefined);
  const selectedVariantStock = selectedVariant && /^\d+$/.test(selectedVariant.stock.trim()) ? Number(selectedVariant.stock) : null;
  const selectedVariantPrice = selectedVariant?.price ? readMoney(selectedVariant.price) : NaN;
  const displayPrice = Number.isFinite(selectedVariantPrice) && selectedVariantPrice >= 0 ? selectedVariantPrice : price;
  const hasVariantPrice = Number.isFinite(selectedVariantPrice) && selectedVariantPrice >= 0 && Number.isFinite(price) && selectedVariantPrice !== price;
  const availability = selectedVariant
    ? selectedVariantStock === null ? "Disponibilidade não informada" : selectedVariantStock === 0 ? "Sem estoque nesta combinação" : `${selectedVariantStock} ${selectedVariantStock === 1 ? "unidade disponível" : "unidades disponíveis"}`
    : colors.length || sizes.length || parsedVariants.length ? "Combinação sem variante cadastrada" : Number.isInteger(stock) && stock >= 0 ? stock === 0 ? "Sem estoque" : `${stock} ${stock === 1 ? "unidade disponível" : "unidades disponíveis"}` : "Disponibilidade não informada";
  const checklist = [
    ["Nome preenchido", Boolean(draft.name.trim())],
    ["Categoria selecionada", Boolean(draft.category)],
    ["Preço válido", Number.isFinite(price) && price > 0],
    ["Imagem principal disponível", Boolean(mainImageSource)],
    ["Variantes e estoque coerentes", variantsValid],
  ] as const;
  const onText = (field: keyof Draft) => (event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => changeDraft(field, event.target.value as Draft[typeof field]);
  const onColorsText = (event: React.ChangeEvent<HTMLInputElement>) => {
    setColorsInputChanged(true);
    const raw = event.target.value;
    const parts = raw.split(",");
    const complete = uniqueColorNames(parts.slice(0, -1));
    const pending = parts.at(-1)?.trim() ?? "";
    changeDraft("colors", `${complete.join(", ")}${complete.length ? ", " : ""}${pending}`);
  };
  const finishColorsInput = (event: React.FocusEvent<HTMLInputElement>) => {
    const complete = uniqueColorNames(splitUniqueValues(event.currentTarget.value));
    changeDraft("colors", complete.join(", "));
    setColorsEditing(false);
    setColorsInputChanged(false);
  };
  const sizesList = sizeSuggestions[draft.sizeType as keyof typeof sizeSuggestions] ?? [];
  const variantTotal = parsedVariants.reduce((total, item) => total + (/^\d+$/.test(item.stock.trim()) ? Number(item.stock) : 0), 0);
  const updateVariant = (index: number, update: Partial<Variant>) => changeDraft("variants", parsedVariants.map((variant, position) => position === index ? { ...variant, ...update } : variant));
  const reorderColor = (color: string, direction: -1 | 1) => {
    const ordered = [...colors];
    const index = ordered.findIndex(item => normalizeColorName(item) === normalizeColorName(color));
    const target = index + direction;
    if (target < 0 || target >= ordered.length) return;
    [ordered[index], ordered[target]] = [ordered[target], ordered[index]];
    changeDraft("colors", ordered.join(", "));
  };
  const onImageDrop = (event: React.DragEvent<HTMLElement>, targetId: string) => {
    event.preventDefault();
    const sourceId = event.dataTransfer.getData("text/l4ckos-image-id");
    if (!sourceId || sourceId === targetId) return;
    const from = galleryImages.findIndex(image => image.id === sourceId);
    const to = galleryImages.findIndex(image => image.id === targetId);
    if (from < 0 || to < 0) return;
    if (normalizeColorName(galleryImages[from].color ?? "") !== normalizeColorName(galleryImages[to].color ?? "")) return;
    const next = [...galleryImages];
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved);
    onGalleryImagesChange(next);
  };
  const renderImageRows = (images: PreviewImage[]) => images.map(image => {
    const group = galleryImages.filter(item => normalizeColorName(item.color ?? "") === normalizeColorName(image.color ?? ""));
    const groupPosition = group.findIndex(item => item.id === image.id);
    const positionLabel = image.color
      ? groupPosition === 0 ? `1ª ao selecionar ${image.color}` : `${groupPosition + 1}ª de ${image.color}`
      : `${groupPosition + 1}ª na galeria geral`;
    return <div className="products-image-row" key={image.id} draggable onDragStart={event => event.dataTransfer.setData("text/l4ckos-image-id", image.id)} onDragOver={event => event.preventDefault()} onDrop={event => onImageDrop(event, image.id)}>
      <img src={image.imageThumbnailUrl || image.src} alt={image.alt || image.name} /><div className="products-image-info"><strong>{image.name}</strong><span>{image.color ? `Imagens de ${image.color}` : "Imagem geral"}</span><small className={groupPosition === 0 ? "is-first" : ""}>{positionLabel}</small></div>
      <div className="products-image-association"><span>Associação</span><FieldSelect label={`Associação de ${image.name}`} value={image.color || "__general"} onChange={value => onGalleryImagesChange(previous => previous.map(item => item.id === image.id ? { ...item, color: value === "__general" ? null : value } : item))}><SelectItem value="__general">Geral</SelectItem>{uniqueColorNames([...colors, ...galleryImages.map(item => item.color ?? "")]).map(color => <SelectItem key={color} value={color}>{color}</SelectItem>)}</FieldSelect></div>
      <div className="products-image-actions"><button type="button" aria-label={`Mover ${image.name} para frente na sequência`} title="Mover para frente" disabled={groupPosition === 0} onClick={() => onReorderImage(image.id, -1)}>↑ <span>Subir</span></button><button type="button" aria-label={`Mover ${image.name} para trás na sequência`} title="Mover para trás" disabled={groupPosition === group.length - 1} onClick={() => onReorderImage(image.id, 1)}>↓ <span>Descer</span></button>{!image.color ? <button type="button" onClick={() => onSetCover(image.id)}>{image.src === mainImageSource ? "Capa atual" : "Definir como capa"}</button> : <span title="A capa é geral no contrato atual">Capa geral</span>}<button type="button" className="is-remove" onClick={() => onRemoveImage(image.id)}>Remover</button></div>
    </div>;
  });
  const generalImages = galleryImages.filter(image => !image.color);
  const colorImageGroups = uniqueColorNames(galleryImages.map(image => image.color ?? "")).map(color => ({ color, images: galleryImages.filter(image => normalizeColorName(image.color ?? "") === normalizeColorName(color)) }));

  return <div className="products-editor-layout">
    <form className="products-form" onSubmit={event => { event.preventDefault(); onSave(); }}>
      <div className="products-form-intro"><div><h2>{mode === "create" ? "Cadastro de produto" : `Produto #${product?.id}`}</h2><p>Prévia local. Os campos são demonstrativos e não enviam dados.</p></div>{mode === "edit" ? <button type="button" className="products-secondary" onClick={() => onInfo("Ações administrativas desativadas na prévia")}>Ações do produto</button> : null}</div>
      <section className="products-form-section"><h3>1. Informações básicas</h3><div className="products-fields"><label className="products-field products-field--wide">Nome do produto<input value={draft.name} onChange={onText("name")} placeholder="Nome do produto" /></label><FieldSelect label="Categoria" value={draft.category || "__empty"} onChange={value => changeDraft("category", value === "__empty" ? "" : value)}><SelectItem value="__empty">Selecione a categoria</SelectItem>{PRODUCT_CATEGORIES.map(option => <SelectItem value={option.value} key={option.value}>{option.label}</SelectItem>)}</FieldSelect><div className="products-category-preview"><span>Prévia da categoria</span><strong>{draft.category ? getCategoryLabel(draft.category) : "Selecione uma categoria"}</strong><small>Define onde o produto aparece na vitrine.</small></div><label className="products-field products-field--wide">Descrição curta<textarea rows={3} value={draft.description} onChange={onText("description")} placeholder="Descrição curta do produto" /></label></div></section>

      <section className="products-form-section">
        <h3>2. Preço, cores e tamanhos</h3>
        <div className="products-fields">
          <label className="products-field">Preço (R$)<input inputMode="decimal" value={draft.price} onChange={onText("price")} placeholder="0,00" /></label>
          <div className="products-type-field"><FieldSelect label="Tipo de tamanho" value={draft.sizeType} onChange={value => changeDraft("sizeType", value)}><SelectItem value="alpha">Alfabético (PP, P, M…)</SelectItem><SelectItem value="numeric">Numérico (36, 38, 40…)</SelectItem><SelectItem value="custom">Customizado</SelectItem></FieldSelect></div>
          <div className="products-color-field-group"><label className="products-field">Cores (separadas por vírgula)<input value={draft.colors} onFocus={() => setColorsEditing(true)} onChange={onColorsText} onBlur={finishColorsInput} placeholder="preto, branco, verde" /></label>
          <div className="products-color-swatches" role="group" aria-label="Cores selecionadas">
            {colors.map(color => {
              const key = normalizeColorName(color);
              const knownHex = recognizedColorHex(color);
              const customValue = customColorHex[key] ?? "";
              const customHexIsValid = /^#[0-9a-f]{6}$/i.test(customValue);
              const swatchHex = knownHex ?? (customHexIsValid ? customValue : null);
              const previewSelected = normalizeColorName(previewColor) === key;
              return <div className="products-color-option" key={key}>
                <button type="button" aria-label={`Visualizar cor ${color}`} aria-pressed={previewSelected} data-preview-selected={previewSelected} onClick={() => setPreviewColor(color)}>
                  <span className="products-color-dot" data-color-defined={Boolean(swatchHex)} style={{ "--swatch-color": swatchHex ?? "#4a4a4a" } as React.CSSProperties} aria-hidden="true" />
                  <span>{color}</span>
                </button>
                <div className="products-option-order"><button type="button" aria-label={`Mover ${color} para cima`} disabled={colors.findIndex(item => normalizeColorName(item) === key) === 0} onClick={() => reorderColor(color, -1)}>↑</button><button type="button" aria-label={`Mover ${color} para baixo`} disabled={colors.findIndex(item => normalizeColorName(item) === key) === colors.length - 1} onClick={() => reorderColor(color, 1)}>↓</button></div>
                {!knownHex && previewSelected ? <label className="products-color-hex">HEX<input type="text" inputMode="text" maxLength={7} placeholder="#RRGGBB" value={customValue} aria-label={`Código HEX da cor ${color}`} aria-invalid={Boolean(customValue && !customHexIsValid)} onChange={event => { const value = event.target.value; setCustomColorHex(previous => ({ ...previous, [key]: value })); }} /></label> : null}
              </div>;
            })}
          </div></div>
          <label className="products-field">Tamanhos<input value={draft.sizes} onChange={onText("sizes")} placeholder={draft.sizeType === "numeric" ? "36, 38, 40" : "PP, P, M, G, GG"} /></label>
          <div className="products-suggestions products-size-toggles" role="group" aria-label="Selecionar tamanhos">{sizesList.map(size => <button type="button" key={size} aria-pressed={sizes.some(item => item.toLocaleLowerCase() === size.toLocaleLowerCase())} data-preview-selected={previewSize.toLocaleLowerCase() === size.toLocaleLowerCase()} onClick={() => { toggleDraftValue(draft, "sizes", size, changeDraft); if (!sizes.some(item => item.toLocaleLowerCase() === size.toLocaleLowerCase())) setPreviewSize(size); }}>{size}</button>)}</div>
        </div>
      </section>

      <section className="products-form-section"><h3>3. Imagens</h3>
        <div className="products-image-group"><div className="products-image-group-heading"><div><h4>Imagem principal / capa</h4><p>A capa é geral do produto; as associações por cor ficam na galeria.</p></div></div><div className="products-cover-row"><div><div className="products-cover-thumb">{mainImageSource ? <img src={mainImageSource} alt="" /> : <span>Sem capa</span>}</div><small className="products-cover-order">Capa · imagem principal da vitrine</small></div><div className="products-cover-fields"><label className="products-field">URL da capa<input value={draft.imageUrl} onChange={event => onImageUrlChange(event.target.value)} placeholder="URL da imagem principal" /></label><label className="products-upload">Selecionar arquivo de capa<input type="file" accept="image/*" onChange={event => onFiles(event.target.files)} /></label></div></div>
        <div className="products-image-group-heading"><div><h4>Galeria geral e por cor</h4><p>Arraste para reordenar. Os botões de posição também funcionam por teclado; mover a imagem não altera sua associação.</p></div></div>
        <div className="products-gallery-add"><label className="products-field">Adicionar URL(s) à galeria<input value={galleryUrlInput} onChange={event => setGalleryUrlInput(event.target.value)} placeholder="Uma ou mais URLs, separadas por vírgula" /></label><button type="button" className="products-secondary" onClick={onAddGalleryUrls}>Adicionar URL</button><label className="products-upload">Enviar imagens à galeria<input type="file" accept="image/*" multiple onChange={event => onFiles(event.target.files, true)} /></label></div>
        <div className="products-image-list" aria-label="Imagens da galeria">
          <div className="products-gallery-subhead">Galeria geral</div>{renderImageRows(generalImages)}{!generalImages.length ? <p className="products-image-empty">Nenhuma imagem geral adicional.</p> : null}
          <div className="products-gallery-subhead">Imagens específicas por cor</div>{colorImageGroups.map(group => <section className="products-image-color-group" key={normalizeColorName(group.color)}><h5>{group.color}</h5>{renderImageRows(group.images)}</section>)}{!colorImageGroups.length ? <p className="products-image-empty">Nenhuma imagem associada a uma cor. A prévia usa a capa e a galeria geral.</p> : null}
        </div></div>
      </section>

      <section className="products-form-section"><h3>4. Variantes e estoque</h3>
        <p className="products-variant-stock-note">O total abaixo soma somente as combinações ativas; o estoque geral do produto não é alterado. Cor e tamanho são inferidos do nome legado, porque a API atual persiste somente nome, SKU, preço e quantidade da variante.</p>
        {!parsedVariants.length ? <label className="products-field products-stock-field">Estoque disponível do produto<input inputMode="numeric" value={draft.stock} onChange={onText("stock")} placeholder="0" /></label> : null}
        <div className="products-variant-summary"><strong>{variantTotal}</strong><span>unidades nas combinações ativas</span><button type="button" className="products-secondary" onClick={onGenerateVariants}>Gerar / atualizar combinações</button></div>
        <p className="products-variant-stock-note">A atualização adiciona combinações ausentes e mantém SKU, preço e estoque das combinações reconhecidas. Linhas novas começam com estoque zero. Confirme a ação pelo botão.</p>
        {parsedVariants.length ? <div className="products-variant-table" role="table" aria-label="Variantes e estoque"><div className="products-variant-header" role="row"><span role="columnheader">Cor</span><span role="columnheader">Tamanho</span><span role="columnheader">SKU</span><span role="columnheader">Preço</span><span role="columnheader">Estoque</span><span role="columnheader">Situação</span></div>{parsedVariants.map((variant, index) => {
          const quantity = /^\d+$/.test(variant.stock.trim()) ? Number(variant.stock) : null;
          const variantColorHex = variant.color ? recognizedColorHex(variant.color) ?? (/^#[0-9a-f]{6}$/i.test(customColorHex[normalizeColorName(variant.color)] ?? "") ? customColorHex[normalizeColorName(variant.color)] : null) : null;
          return <div className="products-variant-row" role="row" key={`${variantOptionKey(variant.color ?? "", variant.size ?? "")}-${index}`}><span className="products-variant-color" role="cell">{variant.color ? <><i style={{ "--swatch-color": variantColorHex ?? "#454545" } as React.CSSProperties} data-color-defined={Boolean(variantColorHex)} />{variant.color}</> : "—"}</span><span role="cell">{variant.size || "—"}</span><span role="cell"><input value={variant.sku} aria-label={`SKU de ${variant.name}`} onChange={event => updateVariant(index, { sku: event.target.value })} /></span><span role="cell"><label className="products-variant-mobile-label">Preço</label><input value={variant.price} inputMode="decimal" aria-label={`Preço de ${variant.name}`} placeholder="Usar preço base" onChange={event => updateVariant(index, { price: event.target.value })} /></span><span role="cell"><label className="products-variant-mobile-label">Estoque</label><input className="products-variant-stock-input" type="number" min="0" step="1" inputMode="numeric" value={variant.stock} aria-label={`Quantidade em estoque de ${variant.name}`} onChange={event => updateVariant(index, { stock: event.target.value })} /></span><span role="cell" className={quantity === 0 ? "is-zero" : quantity !== null && quantity <= 5 ? "is-low" : "is-available"}>{quantity === null ? "Verificar valor" : quantity === 0 ? "Zerado" : quantity <= 5 ? "Baixo" : "Disponível"}</span></div>;
        })}</div> : null}
        {archivedVariants.length ? <details className="products-archived-variants"><summary>{archivedVariants.length} combinação(ões) fora das opções atuais — preservadas</summary><ul>{archivedVariants.map((variant, index) => <li key={`${variant.name}-${index}`}>{variant.name} · SKU {variant.sku || "—"} · Preço {variant.price || "—"} · Estoque {variant.stock}</li>)}</ul></details> : null}
      </section>
      <div className="products-form-footer"><span>Nenhum dado será salvo ou enviado.</span><div><button type="button" className="products-secondary" onClick={() => onInfo("Salvamento rápido desativado na prévia")}>Salvar rápido</button><button type="submit" className="products-primary">{mode === "create" ? "Criar produto" : "Salvar edição"}</button><button type="button" className="products-secondary" onClick={onCancel}>Cancelar</button></div></div>
    </form>

    <aside className="products-preview-column" aria-label="Prévia e checklist do produto"><section className="products-store-preview"><h2>Prévia na loja</h2><div className="products-store-image">{imageSource ? <img src={imageSource} alt={draft.name ? `Prévia de ${draft.name}` : "Prévia da imagem do produto"} /> : <span>Imagem principal indisponível</span>}</div>{previewGallery.length > 1 ? <div className="products-preview-gallery" aria-label="Imagens do produto na ordem de exibição">{previewGallery.map((image, index) => <button type="button" key={image.id} aria-label={`Mostrar imagem ${index + 1}: ${image.name}${image.color ? `, ${image.color}` : ", geral"}`} aria-pressed={selectedPreviewImageId === image.id} onClick={() => setSelectedPreviewImageId(image.id)}><img src={image.src} alt="" /></button>)}</div> : null}<span className="products-store-category">{draft.category ? getCategoryLabel(draft.category) : "Categoria"}</span><h3>{draft.name || "Nome do produto"}</h3>{draft.description.trim() ? <p className="products-store-description">{draft.description}</p> : null}<strong className="products-store-price">{Number.isFinite(displayPrice) && displayPrice >= 0 ? money(Math.round(displayPrice * 100)) : "Preço não informado"}</strong>{hasVariantPrice ? <small className="products-store-base-price">Preço base: {money(Math.round(price * 100))}</small> : null}<div className="products-store-options"><span>Cor{colors.length === 1 ? "" : "es"}</span><div className="products-preview-colors">{colors.length ? colors.map(color => {
        const key = normalizeColorName(color);
        const hex = recognizedColorHex(color) ?? (/^#[0-9a-f]{6}$/i.test(customColorHex[key] ?? "") ? customColorHex[key] : null);
        return <button type="button" className="products-preview-color" key={key} aria-label={`Visualizar cor ${color}`} aria-pressed={normalizeColorName(previewColor) === key} title={color} onClick={() => setPreviewColor(color)}><span style={{ "--swatch-color": hex ?? "#454545" } as React.CSSProperties} data-color-defined={Boolean(hex)} aria-hidden="true" /><small>{color}</small></button>;
      }) : <small>Não informadas</small>}</div></div><div className="products-store-options"><span>Tamanho{sizes.length === 1 ? "" : "s"}</span><div className="products-preview-sizes">{sizes.length ? sizes.map(size => <button type="button" key={size} aria-pressed={previewSize.toLocaleLowerCase() === size.toLocaleLowerCase()} onClick={() => setPreviewSize(size)}>{size}</button>) : <small>Não informados</small>}</div></div><p className={`products-preview-availability${selectedVariantStock === 0 ? " is-unavailable" : ""}`} aria-live="polite">{availability}</p></section>
      <section className="products-checklist"><h2>Checklist visual</h2><p>Referência demonstrativa; não altera regras de publicação.</p>{checklist.map(([label, done]) => <div className={`products-check-item${done ? " is-done" : ""}`} key={label}><span aria-hidden="true">{done ? "✓" : "—"}</span>{label}</div>)}</section>
    </aside>
  </div>;
}

function FieldSelect({ label, value, onChange, children }: { label: string; value: string; onChange: (value: string) => void; children: React.ReactNode }) {
  return <div className="products-field products-radix-field"><span>{label}</span><Select value={value} onValueChange={onChange}><SelectTrigger className="orders-select-trigger" aria-label={label}><SelectValue /></SelectTrigger><SelectContent className="orders-select-content products-select-content" position="popper" align="start" sideOffset={5} collisionPadding={12}>{children}</SelectContent></Select></div>;
}
