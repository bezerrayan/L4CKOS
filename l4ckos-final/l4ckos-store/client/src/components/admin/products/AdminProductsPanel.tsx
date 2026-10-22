import { useMemo, useState, type ReactNode } from "react";
import type { inferRouterInputs, inferRouterOutputs } from "@trpc/server";
import type { AppRouter } from "../../../../../server/routers";
import { PRODUCT_CATEGORIES, getCategoryLabel, normalizeCategoryValue } from "../../../lib/productCategories";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../../ui/select";
import "./AdminProductsPanel.css";

type RouterInputs = inferRouterInputs<AppRouter>;
type RouterOutputs = inferRouterOutputs<AppRouter>;
type Product = RouterOutputs["admin"]["productsList"][number];
type CreateInput = RouterInputs["admin"]["productCreate"];
type UpdateInput = RouterInputs["admin"]["productUpdate"];
type ImageUpload = { url: string; thumbnailUrl?: string | null; detailUrl?: string | null; bannerUrl?: string | null };
type DraftImage = { imageUrl: string; imageThumbnailUrl?: string | null; imageDetailUrl?: string | null; imageBannerUrl?: string | null; color?: string | null; alt?: string | null };
type DraftVariant = { id?: number; name: string; color: string; size: string; sku: string; price: string; stock: string; isActive: boolean };
type Draft = {
  name: string; category: string; description: string; price: string; stock: string;
  colors: string; sizes: string; sizeType: "alpha" | "numeric" | "custom";
  imageUrl: string; imageThumbnailUrl: string; imageDetailUrl: string; imageBannerUrl: string;
  images: DraftImage[]; variants: DraftVariant[];
};
type Filter = "all" | "withStock" | "outOfStock" | "lowStock" | "withoutImage" | "withVariants";
type Props = {
  products?: Product[];
  isLoading: boolean;
  isError: boolean;
  onRetry: () => void;
  isSaving: boolean;
  onCreate: (input: CreateInput) => Promise<unknown>;
  onUpdate: (input: UpdateInput) => Promise<unknown>;
  onDelete: (id: number) => Promise<unknown>;
  onUpload: (files: FileList | null, mode: "single" | "multiple", target: string) => Promise<ImageUpload[]>;
  isUploading: boolean;
  imageSource: (value?: string | null) => string;
  initialSearch?: string;
};

const money = (cents: number | null | undefined) => new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(Number(cents ?? 0) / 100);
const moneyInput = (cents: number | null | undefined) => cents == null ? "" : (Number(cents) / 100).toFixed(2);
function parseMoney(value: string) {
  const raw = value.trim().replace(/[^\d.,-]/g, "");
  if (!raw) return NaN;
  return Number(raw.includes(",") && raw.includes(".") ? raw.replace(/\./g, "").replace(",", ".") : raw.replace(",", "."));
}
function splitList(value: string) { return [...new Set(value.split(",").map(item => item.trim()).filter(Boolean))]; }
function readOptions(value?: string | null) {
  if (!value) return [];
  try { const parsed = JSON.parse(value); return Array.isArray(parsed) ? parsed.map(String).filter(Boolean) : []; } catch { return []; }
}
function blankDraft(): Draft {
  return { name: "", category: "", description: "", price: "", stock: "0", colors: "", sizes: "", sizeType: "alpha", imageUrl: "", imageThumbnailUrl: "", imageDetailUrl: "", imageBannerUrl: "", images: [], variants: [] };
}
function draftFrom(product: Product): Draft {
  return {
    name: product.name ?? "", category: product.category ?? "", description: product.description ?? "",
    price: moneyInput(product.price), stock: String(product.stock ?? 0),
    colors: readOptions(product.optionColors).join(", "), sizes: readOptions(product.optionSizes).join(", "),
    sizeType: product.sizeType === "numeric" || product.sizeType === "custom" ? product.sizeType : "alpha",
    imageUrl: product.imageUrl ?? "", imageThumbnailUrl: product.imageThumbnailUrl ?? "",
    imageDetailUrl: product.imageDetailUrl ?? "", imageBannerUrl: product.imageBannerUrl ?? "",
    images: (product.images ?? []).map(image => ({ imageUrl: image.imageUrl, imageThumbnailUrl: image.imageThumbnailUrl, imageDetailUrl: image.imageDetailUrl, imageBannerUrl: image.imageBannerUrl, color: image.color, alt: image.alt })),
    variants: (product.variants ?? []).map(variant => ({ id: variant.id, name: variant.name, color: variant.color ?? "", size: variant.size ?? "", sku: variant.sku ?? "", price: moneyInput(variant.price), stock: String(variant.stock ?? 0), isActive: Number(variant.isActive) === 1 })),
  };
}

export function AdminProductsPanel({ products = [], isLoading, isError, onRetry, isSaving, onCreate, onUpdate, onDelete, onUpload, isUploading, imageSource, initialSearch = "" }: Props) {
  const [search, setSearch] = useState(initialSearch);
  const [filter, setFilter] = useState<Filter>("all");
  const [mode, setMode] = useState<"list" | "create" | "edit">("list");
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [draft, setDraft] = useState<Draft>(blankDraft);
  const [dirty, setDirty] = useState<Set<string>>(new Set());
  const [quickEdit, setQuickEdit] = useState<{ id: number; field: "price" | "stock"; value: string } | null>(null);
  const [notice, setNotice] = useState("");
  const [fileNonce, setFileNonce] = useState(0);

  const selectedProduct = products.find(product => product.id === selectedId) ?? null;
  const filteredProducts = useMemo(() => {
    const needle = search.trim().toLocaleLowerCase("pt-BR");
    return products.filter(product => {
      const textMatches = !needle || [product.name, product.category, String(product.id), ...(product.variants ?? []).map(variant => `${variant.name} ${variant.sku ?? ""}`)]
        .some(value => String(value ?? "").toLocaleLowerCase("pt-BR").includes(needle));
      if (!textMatches) return false;
      const stock = Number(product.stock ?? 0);
      if (filter === "withStock") return product.salesMode !== "PREORDER" && stock > 0;
      if (filter === "outOfStock") return product.salesMode !== "PREORDER" && stock <= 0;
      if (filter === "lowStock") return product.salesMode !== "PREORDER" && stock > 0 && stock <= 5;
      if (filter === "withoutImage") return !product.imageUrl;
      if (filter === "withVariants") return (product.variants?.length ?? 0) > 0;
      return true;
    });
  }, [filter, products, search]);
  const counts = useMemo(() => ({
    all: products.length,
    withStock: products.filter(product => product.salesMode !== "PREORDER" && Number(product.stock ?? 0) > 0).length,
    outOfStock: products.filter(product => product.salesMode !== "PREORDER" && Number(product.stock ?? 0) <= 0).length,
    lowStock: products.filter(product => product.salesMode !== "PREORDER" && Number(product.stock ?? 0) > 0 && Number(product.stock ?? 0) <= 5).length,
    withoutImage: products.filter(product => !product.imageUrl).length,
    withVariants: products.filter(product => (product.variants?.length ?? 0) > 0).length,
  }), [products]);

  const startCreate = () => { setDraft(blankDraft()); setDirty(new Set()); setSelectedId(null); setMode("create"); setNotice(""); };
  const startEdit = (product: Product) => { setDraft(draftFrom(product)); setDirty(new Set()); setSelectedId(product.id); setMode("edit"); setNotice(""); };
  const cancelEdit = () => { setMode("list"); setSelectedId(null); setDirty(new Set()); setNotice(""); };
  const change = <K extends keyof Draft>(field: K, value: Draft[K]) => {
    setDraft(previous => ({ ...previous, [field]: value }));
    setDirty(previous => new Set(previous).add(field));
  };
  const updateImage = (index: number, patch: Partial<DraftImage>) => change("images", draft.images.map((image, current) => current === index ? { ...image, ...patch } : image));
  const updateVariant = (index: number, patch: Partial<DraftVariant>) => change("variants", draft.variants.map((variant, current) => current === index ? { ...variant, ...patch } : variant));
  const addVariant = () => change("variants", [...draft.variants, { name: "", color: "", size: "", sku: "", price: "", stock: "0", isActive: false }]);
  const addUploads = async (files: FileList | null, gallery: boolean) => {
    const uploads = await onUpload(files, gallery ? "multiple" : "single", gallery ? "edit-gallery" : "edit-main");
    if (uploads.length) {
      if (gallery) {
        const entries = uploads.map(image => ({ imageUrl: image.detailUrl || image.url, imageThumbnailUrl: image.thumbnailUrl ?? null, imageDetailUrl: image.detailUrl || image.url, imageBannerUrl: image.bannerUrl ?? null, color: null, alt: null }));
        change("images", [...draft.images, ...entries]);
      } else {
        const image = uploads[0];
        change("imageUrl", image.detailUrl || image.url);
        change("imageThumbnailUrl", image.thumbnailUrl || "");
        change("imageDetailUrl", image.detailUrl || image.url);
        change("imageBannerUrl", image.bannerUrl || "");
      }
    }
    setFileNonce(value => value + 1);
  };
  const moveImage = (index: number, offset: -1 | 1) => {
    const target = index + offset;
    if (target < 0 || target >= draft.images.length) return;
    const next = [...draft.images];
    [next[index], next[target]] = [next[target], next[index]];
    change("images", next);
  };

  const save = async () => {
    const amount = parseMoney(draft.price);
    const stock = Number(draft.stock);
    if (!draft.name.trim() || !draft.category || !Number.isFinite(amount) || amount <= 0 || !Number.isInteger(stock) || stock < 0) {
      setNotice("Revise nome, categoria, preço e estoque antes de salvar.");
      return;
    }
    const imageList = [
      ...(draft.imageUrl.trim() ? [{ imageUrl: draft.imageUrl.trim(), imageThumbnailUrl: draft.imageThumbnailUrl || null, imageDetailUrl: draft.imageDetailUrl || null, imageBannerUrl: draft.imageBannerUrl || null, color: null, alt: null }] : []),
      ...draft.images,
    ];
    const common = {
      name: draft.name.trim(), category: normalizeCategoryValue(draft.category),
      price: Math.round(amount * 100), stock,
    };
    try {
      if (mode === "create") {
        if (draft.variants.length && !window.confirm("Criar variantes de catálogo? A disponibilidade pública continuará desligada até a integração do checkout.")) return;
        await onCreate({
          ...common,
          description: draft.description.trim() || undefined,
          imageUrl: draft.imageUrl.trim() || undefined,
          imageThumbnailUrl: draft.imageThumbnailUrl || undefined,
          imageDetailUrl: draft.imageDetailUrl || undefined,
          imageBannerUrl: draft.imageBannerUrl || undefined,
          optionColors: splitList(draft.colors), optionSizes: splitList(draft.sizes), sizeType: draft.sizeType,
          images: imageList, variants: draft.variants.map(variant => ({
            ...(variant.name.trim() ? { name: variant.name.trim() } : {}), color: variant.color.trim(), size: variant.size.trim(),
            sku: variant.sku.trim(), price: variant.price.trim() ? Math.round(parseMoney(variant.price) * 100) : null,
            stock: Number(variant.stock), isActive: variant.isActive,
          })),
        });
      } else if (selectedId) {
        const update: UpdateInput = { id: selectedId };
        if (dirty.has("name")) update.name = common.name;
        if (dirty.has("category")) update.category = common.category;
        if (dirty.has("price")) update.price = common.price;
        if (dirty.has("stock")) update.stock = common.stock;
        if (dirty.has("description")) update.description = draft.description.trim();
        if (dirty.has("colors")) update.optionColors = splitList(draft.colors);
        if (dirty.has("sizes")) update.optionSizes = splitList(draft.sizes);
        if (dirty.has("sizeType")) update.sizeType = draft.sizeType;
        if (dirty.has("imageUrl")) update.imageUrl = draft.imageUrl.trim();
        if (dirty.has("imageThumbnailUrl")) update.imageThumbnailUrl = draft.imageThumbnailUrl;
        if (dirty.has("imageDetailUrl")) update.imageDetailUrl = draft.imageDetailUrl;
        if (dirty.has("imageBannerUrl")) update.imageBannerUrl = draft.imageBannerUrl;
        if (dirty.has("images")) update.images = imageList;
        if (dirty.has("variants")) {
          if (draft.variants.some(variant => ((variant.isActive || variant.id === undefined) && (!variant.color.trim() || !variant.size.trim() || !variant.sku.trim())) || !Number.isInteger(Number(variant.stock)) || Number(variant.stock) < 0 || (variant.price.trim() && (!Number.isFinite(parseMoney(variant.price)) || parseMoney(variant.price) < 0)))) {
            setNotice("Revise cor, tamanho, SKU, preço e estoque de cada variante antes de salvar.");
            return;
          }
          if (!window.confirm("Salvar a revisão das variantes? A ativação exige identidade explícita; pedidos e reservas históricos serão preservados.")) return;
          update.variants = draft.variants.map(variant => ({
            ...(variant.id !== undefined ? { id: variant.id } : {}),
            ...(variant.name.trim() ? { name: variant.name.trim() } : {}),
            color: variant.color.trim() || null, size: variant.size.trim() || null, sku: variant.sku.trim() || null,
            price: variant.price.trim() ? Math.round(parseMoney(variant.price) * 100) : null,
            stock: Number(variant.stock), isActive: variant.isActive,
          }));
        }
        if (Object.keys(update).length === 1) { setNotice("Nenhuma alteração foi feita."); return; }
        await onUpdate(update);
      }
      setMode("list"); setSelectedId(null); setDirty(new Set()); setNotice("");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Não foi possível salvar as alterações.");
    }
  };
  const saveQuick = async () => {
    if (!quickEdit) return;
    const product = products.find(item => item.id === quickEdit.id);
    if (!product) return;
    const update: UpdateInput = { id: product.id };
    if (quickEdit.field === "price") {
      const value = parseMoney(quickEdit.value);
      if (!Number.isFinite(value) || value <= 0) { setNotice("Informe um preço maior que zero."); return; }
      update.price = Math.round(value * 100);
    } else {
      const value = Number(quickEdit.value);
      if (!Number.isInteger(value) || value < 0) { setNotice("Informe um estoque inteiro não negativo."); return; }
      update.stock = value;
    }
    try { await onUpdate(update); setQuickEdit(null); setNotice(""); }
    catch { setNotice("A alteração não foi salva. O estoque pode estar protegido por reservas ativas."); }
  };

  const filterItems: Array<{ key: Filter; label: string }> = [
    { key: "all", label: "Todos" }, { key: "withStock", label: "Com estoque" },
    { key: "outOfStock", label: "Sem estoque" }, { key: "lowStock", label: "Estoque baixo" },
    { key: "withoutImage", label: "Sem imagem" }, { key: "withVariants", label: "Com variantes" },
  ];

  return <AdminSurface><div className="admin-products-live">
    <header className="apl-heading"><div><span className="apl-kicker">Operação · Catálogo</span><h2>Produtos e estoque</h2><p>Gerencie o catálogo e os níveis de estoque registrados.</p></div><button className="apl-primary" type="button" onClick={startCreate}>Novo produto</button></header>
    {mode === "list" ? <>
      <div className="apl-metrics" role="group" aria-label="Filtros rápidos do catálogo">
        {filterItems.map(item => <button type="button" key={item.key} className={filter === item.key ? "is-active" : ""} aria-pressed={filter === item.key} onClick={() => setFilter(item.key)}><strong>{counts[item.key]}</strong><span>{item.label}</span></button>)}
      </div>
      <div className="apl-toolbar"><label className="apl-search"><span aria-hidden="true">⌕</span><input aria-label="Buscar produtos por nome, categoria, código ou variante" placeholder="Buscar produto, categoria, ID ou SKU" value={search} onChange={event => setSearch(event.target.value)} />{search ? <button type="button" aria-label="Limpar busca" onClick={() => setSearch("")}>×</button> : null}</label><span className="apl-count" aria-live="polite">{filteredProducts.length} de {products.length} produtos</span></div>
      {isLoading ? <p className="apl-state" role="status">Carregando catálogo…</p> : isError ? <div className="apl-state apl-error" role="alert"><p>Não foi possível carregar os produtos.</p><button className="apl-secondary" type="button" onClick={onRetry}>Tentar novamente</button></div> : products.length === 0 ? <p className="apl-state">Nenhum produto cadastrado.</p> : filteredProducts.length === 0 ? <p className="apl-state">Nenhum produto corresponde à busca e aos filtros.</p> : <div className="apl-table-wrap"><table className="apl-table"><thead><tr><th>Produto</th><th>Categoria</th><th>Preço</th><th>Estoque</th><th>Variantes</th><th>Ações</th></tr></thead><tbody>{filteredProducts.map(product => <tr key={product.id}>
        <td><button type="button" className="apl-product" onClick={() => startEdit(product)}><span className="apl-thumb">{product.imageUrl ? <img src={imageSource(product.imageUrl)} alt="" /> : <span>Sem imagem</span>}</span><span><strong>{product.name}</strong><small>#{product.id}{product.salesMode === "PREORDER" ? " · Pré-venda" : ""}</small></span></button></td>
        <td>{getCategoryLabel(product.category)}</td><td><button className="apl-value" type="button" onClick={() => setQuickEdit({ id: product.id, field: "price", value: moneyInput(product.price) })}>{money(product.price)}<small>Editar</small></button></td>
        <td>{product.variants?.length ? <button className="apl-value" type="button" onClick={() => startEdit(product)}>{Number(product.stock ?? 0)}<small>Estoque do produto · editar</small></button> : <button className="apl-value" type="button" onClick={() => setQuickEdit({ id: product.id, field: "stock", value: String(product.stock ?? 0) })}>{Number(product.stock ?? 0)}<small>Editar</small></button>}</td>
        <td>{product.variants?.length ?? 0}<small className="apl-muted"> combinações</small></td><td><div className="apl-row-actions"><button type="button" onClick={() => startEdit(product)}>Editar</button><button type="button" className="apl-danger" onClick={async () => { if (!window.confirm(`Excluir “${product.name}”? A operação será recusada se houver referências em pedidos, reservas ou pré-venda.`)) return; try { await onDelete(product.id); } catch { setNotice("O produto não foi excluído. Ele pode estar vinculado a pedidos, reservas ou lotes."); } }}>Excluir</button></div></td>
        {quickEdit?.id === product.id ? <td colSpan={5}><form className="apl-quick" onSubmit={event => { event.preventDefault(); void saveQuick(); }}><label>{quickEdit.field === "price" ? "Novo preço (R$)" : "Novo estoque"}<input autoFocus type="text" inputMode={quickEdit.field === "price" ? "decimal" : "numeric"} value={quickEdit.value} onChange={event => setQuickEdit({ ...quickEdit, value: event.target.value })} /></label><button className="apl-primary" disabled={isSaving} type="submit">{isSaving ? "Salvando…" : "Confirmar"}</button><button className="apl-secondary" type="button" onClick={() => setQuickEdit(null)}>Cancelar</button></form></td> : null}
      </tr>)}</tbody></table></div>}
      {notice ? <p className="apl-notice" role="status">{notice}</p> : null}
    </> : <section className="apl-editor" aria-labelledby="apl-editor-title">
      <div className="apl-editor-heading"><div><span className="apl-kicker">{mode === "create" ? "Novo registro" : `Produto #${selectedProduct?.id ?? selectedId}`}</span><h3 id="apl-editor-title">{mode === "create" ? "Cadastrar produto" : "Editar produto"}</h3></div><button className="apl-secondary" type="button" onClick={cancelEdit}>Voltar à lista</button></div>
      <div className="apl-editor-grid"><div className="apl-form">
        <section className="apl-section"><h4>Informações básicas</h4><div className="apl-fields"><label>Nome<input value={draft.name} onChange={event => change("name", event.target.value)} /></label><label>Categoria<Select value={draft.category} onValueChange={value => change("category", value)}><SelectTrigger aria-label="Categoria"><SelectValue placeholder="Selecione" /></SelectTrigger><SelectContent position="popper" collisionPadding={12}>{PRODUCT_CATEGORIES.map(category => <SelectItem key={category.value} value={category.value}>{category.label}</SelectItem>)}</SelectContent></Select></label><label className="apl-wide">Descrição curta<textarea value={draft.description} onChange={event => change("description", event.target.value)} rows={3} /></label></div></section>
        <section className="apl-section"><h4>Preço, estoque e opções</h4><div className="apl-fields"><label>Preço base (R$)<input inputMode="decimal" value={draft.price} onChange={event => change("price", event.target.value)} /></label><label>Estoque agregado do produto<input type="number" min="0" step="1" value={draft.stock} readOnly={draft.variants.length > 0} onChange={event => change("stock", event.target.value)} /></label><label>Cores disponíveis<input value={draft.colors} onChange={event => change("colors", event.target.value)} placeholder="Preto, branco" /></label><label>Tamanhos disponíveis<input value={draft.sizes} onChange={event => change("sizes", event.target.value)} placeholder="P, M, G" /></label><label>Tipo de tamanho<Select value={draft.sizeType} onValueChange={value => change("sizeType", value as Draft["sizeType"])}><SelectTrigger aria-label="Tipo de tamanho"><SelectValue /></SelectTrigger><SelectContent position="popper" collisionPadding={12}><SelectItem value="alpha">Alfabético</SelectItem><SelectItem value="numeric">Numérico</SelectItem><SelectItem value="custom">Personalizado</SelectItem></SelectContent></Select></label></div><p className="apl-hint">Produtos simples usam o estoque do produto. Em produtos com variantes, o estoque agregado é calculado pelas combinações; cada variante é a fonte de disponibilidade.</p></section>
        <section className="apl-section"><div className="apl-gallery-head"><h4>Variantes por cor e tamanho</h4><button className="apl-secondary" type="button" onClick={addVariant}>Adicionar variante</button></div>{draft.variants.length ? <div className="apl-variant-editor">{draft.variants.map((variant, index) => { const persisted = selectedProduct?.variants?.find(row => row.id === variant.id); return <fieldset key={variant.id ?? `new-${index}`} className="apl-variant-card"><legend>{variant.id ? `Variante #${variant.id}` : "Nova variante"}{variant.isActive ? " · ativa" : " · inativa"}</legend><div className="apl-fields"><label>Cor<input value={variant.color} onChange={event => updateVariant(index, { color: event.target.value })} placeholder="Classifique manualmente" /></label><label>Tamanho<input value={variant.size} onChange={event => updateVariant(index, { size: event.target.value })} placeholder="Classifique manualmente" /></label><label>SKU<input value={variant.sku} onChange={event => updateVariant(index, { sku: event.target.value })} /></label><label>Preço específico (R$)<input inputMode="decimal" value={variant.price} onChange={event => updateVariant(index, { price: event.target.value })} placeholder="Vazio herda o preço base" /></label><label>Estoque<input type="number" min="0" step="1" value={variant.stock} onChange={event => updateVariant(index, { stock: event.target.value })} /></label><label className="apl-variant-active"><input type="checkbox" checked={variant.isActive} onChange={event => updateVariant(index, { isActive: event.target.checked })} /> Disponível para venda futura</label></div><small>{variant.color.trim() && variant.size.trim() ? "Combinação será canonicalizada pelo servidor." : "Legada sem classificação explícita; permanece inativa até revisão."}</small>{persisted ? <small>Referências preservadas: {persisted.historicalOrderReferences} item(ns) de pedido · {persisted.historicalReservationReferences} reserva(s).</small> : null}</fieldset>; })}</div> : <p className="apl-hint">Nenhuma combinação cadastrada. Nomes legados não são usados para inferir cor ou tamanho.</p>}<p className="apl-hint">Variantes removidas são desativadas e preservam IDs e referências históricas. A ativação pública ainda não habilita o checkout de variantes.</p></section>
        <section className="apl-section"><h4>Imagens</h4><div className="apl-image-main"><div className="apl-main-thumb">{draft.imageUrl ? <img src={imageSource(draft.imageThumbnailUrl || draft.imageUrl)} alt="Prévia da imagem principal" /> : <span>Sem imagem principal</span>}</div><div><strong>Imagem principal</strong><p className="apl-hint">A capa atual é usada pelo catálogo público. A remoção não está disponível no contrato; é possível substituí-la.</p><label className="apl-secondary apl-upload">{isUploading ? "Enviando…" : "Trocar imagem principal"}<input key={`cover-${fileNonce}`} type="file" accept="image/*" disabled={isUploading} onChange={event => { void addUploads(event.target.files, false); }} /></label></div></div><div className="apl-gallery-head"><strong>Galeria geral · ordem pública</strong><label className="apl-secondary apl-upload">{isUploading ? "Enviando…" : "Adicionar imagens"}<input key={`gallery-${fileNonce}`} type="file" accept="image/*" multiple disabled={isUploading} onChange={event => { void addUploads(event.target.files, true); }} /></label></div>{draft.images.length ? <ol className="apl-gallery">{draft.images.map((image, index) => <li key={`${image.imageUrl}-${index}`}><img src={image.imageThumbnailUrl || image.imageUrl} alt={image.alt || ""} /><div><strong>Imagem {index + 1}</strong><label>Cor associada<input value={image.color ?? ""} onChange={event => updateImage(index, { color: event.target.value || null })} placeholder="Opcional" /></label><label>Texto alternativo<input value={image.alt ?? ""} onChange={event => updateImage(index, { alt: event.target.value || null })} placeholder="Descrição da imagem" /></label></div><div className="apl-image-actions"><button type="button" disabled={index === 0} onClick={() => moveImage(index, -1)} aria-label={`Mover imagem ${index + 1} para cima`}>↑</button><button type="button" disabled={index === draft.images.length - 1} onClick={() => moveImage(index, 1)} aria-label={`Mover imagem ${index + 1} para baixo`}>↓</button><button type="button" className="apl-danger" onClick={() => change("images", draft.images.filter((_, at) => at !== index))}>Remover</button></div></li>)}</ol> : <p className="apl-hint">Nenhuma imagem adicional na galeria.</p>}<p className="apl-hint">A ordem é global. Ordenação independente por cor não faz parte do contrato atual; imagens por cor usam o campo de associação existente.</p></section>
        <footer className="apl-form-footer"><span>{notice || (mode === "create" ? "Os dados serão gravados pelo endpoint administrativo existente." : "Somente os campos alterados serão enviados." )}</span><div><button type="button" className="apl-secondary" onClick={cancelEdit}>Cancelar</button><button type="button" className="apl-primary" disabled={isSaving || isUploading} onClick={() => { void save(); }}>{isSaving ? "Salvando…" : mode === "create" ? "Criar produto" : "Salvar alterações"}</button></div></footer>
      </div><aside className="apl-preview"><h4>Resumo do produto</h4><div className="apl-preview-image">{draft.imageUrl ? <img src={imageSource(draft.imageDetailUrl || draft.imageUrl)} alt={draft.name ? `Prévia de ${draft.name}` : "Imagem do produto"} /> : <span>Imagem não informada</span>}</div><span>{draft.category ? getCategoryLabel(draft.category) : "Categoria não selecionada"}</span><strong>{draft.name || "Nome do produto"}</strong><b>{Number.isFinite(parseMoney(draft.price)) && parseMoney(draft.price) > 0 ? money(Math.round(parseMoney(draft.price) * 100)) : "Preço não informado"}</b><p>{draft.description || "Sem descrição curta."}</p><div className="apl-preview-options"><span>Cores: {splitList(draft.colors).join(", ") || "não informadas"}</span><span>Tamanhos: {splitList(draft.sizes).join(", ") || "não informados"}</span></div></aside></div>
    </section>}
  </div></AdminSurface>;
}

function AdminSurface({ children }: { children: ReactNode }) { return <section className="admin-surface admin-products-surface">{children}</section>; }
