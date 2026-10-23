import { Fragment, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import type { inferRouterInputs, inferRouterOutputs } from "@trpc/server";
import type { AppRouter } from "../../../../../server/routers";
import { PRODUCT_CATEGORIES, getCategoryLabel, normalizeCategoryValue } from "../../../lib/productCategories";
import { generateMissingVariantOptions } from "../../../utils/productVariantDrafts";
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
  isFetching: boolean;
  isError: boolean;
  onRetry: () => void;
  onRefreshProducts: () => Promise<Product[] | null>;
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
const optionIdentity = (value: string) => value.normalize("NFKC").trim().replace(/\s+/gu, " ").toLocaleLowerCase("pt-BR");
const knownColorSwatches: Record<string, string> = { preto: "#171717", branco: "#f3f3f3", verde: "#39734d", azul: "#35618e", "azul-marinho": "#182e4d", cinza: "#858585", vermelho: "#dc2626", vinho: "#702938", bege: "#c4b99c", marrom: "#654a3b", amarelo: "#e2bd3f", rosa: "#d97891", roxo: "#76509a", laranja: "#de7b32" };
const colorIdentity = (value: string) => optionIdentity(value).replace(/\s+/gu, "-");
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
function variantMatches(expected: NonNullable<UpdateInput["variants"]>[number], actual: NonNullable<Product["variants"]>[number]) {
  const identity = (value: string | null | undefined) => optionIdentity(value ?? "");
  return identity(expected.color) === identity(actual.color)
    && identity(expected.size) === identity(actual.size)
    && identity(expected.sku) === identity(actual.sku)
    && (expected.price ?? null) === (actual.price == null ? null : Number(actual.price))
    && Number(expected.stock) === Number(actual.stock)
    && Number(Boolean(expected.isActive)) === Number(actual.isActive);
}
function variantsMatch(expected: NonNullable<UpdateInput["variants"]>, actual: Product["variants"] | undefined) {
  if (!actual || expected.length !== actual.length) return false;
  const remaining = [...actual];
  return expected.every(variant => {
    const index = remaining.findIndex(candidate => variantMatches(variant, candidate));
    if (index < 0) return false;
    remaining.splice(index, 1);
    return true;
  });
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

export function AdminProductsPanel({ products = [], isLoading, isFetching, isError, onRetry, onRefreshProducts, isSaving, onCreate, onUpdate, onDelete, onUpload, isUploading, imageSource, initialSearch = "" }: Props) {
  const location = useLocation();
  const navigate = useNavigate();
  const productRoute = location.pathname.match(/^\/gestao\/catalogo\/produtos(?:\/(novo|\d+))?\/?$/);
  const isProductManagementRoute = Boolean(productRoute);
  const routeProductId = productRoute?.[1] && productRoute[1] !== "novo" ? Number(productRoute[1]) : null;
  const isNewProductRoute = productRoute?.[1] === "novo";
  const [search, setSearch] = useState(initialSearch);
  const [filter, setFilter] = useState<Filter>("all");
  const [mode, setMode] = useState<"list" | "create" | "edit">("list");
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [draft, setDraft] = useState<Draft>(blankDraft);
  const [dirty, setDirty] = useState<Set<string>>(new Set());
  const [quickEdit, setQuickEdit] = useState<{ id: number; field: "price" | "stock"; value: string } | null>(null);
  const [notice, setNotice] = useState("");
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [fileNonce, setFileNonce] = useState(0);
  const [previewColor, setPreviewColor] = useState("");
  const [previewSize, setPreviewSize] = useState("");
  const hydratedPath = useRef("");
  const saveInFlight = useRef(false);

  const selectedProduct = products.find(product => product.id === selectedId) ?? null;
  useEffect(() => {
    const routeKey = location.pathname;
    if (!productRoute) return;
    if (isNewProductRoute) {
      if (hydratedPath.current !== routeKey) {
        setDraft(blankDraft());
        setDirty(new Set());
        setSelectedId(null);
        setPreviewColor("");
        setPreviewSize("");
        setMode("create");
        setNotice("");
        setFieldErrors({});
        hydratedPath.current = routeKey;
      }
      return;
    }
    if (routeProductId !== null) {
      if (isLoading || isFetching || isError) return;
      if (hydratedPath.current === routeKey) return;
      const product = products.find(row => row.id === routeProductId);
      if (product) {
        setDraft(draftFrom(product));
        setDirty(new Set());
        setSelectedId(product.id);
        setPreviewColor("");
        setPreviewSize("");
        setMode("edit");
        setNotice("");
        hydratedPath.current = routeKey;
      } else if (!isLoading && !isFetching && !isError) {
        setMode("list");
        setNotice("Produto não encontrado ou indisponível para esta conta.");
        hydratedPath.current = routeKey;
      }
      return;
    }
    if (hydratedPath.current !== routeKey) {
      setMode("list");
      setSelectedId(null);
      setDirty(new Set());
      hydratedPath.current = routeKey;
    }
  }, [isError, isFetching, isLoading, location.pathname, isProductManagementRoute, isNewProductRoute, products, routeProductId]);
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

  const startCreate = () => { setDraft(blankDraft()); setDirty(new Set()); setSelectedId(null); setPreviewColor(""); setPreviewSize(""); setMode("create"); setNotice(""); navigate("/gestao/catalogo/produtos/novo"); };
  const startEdit = (product: Product) => { setDraft(draftFrom(product)); setDirty(new Set()); setSelectedId(product.id); setPreviewColor(""); setPreviewSize(""); setMode("edit"); setNotice(""); navigate(`/gestao/catalogo/produtos/${product.id}`); };
  const cancelEdit = () => {
    if (dirty.size > 0 && !window.confirm("Há alterações não salvas. Sair sem salvar?")) return;
    setMode("list"); setSelectedId(null); setDirty(new Set()); setNotice(""); navigate("/gestao/catalogo/produtos");
  };
  const change = <K extends keyof Draft>(field: K, value: Draft[K]) => {
    setDraft(previous => ({ ...previous, [field]: value }));
    setDirty(previous => new Set(previous).add(field));
    setFieldErrors(previous => { const next = { ...previous }; delete next[String(field)]; return next; });
  };
  const updateImage = (index: number, patch: Partial<DraftImage>) => change("images", draft.images.map((image, current) => current === index ? { ...image, ...patch } : image));
  const updateVariant = (index: number, patch: Partial<DraftVariant>) => {
    change("variants", draft.variants.map((variant, current) => current === index ? { ...variant, ...patch } : variant));
    setFieldErrors(previous => {
      const next = { ...previous };
      for (const field of Object.keys(patch)) delete next[`variants.${index}.${field}`];
      return next;
    });
  };
  const addVariant = () => change("variants", [...draft.variants, { name: "", color: "", size: "", sku: "", price: "", stock: "0", isActive: false }]);
  const generateMissingVariants = () => {
    const colors = splitList(draft.colors);
    const sizes = splitList(draft.sizes);
    if (!colors.length || !sizes.length) {
      setNotice("Informe ao menos uma cor e um tamanho para gerar as combinações.");
      return;
    }
    let additions: DraftVariant[];
    try {
      additions = generateMissingVariantOptions(colors, sizes, draft.variants)
        .map(({ color, size }) => ({ name: `${color} / ${size}`, color, size, sku: "", price: "", stock: "0", isActive: false }));
    } catch {
      setNotice("A combinação excede 1.000 linhas. Reduza as opções antes de gerar.");
      return;
    }
    if (!additions.length) {
      setNotice("Todas as combinações já existem. Revise cada SKU, estoque e estado.");
      return;
    }
    change("variants", [...draft.variants, ...additions]);
    setNotice(`${additions.length} combinação(ões) adicionada(s) como inativas. Preencha SKU e estoque; aprove cada uma explicitamente.`);
  };
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
    if (saveInFlight.current || isSaving || isUploading) return;
    saveInFlight.current = true;
    setFieldErrors({});
    const amount = parseMoney(draft.price);
    const stock = Number(draft.stock);
    const errors: Record<string, string> = {};
    if (!draft.name.trim()) errors.name = "Informe o nome do produto.";
    if (!draft.category) errors.category = "Selecione uma categoria.";
    if (!draft.price.trim() || !Number.isFinite(amount) || amount <= 0) errors.price = "Informe um preço maior que zero.";
    if (!Number.isInteger(stock) || stock < 0) errors.stock = "Informe um estoque inteiro igual ou maior que zero.";
    draft.variants.forEach((variant, index) => {
      if ((mode === "create" || variant.isActive || variant.id === undefined) && !variant.color.trim()) errors[`variants.${index}.color`] = "Informe a cor desta combinação.";
      if ((mode === "create" || variant.isActive || variant.id === undefined) && !variant.size.trim()) errors[`variants.${index}.size`] = "Informe o tamanho desta combinação.";
      if ((mode === "create" || variant.isActive || variant.id === undefined) && !variant.sku.trim()) errors[`variants.${index}.sku`] = "Informe um SKU único para esta combinação.";
      if (variant.sku.length > 120) errors[`variants.${index}.sku`] = "O SKU deve ter até 120 caracteres.";
      if (!Number.isInteger(Number(variant.stock)) || Number(variant.stock) < 0) errors[`variants.${index}.stock`] = "Use um estoque inteiro igual ou maior que zero.";
      if (variant.price.trim() && (!Number.isFinite(parseMoney(variant.price)) || parseMoney(variant.price) < 0)) errors[`variants.${index}.price`] = "Informe um preço não negativo ou deixe vazio para herdar o preço base.";
    });
    if (Object.keys(errors).length) {
      setFieldErrors(errors);
      setNotice("Revise os campos indicados antes de salvar.");
      saveInFlight.current = false;
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
        if (draft.variants.some(variant => variant.isActive) && !window.confirm("Há variantes marcadas para aprovação no catálogo público. Confirme que identidade, preço e estoque foram revisados.")) return;
        const createInput: CreateInput = {
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
        };
        const result = await onCreate(createInput) as { success?: boolean; productId?: number; variantCount?: number };
        if (result?.success !== true || !Number.isSafeInteger(result.productId) || Number(result.productId) <= 0) {
          throw new Error("A API não confirmou a criação do produto. O formulário foi mantido para revisão.");
        }
        const productId = Number(result.productId);
        const route = `/gestao/catalogo/produtos/${productId}`;
        const refreshed = await onRefreshProducts();
        const persisted = refreshed?.find(product => product.id === productId);
        setMode("edit"); setSelectedId(productId); setDirty(new Set());
        hydratedPath.current = route;
        if (persisted) {
          const expectedVariants = createInput.variants ?? [];
          const fieldsMatch = Number(persisted.price) === createInput.price
            && Number(persisted.stock) === createInput.stock
            && (result.variantCount === expectedVariants.length)
            && variantsMatch(expectedVariants, persisted.variants);
          setDraft(draftFrom(persisted));
          setNotice(fieldsMatch
            ? `Produto #${productId} criado com sucesso e confirmado na leitura do catálogo.`
            : `A API criou o produto #${productId}, mas a leitura atual diverge dos dados enviados. Revise antes de qualquer nova tentativa.`);
        } else {
          setDraft(previous => ({ ...previous, ...draft }));
          setNotice(`Produto #${productId} criado com sucesso pela API. A lista ainda não confirmou a leitura; atualize o catálogo antes de continuar.`);
        }
        navigate(route);
        return;
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
        const result = await onUpdate(update) as { success?: boolean; variants?: Product["variants"] };
        if (update.variants && !variantsMatch(update.variants, result?.variants)) {
          setNotice("A API não confirmou todas as variantes gravadas. O editor permanece aberto; recarregue o produto antes de tentar novamente.");
          return;
        }
        const refreshed = await onRefreshProducts();
        const freshProduct = refreshed?.find(product => product.id === selectedId);
        if (update.variants && !variantsMatch(update.variants, freshProduct?.variants)) {
          setNotice("A leitura nova do catálogo diverge das variantes enviadas. Nenhum sucesso foi exibido; confira os dados antes de continuar.");
          return;
        }
        setMode("list"); setSelectedId(null); setDirty(new Set());
        setNotice(refreshed ? "Produto atualizado e conferido na lista atualizada." : "Produto salvo, mas a lista não confirmou a leitura. Atualize o catálogo antes de continuar.");
        navigate("/gestao/catalogo/produtos");
        return;
      }
      setMode("list"); setSelectedId(null); setDirty(new Set());
      setNotice("Não foi possível identificar o produto a atualizar.");
      navigate("/gestao/catalogo/produtos");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Não foi possível salvar as alterações.");
    } finally {
      saveInFlight.current = false;
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
    try {
      await onUpdate(update);
      const refreshed = await onRefreshProducts();
      setQuickEdit(null);
      setNotice(refreshed ? "Alteração salva e catálogo atualizado." : "Alteração salva, mas a lista não confirmou a leitura. Atualize o catálogo.");
    }
    catch { setNotice("A alteração não foi salva. O estoque pode estar protegido por reservas ativas."); }
  };

  const filterItems: Array<{ key: Filter; label: string }> = [
    { key: "all", label: "Todos" }, { key: "withStock", label: "Com estoque" },
    { key: "outOfStock", label: "Sem estoque" }, { key: "lowStock", label: "Estoque baixo" },
    { key: "withoutImage", label: "Sem imagem" }, { key: "withVariants", label: "Com variantes" },
  ];
  const previewBasePrice = parseMoney(draft.price);
  const previewVariants = draft.variants.map(variant => ({
    ...variant,
    inheritsBasePrice: !variant.price.trim(),
    previewPriceCents: variant.price.trim()
      ? Math.round(parseMoney(variant.price) * 100)
      : Number.isFinite(previewBasePrice) ? Math.round(previewBasePrice * 100) : null,
  }));
  const previewColors = splitList(draft.colors).length
    ? splitList(draft.colors)
    : [...new Set(draft.variants.map(variant => variant.color).filter(Boolean))];
  const previewSizes = splitList(draft.sizes).length
    ? splitList(draft.sizes)
    : [...new Set(draft.variants.map(variant => variant.size).filter(Boolean))];
  const selectedPreviewColor = previewColors.includes(previewColor) ? previewColor : previewColors[0] ?? "";
  const selectedPreviewSize = previewSizes.includes(previewSize) ? previewSize : previewSizes[0] ?? "";
  const selectedPreviewVariant = previewVariants.find(variant =>
    optionIdentity(variant.color) === optionIdentity(selectedPreviewColor) &&
    optionIdentity(variant.size) === optionIdentity(selectedPreviewSize),
  );
  const selectedColorImage = draft.images.find(image => image.color && optionIdentity(image.color) === optionIdentity(selectedPreviewColor));
  const previewImage = selectedColorImage?.imageDetailUrl || selectedColorImage?.imageUrl || draft.imageDetailUrl || draft.imageUrl || draft.images[0]?.imageDetailUrl || draft.images[0]?.imageUrl;
  const errorFor = (key: string) => fieldErrors[key]
    ? <small className="apl-field-error" id={`apl-error-${key.replace(/[^a-z0-9_-]/giu, "-")}`} role="alert">{fieldErrors[key]}</small>
    : null;

  return <AdminSurface><div className="admin-products-live">
    {mode === "list" ? <header className="apl-heading"><div><span className="apl-kicker">Operação · Catálogo</span><h2>Produtos e estoque</h2><p>Gerencie o catálogo e os níveis de estoque registrados.</p></div><button className="apl-primary" type="button" onClick={startCreate}>Novo produto</button></header> : null}
    {mode === "list" ? <>
      <div className="apl-metrics" role="group" aria-label="Filtros rápidos do catálogo">
        {filterItems.map(item => <button type="button" key={item.key} className={filter === item.key ? "is-active" : ""} aria-pressed={filter === item.key} onClick={() => setFilter(item.key)}><strong>{counts[item.key]}</strong><span>{item.label}</span></button>)}
      </div>
      <div className="apl-toolbar"><label className="apl-search"><span aria-hidden="true">⌕</span><input aria-label="Buscar produtos por nome, categoria, código ou variante" placeholder="Buscar produto, categoria, ID ou SKU" value={search} onChange={event => setSearch(event.target.value)} />{search ? <button type="button" aria-label="Limpar busca" onClick={() => setSearch("")}>×</button> : null}</label><span className="apl-count" aria-live="polite">{filteredProducts.length} de {products.length} produtos</span></div>
      {isLoading || isFetching ? <p className="apl-state" role="status">{isLoading ? "Carregando catálogo…" : "Atualizando catálogo…"}</p> : isError ? <div className="apl-state apl-error" role="alert"><p>Não foi possível carregar os produtos.</p><button className="apl-secondary" type="button" onClick={onRetry}>Tentar novamente</button></div> : products.length === 0 ? <p className="apl-state">Nenhum produto cadastrado.</p> : filteredProducts.length === 0 ? <p className="apl-state">Nenhum produto corresponde à busca e aos filtros.</p> : <div className="apl-table-wrap"><table className="apl-table"><thead><tr><th>Produto</th><th>Categoria</th><th>Preço</th><th>Estoque</th><th>Estado</th><th>Variantes</th><th>Ações</th></tr></thead><tbody>{filteredProducts.map(product => {
        const variants = product.variants ?? [];
        const approvedVariants = variants.filter(variant => Number(variant.isActive) === 1).length;
        return <Fragment key={product.id}><tr>
        <td data-label="Produto"><button type="button" className="apl-product" onClick={() => startEdit(product)}><span className="apl-thumb">{product.imageUrl ? <img src={imageSource(product.imageUrl)} alt="" /> : <span>Sem imagem</span>}</span><span><strong>{product.name}</strong><small className="apl-product-id">#{product.id}</small></span></button></td>
        <td data-label="Categoria">{getCategoryLabel(product.category)}</td><td data-label="Preço"><button className="apl-value" type="button" onClick={() => setQuickEdit({ id: product.id, field: "price", value: moneyInput(product.price) })}>{money(product.price)}<small>Editar</small></button></td>
        <td data-label="Estoque">{variants.length ? <button className="apl-value" type="button" onClick={() => startEdit(product)}>{Number(product.stock ?? 0)}<small>Estoque agregado · editar variantes</small></button> : <button className="apl-value" type="button" onClick={() => setQuickEdit({ id: product.id, field: "stock", value: String(product.stock ?? 0) })}>{Number(product.stock ?? 0)}<small>Editar</small></button>}</td>
        <td data-label="Estado"><div className="apl-status-stack"><span className="apl-state-chip">{product.salesMode === "PREORDER" ? "Pré-venda" : "Estoque"}</span><small>{variants.length ? `${approvedVariants} aprovadas · ${variants.length - approvedVariants} inativas` : Number(product.stock ?? 0) > 0 ? "Com estoque" : "Sem estoque"}</small></div></td>
        <td data-label="Variantes">{variants.length ? <button type="button" className="apl-variant-count" onClick={() => setFilter("withVariants")} aria-label={`Filtrar produtos com variantes; ${variants.length} combinações em ${product.name}`}><strong>{variants.length}</strong><span>combinações</span></button> : <span className="apl-muted">Sem variantes</span>}</td>
        <td data-label="Ações"><div className="apl-row-actions"><button type="button" onClick={() => startEdit(product)}>Editar</button><button type="button" className="apl-danger" onClick={async () => { if (!window.confirm(`Excluir “${product.name}”? A operação será recusada se houver referências em pedidos, reservas ou pré-venda.`)) return; try { await onDelete(product.id); } catch { setNotice("O produto não foi excluído. Ele pode estar vinculado a pedidos, reservas ou lotes."); } }}>Excluir</button></div></td>
      </tr>{quickEdit?.id === product.id ? <tr className="apl-quick-row"><td colSpan={7}><form className="apl-quick" onSubmit={event => { event.preventDefault(); void saveQuick(); }}><label>{quickEdit.field === "price" ? "Novo preço (R$)" : "Novo estoque"}<input autoFocus type="text" inputMode={quickEdit.field === "price" ? "decimal" : "numeric"} value={quickEdit.value} onChange={event => setQuickEdit({ ...quickEdit, value: event.target.value })} /></label><button className="apl-primary" disabled={isSaving} type="submit">{isSaving ? "Salvando…" : "Confirmar"}</button><button className="apl-secondary" type="button" onClick={() => setQuickEdit(null)}>Cancelar</button></form></td></tr> : null}</Fragment>; })}</tbody></table></div>}
      {notice ? <p className="apl-notice" role="status">{notice}</p> : null}
    </> : <section className="apl-editor" aria-labelledby="apl-editor-title">
      <div className="apl-editor-heading"><div><span className="apl-kicker">{mode === "create" ? "Novo registro" : `Produto #${selectedProduct?.id ?? selectedId}`}</span><h3 id="apl-editor-title">{mode === "create" ? "Cadastrar produto" : "Editar produto"}</h3></div><button className="apl-secondary" type="button" onClick={cancelEdit}>Voltar à lista</button></div>
      <div className="apl-editor-grid"><div className="apl-form">
        <section className="apl-section"><h4>Informações básicas</h4><div className="apl-fields"><label>Nome<input value={draft.name} aria-invalid={Boolean(fieldErrors.name)} aria-describedby={fieldErrors.name ? "apl-error-name" : undefined} onChange={event => change("name", event.target.value)} />{errorFor("name")}</label><label>Categoria<select className="apl-native-select" aria-label="Categoria" value={draft.category} aria-invalid={Boolean(fieldErrors.category)} aria-describedby={fieldErrors.category ? "apl-error-category" : undefined} onChange={event => change("category", event.target.value)}><option value="">Selecione uma categoria</option>{PRODUCT_CATEGORIES.map(category => <option key={category.value} value={category.value}>{category.label}</option>)}</select>{errorFor("category")}</label><label className="apl-wide">Descrição curta<textarea value={draft.description} onChange={event => change("description", event.target.value)} rows={3} /></label></div></section>
        <section className="apl-section"><h4>Preço, estoque e opções</h4><div className="apl-fields"><label>Preço base (R$)<input inputMode="decimal" value={draft.price} aria-invalid={Boolean(fieldErrors.price)} aria-describedby={fieldErrors.price ? "apl-error-price" : undefined} onChange={event => change("price", event.target.value)} />{errorFor("price")}</label><label>Estoque agregado do produto<input type="number" min="0" step="1" value={draft.stock} readOnly={draft.variants.length > 0} aria-invalid={Boolean(fieldErrors.stock)} aria-describedby={fieldErrors.stock ? "apl-error-stock" : undefined} onChange={event => change("stock", event.target.value)} />{errorFor("stock")}</label><label>Cores disponíveis<input value={draft.colors} onChange={event => change("colors", event.target.value)} placeholder="Preto, branco" /></label><label>Tamanhos disponíveis<input value={draft.sizes} onChange={event => change("sizes", event.target.value)} placeholder="P, M, G" /></label><label>Tipo de tamanho<select className="apl-native-select" aria-label="Tipo de tamanho" value={draft.sizeType} onChange={event => change("sizeType", event.target.value as Draft["sizeType"])}><option value="alpha">Alfabético</option><option value="numeric">Numérico</option><option value="custom">Personalizado</option></select></label></div><p className="apl-hint">Produtos simples usam o estoque do produto. Em produtos com variantes, o estoque agregado é calculado pelas combinações; cada variante é a fonte de disponibilidade.</p></section>
        <section className="apl-section"><div className="apl-gallery-head"><h4>Variantes por cor e tamanho</h4><div className="apl-variant-actions"><button className="apl-secondary" type="button" onClick={generateMissingVariants}>Gerar combinações ausentes</button><button className="apl-secondary" type="button" onClick={addVariant}>Adicionar variante</button></div></div>{draft.variants.length ? <div className="apl-variant-editor">{draft.variants.map((variant, index) => { const persisted = selectedProduct?.variants?.find(row => row.id === variant.id); return <fieldset key={variant.id ?? `new-${index}`} className={`apl-variant-card${variant.isActive ? " is-approved" : " is-inactive"}`}><legend>{variant.id ? `Variante #${variant.id}` : "Nova variante"}{variant.isActive ? " · aprovada" : " · inativa"}</legend><div className="apl-fields"><label>Cor<input value={variant.color} aria-invalid={Boolean(fieldErrors[`variants.${index}.color`])} aria-describedby={fieldErrors[`variants.${index}.color`] ? `apl-error-variants-${index}-color` : undefined} onChange={event => updateVariant(index, { color: event.target.value })} placeholder="Informe a cor" />{errorFor(`variants.${index}.color`)}</label><label>Tamanho<input value={variant.size} aria-invalid={Boolean(fieldErrors[`variants.${index}.size`])} aria-describedby={fieldErrors[`variants.${index}.size`] ? `apl-error-variants-${index}-size` : undefined} onChange={event => updateVariant(index, { size: event.target.value })} placeholder="Informe o tamanho" />{errorFor(`variants.${index}.size`)}</label><label>SKU<input value={variant.sku} aria-invalid={Boolean(fieldErrors[`variants.${index}.sku`])} aria-describedby={fieldErrors[`variants.${index}.sku`] ? `apl-error-variants-${index}-sku` : undefined} onChange={event => updateVariant(index, { sku: event.target.value })} />{errorFor(`variants.${index}.sku`)}</label><label>Preço específico (R$)<input inputMode="decimal" value={variant.price} aria-invalid={Boolean(fieldErrors[`variants.${index}.price`])} aria-describedby={fieldErrors[`variants.${index}.price`] ? `apl-error-variants-${index}-price` : undefined} onChange={event => updateVariant(index, { price: event.target.value })} placeholder="Vazio herda o preço base" />{errorFor(`variants.${index}.price`)}</label><label>Estoque<input type="number" min="0" step="1" value={variant.stock} aria-invalid={Boolean(fieldErrors[`variants.${index}.stock`])} aria-describedby={fieldErrors[`variants.${index}.stock`] ? `apl-error-variants-${index}-stock` : undefined} onChange={event => updateVariant(index, { stock: event.target.value })} />{errorFor(`variants.${index}.stock`)}</label><label className="apl-variant-active"><input type="checkbox" checked={variant.isActive} onChange={event => updateVariant(index, { isActive: event.target.checked })} /> Aprovar para catálogo público</label></div><small>{variant.isActive ? "Aprovada explicitamente; ficará visível quando houver estoque e o checkout estiver habilitado." : "Inativa: aparece nesta revisão administrativa, mas não é oferecida na loja."}</small>{persisted ? <small>Referências preservadas: {persisted.historicalOrderReferences} item(ns) de pedido · {persisted.historicalReservationReferences} reserva(s).</small> : null}</fieldset>; })}</div> : <p className="apl-hint">Nenhuma combinação cadastrada. Gere rascunhos a partir das cores e tamanhos ou adicione uma variante manualmente.</p>}<p className="apl-hint">Combinações geradas começam inativas, com estoque zero e SKU pendente. Variantes históricas inativas permanecem inalteradas até aprovação explícita.</p></section>
        <section className="apl-section"><h4>Imagens</h4><div className="apl-image-main"><div className="apl-main-thumb">{draft.imageUrl ? <img src={imageSource(draft.imageThumbnailUrl || draft.imageUrl)} alt="Prévia da imagem principal" /> : <span>Sem imagem principal</span>}</div><div><strong>Imagem principal</strong><p className="apl-hint">A capa atual é usada pelo catálogo público. A remoção não está disponível no contrato; é possível substituí-la.</p><label className="apl-secondary apl-upload">{isUploading ? "Enviando…" : "Trocar imagem principal"}<input key={`cover-${fileNonce}`} type="file" accept="image/*" disabled={isUploading} onChange={event => { void addUploads(event.target.files, false); }} /></label></div></div><div className="apl-gallery-head"><strong>Galeria geral · ordem pública</strong><label className="apl-secondary apl-upload">{isUploading ? "Enviando…" : "Adicionar imagens"}<input key={`gallery-${fileNonce}`} type="file" accept="image/*" multiple disabled={isUploading} onChange={event => { void addUploads(event.target.files, true); }} /></label></div>{draft.images.length ? <ol className="apl-gallery">{draft.images.map((image, index) => <li key={`${image.imageUrl}-${index}`}><img src={image.imageThumbnailUrl || image.imageUrl} alt={image.alt || ""} /><div><strong>Imagem {index + 1}</strong><label>Cor associada<input value={image.color ?? ""} onChange={event => updateImage(index, { color: event.target.value || null })} placeholder="Opcional" /></label><label>Texto alternativo<input value={image.alt ?? ""} onChange={event => updateImage(index, { alt: event.target.value || null })} placeholder="Descrição da imagem" /></label></div><div className="apl-image-actions"><button type="button" disabled={index === 0} onClick={() => moveImage(index, -1)} aria-label={`Mover imagem ${index + 1} para cima`}>↑</button><button type="button" disabled={index === draft.images.length - 1} onClick={() => moveImage(index, 1)} aria-label={`Mover imagem ${index + 1} para baixo`}>↓</button><button type="button" className="apl-danger" onClick={() => change("images", draft.images.filter((_, at) => at !== index))}>Remover</button></div></li>)}</ol> : <p className="apl-hint">Nenhuma imagem adicional na galeria.</p>}<p className="apl-hint">A ordem é global. Ordenação independente por cor não faz parte do contrato atual; imagens por cor usam o campo de associação existente.</p></section>
        <footer className="apl-form-footer"><span className={notice.includes("com sucesso") ? "apl-success-message" : "apl-notice"} role="status" aria-live="polite">{notice || (mode === "create" ? "Preencha os campos obrigatórios para criar o produto." : "Somente os campos alterados serão enviados.")}</span><div><button type="button" className="apl-secondary" disabled={isSaving || isUploading} onClick={cancelEdit}>Cancelar</button><button type="button" className="apl-primary" disabled={isSaving || isUploading} onClick={() => { void save(); }}>{isSaving ? (mode === "create" ? "Criando…" : "Salvando…") : mode === "create" ? "Criar produto" : "Salvar alterações"}</button></div></footer>
      </div><aside className="apl-preview" aria-label="Prévia atual do produto"><h4>Prévia da loja</h4><div className="apl-preview-image">{previewImage ? <img src={imageSource(previewImage)} alt={draft.name ? `Prévia de ${draft.name}${selectedPreviewColor ? ` na cor ${selectedPreviewColor}` : ""}` : "Imagem do produto"} /> : <span>Imagem não informada</span>}</div><span>{draft.category ? getCategoryLabel(draft.category) : "Categoria não selecionada"}</span><strong>{draft.name || "Nome do produto"}</strong><b>{selectedPreviewVariant && selectedPreviewVariant.previewPriceCents !== null && Number.isSafeInteger(selectedPreviewVariant.previewPriceCents) && selectedPreviewVariant.previewPriceCents >= 0 ? money(selectedPreviewVariant.previewPriceCents) : Number.isFinite(previewBasePrice) && previewBasePrice > 0 ? money(Math.round(previewBasePrice * 100)) : "Preço não informado"}</b><p>{draft.description || "Sem descrição curta."}</p><div className="apl-preview-control"><strong>Cores</strong><div role="group" aria-label="Prévia das cores">{previewColors.length ? previewColors.map(color => <button key={color} type="button" aria-pressed={selectedPreviewColor === color} onClick={() => setPreviewColor(color)}><i style={{ backgroundColor: knownColorSwatches[colorIdentity(color)] ?? "#555" }} aria-hidden="true" />{color}</button>) : <small>Não informadas</small>}</div></div><div className="apl-preview-control"><strong>Tamanhos</strong><div role="group" aria-label="Prévia dos tamanhos">{previewSizes.length ? previewSizes.map(size => <button key={size} type="button" aria-pressed={selectedPreviewSize === size} onClick={() => setPreviewSize(size)}>{size}</button>) : <small>Não informados</small>}</div></div><div className="apl-preview-selected" aria-live="polite">{draft.variants.length ? selectedPreviewVariant ? <><strong>{selectedPreviewVariant.color} / {selectedPreviewVariant.size}</strong><span>SKU {selectedPreviewVariant.sku || "pendente"} · estoque {selectedPreviewVariant.stock || "0"}</span><span>{selectedPreviewVariant.inheritsBasePrice ? "Preço herdado do produto" : "Preço específico da variante"}</span><b className={selectedPreviewVariant.isActive ? "is-active" : "is-inactive"}>{selectedPreviewVariant.isActive ? "Aprovada para o catálogo público" : "Inativa · visível somente na gestão"}</b></> : <strong>Combinação ainda não cadastrada</strong> : <span>Produto sem estoque por combinação; opções usam o estoque geral.</span>}</div><div className="apl-preview-variants"><div className="apl-preview-variants-heading"><strong>Revisão das combinações cadastradas</strong><span>{previewVariants.filter(variant => variant.isActive).length} aprovadas · {previewVariants.filter(variant => !variant.isActive).length} inativas</span></div>{previewVariants.length ? <ul>{previewVariants.map((variant, index) => <li key={variant.id ?? `preview-${index}`}><span><strong>{variant.color || "Cor pendente"} / {variant.size || "Tamanho pendente"}</strong><small>SKU {variant.sku || "pendente"} · Estoque {variant.stock || "0"}</small></span><span><b>{variant.previewPriceCents !== null && Number.isSafeInteger(variant.previewPriceCents) && variant.previewPriceCents >= 0 ? money(variant.previewPriceCents) : "Preço pendente"}</b><small>{variant.inheritsBasePrice ? "Herdado do produto" : "Preço específico"}</small><small className={variant.isActive ? "is-active" : "is-inactive"}>{variant.isActive ? "Aprovada" : "Inativa"}</small></span></li>)}</ul> : <p className="apl-hint">Sem combinações cadastradas. Gere rascunhos para conferir cor, tamanho, preço, estoque e aprovação.</p>}</div></aside></div>
    </section>}
  </div></AdminSurface>;
}

function AdminSurface({ children }: { children: ReactNode }) { return <section className="admin-surface admin-products-surface">{children}</section>; }
