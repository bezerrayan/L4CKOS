import { useMemo, useRef, useState } from "react";
import type { CSSProperties } from "react";
import { apiUrl } from "../../const";
import { csrfFetch } from "../../lib/csrf";
import { trpc } from "../../lib/trpc";
import {
  PRODUCT_CATEGORIES,
  getCategoryLabel,
  normalizeCategoryValue,
} from "../../lib/productCategories";
import { useToast } from "../../contexts/ToastContext";
import { useUser } from "../../contexts/UserContext";
import { AdminSurface } from "../../components/admin/AdminUI";
import {
  AdminProductsUI,
  ProductsFilters,
  ProductsSummaryCards,
  type ProductListFilter,
} from "../../components/admin/products/AdminProductsUI";
import { ProductOptionsInventoryEditor } from "../../components/admin/products/ProductOptionsInventoryEditor";

const productColorSuggestions = [
  "preto",
  "branco",
  "verde",
  "azul-marinho",
  "cinza",
  "caqui",
] as const;
const alphaSizeSuggestions = ["PP", "P", "M", "G", "GG", "XG"] as const;
const numericSizeSuggestions = ["36", "38", "40", "42", "44", "46"] as const;
const emptyProductForm = {
  name: "",
  category: "",
  price: "",
  stock: "0",
  imageUrl: "",
  imagesCsv: "",
  galleryColor: "",
  colorsCsv: "",
  sizesCsv: "",
  sizeType: "alpha",
  variantsCsv: "",
  description: "",
};

function resolveAdminImageUrl(imageUrl?: string | null) {
  if (!imageUrl) return "";
  if (
    imageUrl.startsWith("http://") ||
    imageUrl.startsWith("https://") ||
    imageUrl.startsWith("data:")
  ) {
    return imageUrl;
  }
  if (imageUrl.startsWith("/")) {
    return apiUrl(imageUrl);
  }
  return apiUrl(`/${imageUrl}`);
}

function normalizeAdminImageValue(imageUrl?: string | null) {
  const value = String(imageUrl ?? "").trim();
  if (!value) return "";
  return resolveAdminImageUrl(value);
}

function centsToMoneyInput(cents: number | null | undefined) {
  if (cents === null || cents === undefined) return "";
  return (Number(cents) / 100).toFixed(2);
}

function parseMoneyToCents(raw: string) {
  const cleaned = raw.trim().replace(/[^\d.,-]/g, "");
  if (!cleaned) return NaN;

  let normalized = cleaned;
  if (normalized.includes(",") && normalized.includes(".")) {
    normalized = normalized.replace(/\./g, "").replace(",", ".");
  } else if (normalized.includes(",")) {
    normalized = normalized.replace(",", ".");
  }

  const value = Number(normalized);
  if (!Number.isFinite(value)) return NaN;
  return Math.round(value * 100);
}

function joinCsvUrls(currentValue: string, urls: string[]) {
  const merged = [
    ...currentValue
      .split(",")
      .map(item => item.trim())
      .filter(Boolean),
    ...urls,
  ];

  return Array.from(new Set(merged)).join(", ");
}

function formatImageCsvEntry(imageUrl: string, color?: string | null) {
  const normalizedUrl = normalizeAdminImageValue(imageUrl);
  const normalizedColor = String(color ?? "").trim();
  return normalizedColor
    ? `${normalizedUrl}|${normalizedColor}`
    : normalizedUrl;
}

function parseImageCsvEntries(raw: string) {
  return raw
    .split(",")
    .map(item => item.trim())
    .filter(Boolean)
    .map(item => {
      const [imageUrlRaw, colorRaw] = item
        .split("|")
        .map(part => part?.trim() ?? "");
      const imageUrl = normalizeAdminImageValue(imageUrlRaw);
      return {
        imageUrl,
        color: colorRaw || null,
      };
    })
    .filter(item => item.imageUrl);
}

function joinImageCsvEntries(
  currentValue: string,
  urls: string[],
  color?: string | null
) {
  const current = parseImageCsvEntries(currentValue).map(item =>
    formatImageCsvEntry(item.imageUrl, item.color)
  );
  const incoming = urls.map(url => formatImageCsvEntry(url, color));
  return Array.from(new Set([...current, ...incoming])).join(", ");
}

function removeImageCsvEntry(currentValue: string, targetUrl: string) {
  return parseImageCsvEntries(currentValue)
    .filter(item => item.imageUrl !== targetUrl)
    .map(item => formatImageCsvEntry(item.imageUrl, item.color))
    .join(", ");
}

function moveImageCsvEntryToCover(
  currentValue: string,
  targetUrl: string,
  currentCover: string
) {
  const entries = parseImageCsvEntries(currentValue);
  const picked = entries.find(item => item.imageUrl === targetUrl);
  if (!picked) {
    return {
      imageUrl: currentCover,
      imagesCsv: currentValue,
    };
  }

  const nextEntries = entries.filter(item => item.imageUrl !== targetUrl);
  const normalizedCurrentCover = normalizeAdminImageValue(currentCover);
  if (normalizedCurrentCover && normalizedCurrentCover !== targetUrl) {
    nextEntries.unshift({ imageUrl: normalizedCurrentCover, color: null });
  }

  return {
    imageUrl: targetUrl,
    imagesCsv: nextEntries
      .map(item => formatImageCsvEntry(item.imageUrl, item.color))
      .join(", "),
  };
}

function resolveVariantOptions(
  name: string,
  colors: string[],
  sizes: string[]
) {
  const normalizedName = name.trim().toLocaleLowerCase("pt-BR");
  const matches = (option: string) => {
    const normalized = option.trim().toLocaleLowerCase("pt-BR");
    return (
      normalizedName === normalized ||
      normalizedName.endsWith(` ${normalized}`) ||
      normalizedName.includes(` ${normalized} `)
    );
  };
  return {
    color: colors.find(matches) ?? null,
    size: sizes.find(matches) ?? null,
  };
}

function getStoredProductOptions(
  serialized: string | null | undefined,
  variants: Array<{ color?: string | null; size?: string | null }> | undefined,
  key: "color" | "size"
) {
  try {
    const parsed = serialized ? JSON.parse(serialized) : [];
    if (Array.isArray(parsed) && parsed.length > 0)
      return parsed.map(item => String(item).trim()).filter(Boolean);
  } catch {
    // Legacy rows can lack the serialized option list; their variant fields remain canonical for editing.
  }
  return [
    ...new Set(
      (variants ?? [])
        .map(variant => String(variant[key] ?? "").trim())
        .filter(Boolean)
    ),
  ];
}

export function ProductsPage() {
  const { user, isAuthenticated } = useUser();
  const { showToast } = useToast();
  const utils = trpc.useUtils();
  const isAdmin = user?.role === "admin";

  const [productSearch, setProductSearch] = useState("");
  const [productFilter, setProductFilter] = useState<ProductListFilter>("all");
  const [newProduct, setNewProduct] = useState({ ...emptyProductForm });
  const [editingProductId, setEditingProductId] = useState<number | null>(null);
  const [editProduct, setEditProduct] = useState({ ...emptyProductForm });
  const [quickProductEdits, setQuickProductEdits] = useState<
    Record<number, { price: string; stock: string }>
  >({});
  const [uploadingField, setUploadingField] = useState<string | null>(null);
  const createMainImageInputRef = useRef<HTMLInputElement | null>(null);
  const createGalleryImageInputRef = useRef<HTMLInputElement | null>(null);
  const editMainImageInputRef = useRef<HTMLInputElement | null>(null);
  const editGalleryImageInputRef = useRef<HTMLInputElement | null>(null);

  async function uploadAdminImages(
    files: FileList | null,
    mode: "single" | "multiple",
    target: string
  ) {
    if (!files || files.length === 0) return [];

    const allowedFiles = Array.from(files).filter(file =>
      file.type.startsWith("image/")
    );
    if (allowedFiles.length === 0) {
      showToast({
        message: "Selecione ao menos uma imagem válida",
        duration: 2400,
      });
      return [];
    }

    setUploadingField(target);

    try {
      const uploadedUrls: string[] = [];

      for (const file of allowedFiles) {
        const formData = new FormData();
        formData.append("file", file);

        const response = await csrfFetch(apiUrl("/api/upload"), {
          method: "POST",
          body: formData,
          credentials: "include",
        });

        const payload = await response.json().catch(() => null);
        if (!response.ok || !payload?.url) {
          throw new Error(payload?.error || "Falha ao enviar imagem");
        }

        uploadedUrls.push(payload.url);
        if (mode === "single") break;
      }

      showToast({
        message:
          uploadedUrls.length > 1
            ? "Imagens enviadas com sucesso"
            : "Imagem enviada com sucesso",
        duration: 2200,
      });

      return uploadedUrls;
    } catch (error: any) {
      showToast({
        message: error?.message || "Não foi possível enviar a imagem",
        duration: 2800,
      });
      return [];
    } finally {
      setUploadingField(null);
    }
  }

  const productsQuery = trpc.admin.productsList.useQuery(undefined, {
    enabled: isAuthenticated && isAdmin,
  });

  const createProductMutation = trpc.admin.productCreate.useMutation({
    onSuccess: () => {
      showToast({ message: "Produto criado", duration: 2000 });
      setNewProduct({ ...emptyProductForm });
      void productsQuery.refetch();
      void utils.admin.dashboard.invalidate();
    },
    onError: error => showToast({ message: error.message, duration: 2600 }),
  });

  const updateProductMutation = trpc.admin.productUpdate.useMutation({
    onSuccess: () => {
      showToast({ message: "Produto atualizado", duration: 2000 });
      setEditingProductId(null);
      setEditProduct({ ...emptyProductForm });
      void productsQuery.refetch();
      void utils.admin.dashboard.invalidate();
    },
    onError: error => showToast({ message: error.message, duration: 2600 }),
  });

  const quickUpdateProductMutation = trpc.admin.productUpdate.useMutation({
    onSuccess: () => {
      showToast({ message: "Produto atualizado", duration: 2000 });
      void productsQuery.refetch();
      void utils.admin.dashboard.invalidate();
    },
    onError: error => showToast({ message: error.message, duration: 2600 }),
  });

  const deleteProductMutation = trpc.admin.productDelete.useMutation({
    onSuccess: () => {
      showToast({ message: "Produto removido", duration: 2000 });
      void productsQuery.refetch();
      void utils.admin.dashboard.invalidate();
    },
    onError: error => showToast({ message: error.message, duration: 2600 }),
  });

  const searchedProducts = useMemo(() => {
    const normalizedSearch = productSearch.trim().toLowerCase();
    return [...(productsQuery.data ?? [])]
      .filter(row => {
        if (!normalizedSearch) return true;
        return [row.name, row.category, row.description, String(row.id)].some(
          value =>
            String(value ?? "")
              .toLowerCase()
              .includes(normalizedSearch)
        );
      })
      .sort((a, b) => b.id - a.id);
  }, [productSearch, productsQuery.data]);
  const productSummary = useMemo(() => {
    const rows = productsQuery.data ?? [];
    return {
      total: rows.length,
      withStock: rows.filter(row => Number(row.stock ?? 0) > 0).length,
      outOfStock: rows.filter(row => Number(row.stock ?? 0) <= 0).length,
      lowStock: rows.filter(
        row => Number(row.stock ?? 0) > 0 && Number(row.stock ?? 0) <= 5
      ).length,
      withoutImage: rows.filter(row => !resolveAdminImageUrl(row.imageUrl))
        .length,
      withVariants: rows.filter(row => (row.variants?.length ?? 0) > 0).length,
    };
  }, [productsQuery.data]);
  const productFilterOptions = useMemo(
    () => [
      { key: "all" as const, label: "Todos", count: searchedProducts.length },
      {
        key: "lowStock" as const,
        label: "Estoque baixo",
        count: searchedProducts.filter(
          row => Number(row.stock ?? 0) > 0 && Number(row.stock ?? 0) <= 5
        ).length,
      },
      {
        key: "outOfStock" as const,
        label: "Sem estoque",
        count: searchedProducts.filter(row => Number(row.stock ?? 0) <= 0)
          .length,
      },
      {
        key: "withoutImage" as const,
        label: "Sem imagem",
        count: searchedProducts.filter(
          row => !resolveAdminImageUrl(row.imageUrl)
        ).length,
      },
      {
        key: "withVariants" as const,
        label: "Com variantes",
        count: searchedProducts.filter(row => (row.variants?.length ?? 0) > 0)
          .length,
      },
    ],
    [searchedProducts]
  );
  const products = useMemo(() => {
    return searchedProducts.filter(row => {
      if (productFilter === "lowStock")
        return Number(row.stock ?? 0) > 0 && Number(row.stock ?? 0) <= 5;
      if (productFilter === "outOfStock") return Number(row.stock ?? 0) <= 0;
      if (productFilter === "withoutImage")
        return !resolveAdminImageUrl(row.imageUrl);
      if (productFilter === "withVariants")
        return (row.variants?.length ?? 0) > 0;
      return true;
    });
  }, [productFilter, searchedProducts]);
  const wideFieldStyle = {
    ...styles.mediaField,
    gridColumn: "1 / -1",
  } as CSSProperties;
  const mediumFieldStyle = {
    ...styles.mediaField,
    gridColumn: "span 2",
  } as CSSProperties;

  return (
    <AdminProductsUI>
      <AdminSurface
        title="Produtos"
        description="Cadastre, revise estoque, organize imagens e acompanhe a saúde operacional do catálogo."
      >
        <ProductsSummaryCards summary={productSummary} />
        <div style={styles.inlineRow}>
          <input
            style={{ ...styles.input, minWidth: 280 }}
            placeholder="Buscar produto por nome, categoria ou ID"
            value={productSearch}
            onChange={e => setProductSearch(e.target.value)}
          />
          <div style={styles.summaryPill}>Exibindo: {products.length}</div>
          <div style={styles.summaryPill}>Busca: {searchedProducts.length}</div>
        </div>
        <ProductsFilters
          value={productFilter}
          onChange={setProductFilter}
          options={productFilterOptions}
        />
        <div style={styles.productAdminHeader}>
          <div>
            <h3 style={styles.productAdminTitle}>Criar produto</h3>
            <p style={styles.productAdminText}>
              Preencha as informações principais, organize as variações e
              publique o item com estoque claro por combinação.
            </p>
          </div>
        </div>
        <div style={styles.formGrid}>
          <div style={styles.formSectionHeading}>
            <span>Informações básicas</span>
            <small>Dados principais do catálogo</small>
          </div>
          <input
            style={styles.input}
            placeholder="Nome do produto"
            value={newProduct.name}
            onChange={e =>
              setNewProduct(prev => ({ ...prev, name: e.target.value }))
            }
          />
          <select
            style={styles.select}
            value={newProduct.category}
            onChange={e =>
              setNewProduct(prev => ({ ...prev, category: e.target.value }))
            }
          >
            <option value="">Selecione a categoria</option>
            {PRODUCT_CATEGORIES.map(cat => (
              <option key={cat.value} value={cat.value}>
                {cat.label}
              </option>
            ))}
          </select>
          <div style={styles.categoryPreviewBox}>
            <span style={styles.categoryPreviewLabel}>Prévia da categoria</span>
            <strong style={styles.categoryPreviewValue}>
              {newProduct.category
                ? getCategoryLabel(newProduct.category)
                : "Selecione uma categoria"}
            </strong>
            <span style={styles.categoryPreviewHint}>
              Essa categoria define onde o produto aparece para o cliente na
              vitrine e nas páginas dedicadas.
            </span>
          </div>
          <input
            style={styles.input}
            placeholder="Preço (R$)"
            value={newProduct.price}
            onChange={e =>
              setNewProduct(prev => ({ ...prev, price: e.target.value }))
            }
          />
          <div style={styles.formSectionHeading}>
            <span>Descrição e detalhes</span>
            <small>Apresentação curta do produto</small>
          </div>
          <input
            style={{ ...styles.input, gridColumn: "1 / -1" }}
            placeholder="Descrição curta"
            value={newProduct.description}
            onChange={e =>
              setNewProduct(prev => ({ ...prev, description: e.target.value }))
            }
          />
          <ProductOptionsInventoryEditor
            value={newProduct}
            onChange={next => setNewProduct(prev => ({ ...prev, ...next }))}
            colorSuggestions={productColorSuggestions}
            alphaSizeSuggestions={alphaSizeSuggestions}
            numericSizeSuggestions={numericSizeSuggestions}
          />
          <div style={styles.formSectionHeading}>
            <span>Imagens</span>
            <small>Capa, galeria e associação opcional por cor</small>
          </div>
          <div style={mediumFieldStyle}>
            <input
              style={styles.input}
              placeholder="Imagem principal"
              value={newProduct.imageUrl}
              onChange={e =>
                setNewProduct(prev => ({ ...prev, imageUrl: e.target.value }))
              }
            />
            <div style={styles.mediaActions}>
              <button
                style={styles.secondaryBtn}
                onClick={() => createMainImageInputRef.current?.click()}
                disabled={uploadingField === "create-main"}
              >
                {uploadingField === "create-main"
                  ? "Enviando capa..."
                  : "Upload da capa"}
              </button>
              <span style={styles.mediaHint}>Ou cole uma URL manualmente.</span>
            </div>
            <input
              ref={createMainImageInputRef}
              type="file"
              accept="image/*"
              style={styles.hiddenFileInput}
              onChange={async e => {
                const urls = await uploadAdminImages(
                  e.target.files,
                  "single",
                  "create-main"
                );
                if (urls[0]) {
                  setNewProduct(prev => ({ ...prev, imageUrl: urls[0] }));
                }
                e.currentTarget.value = "";
              }}
            />
            {resolveAdminImageUrl(newProduct.imageUrl) ? (
              <div style={styles.mediaPreviewRow}>
                <img
                  src={resolveAdminImageUrl(newProduct.imageUrl)}
                  alt="Prévia da capa"
                  style={styles.mediaPreviewImage}
                />
                <span style={styles.mediaHint}>
                  Capa pronta para o card e para a página do produto.
                </span>
              </div>
            ) : null}
          </div>
          <div style={wideFieldStyle}>
            <input
              style={styles.input}
              placeholder="Outras imagens (CSV)"
              value={newProduct.imagesCsv}
              onChange={e =>
                setNewProduct(prev => ({ ...prev, imagesCsv: e.target.value }))
              }
            />
            <select
              style={styles.select}
              value={newProduct.galleryColor}
              onChange={e =>
                setNewProduct(prev => ({
                  ...prev,
                  galleryColor: e.target.value,
                }))
              }
            >
              <option value="">Galeria sem cor específica</option>
              {newProduct.colorsCsv
                .split(",")
                .map(item => item.trim())
                .filter(Boolean)
                .map(color => (
                  <option key={color} value={color}>
                    Vincular à cor {color}
                  </option>
                ))}
            </select>
            <div style={styles.mediaActions}>
              <button
                style={styles.secondaryBtn}
                onClick={() => createGalleryImageInputRef.current?.click()}
                disabled={uploadingField === "create-gallery"}
              >
                {uploadingField === "create-gallery"
                  ? "Enviando galeria..."
                  : "Upload da galeria"}
              </button>
              <span style={styles.mediaHint}>
                Você pode selecionar várias imagens de uma vez.
              </span>
            </div>
            <input
              ref={createGalleryImageInputRef}
              type="file"
              accept="image/*"
              multiple
              style={styles.hiddenFileInput}
              onChange={async e => {
                const urls = await uploadAdminImages(
                  e.target.files,
                  "multiple",
                  "create-gallery"
                );
                if (urls.length > 0) {
                  setNewProduct(prev => ({
                    ...prev,
                    imagesCsv: joinImageCsvEntries(
                      prev.imagesCsv,
                      urls,
                      prev.galleryColor || null
                    ),
                  }));
                }
                e.currentTarget.value = "";
              }}
            />
            <span style={styles.mediaHint}>
              Use `url|cor` para vincular uma imagem a uma cor específica do
              produto.
            </span>
            {parseImageCsvEntries(newProduct.imagesCsv).length > 0 ? (
              <div style={styles.galleryPreviewGrid}>
                {parseImageCsvEntries(newProduct.imagesCsv).map(
                  (item, index) => (
                    <div
                      key={`${item.imageUrl}-${index}`}
                      style={styles.galleryPreviewCard}
                    >
                      <img
                        src={item.imageUrl}
                        alt={`Galeria ${index + 1}`}
                        style={styles.galleryPreviewImage}
                      />
                      <div style={styles.galleryPreviewMeta}>
                        <strong style={styles.galleryPreviewTitle}>
                          Imagem {index + 1}
                        </strong>
                        <span style={styles.galleryPreviewText}>
                          {item.color
                            ? `Cor: ${item.color}`
                            : "Sem cor vinculada"}
                        </span>
                      </div>
                      <div style={styles.galleryPreviewActions}>
                        <button
                          style={styles.inlineBtn}
                          onClick={() =>
                            setNewProduct(prev => ({
                              ...prev,
                              ...moveImageCsvEntryToCover(
                                prev.imagesCsv,
                                item.imageUrl,
                                prev.imageUrl
                              ),
                            }))
                          }
                        >
                          Usar como capa
                        </button>
                        <button
                          style={styles.inlineBtnDanger}
                          onClick={() =>
                            setNewProduct(prev => ({
                              ...prev,
                              imagesCsv: removeImageCsvEntry(
                                prev.imagesCsv,
                                item.imageUrl
                              ),
                            }))
                          }
                        >
                          Remover
                        </button>
                      </div>
                    </div>
                  )
                )}
              </div>
            ) : null}
          </div>
        </div>
        <div style={styles.productAdminActions}>
          <button
            style={styles.primaryBtn}
            onClick={() => {
              const price = parseMoneyToCents(newProduct.price);
              const stock = Number(newProduct.stock);
              if (
                !newProduct.name.trim() ||
                !newProduct.category.trim() ||
                !Number.isFinite(price) ||
                price <= 0
              ) {
                showToast({
                  message: "Preencha nome, categoria e preço válidos",
                  duration: 2400,
                });
                return;
              }

              const images = parseImageCsvEntries(newProduct.imagesCsv);
              const optionColors = newProduct.colorsCsv
                .split(",")
                .map(item => item.trim())
                .filter(Boolean);
              const optionSizes = newProduct.sizesCsv
                .split(",")
                .map(item => item.trim())
                .filter(Boolean);

              const variants = newProduct.variantsCsv
                .split(";")
                .map(raw => raw.trim())
                .filter(Boolean)
                .map(raw => {
                  const [name, sku, variantPrice, variantStock] = raw
                    .split("|")
                    .map(part => part?.trim() ?? "");
                  const options = resolveVariantOptions(
                    name,
                    optionColors,
                    optionSizes
                  );
                  return {
                    name,
                    sku: sku || null,
                    ...options,
                    price: variantPrice
                      ? parseMoneyToCents(variantPrice)
                      : null,
                    stock: Number(variantStock || "0"),
                  };
                })
                .filter(
                  item =>
                    item.name &&
                    Number.isFinite(item.stock) &&
                    (item.price === null || Number.isFinite(item.price))
                );

              createProductMutation.mutate({
                name: newProduct.name.trim(),
                category: normalizeCategoryValue(newProduct.category),
                price,
                stock:
                  variants.length > 0
                    ? variants.reduce(
                        (total, variant) => total + variant.stock,
                        0
                      )
                    : Number.isFinite(stock) && stock >= 0
                      ? stock
                      : 0,
                imageUrl:
                  normalizeAdminImageValue(newProduct.imageUrl) || undefined,
                optionColors,
                optionSizes,
                sizeType: newProduct.sizeType as "alpha" | "numeric" | "custom",
                images,
                variants,
                description: newProduct.description.trim() || undefined,
              });
            }}
          >
            Criar produto
          </button>
        </div>

        <div style={styles.productAdminHeader}>
          <div>
            <h3 style={styles.productAdminTitle}>Editar produto</h3>
            <p style={styles.productAdminText}>
              Selecione um item já cadastrado para revisar preço, estoque,
              imagens, variantes e categoria.
            </p>
          </div>
        </div>
        <div style={styles.inlineRow}>
          <select
            style={{ ...styles.select, minWidth: 280 }}
            value={editingProductId ?? ""}
            onChange={e => {
              const nextId = Number(e.target.value);
              if (!Number.isFinite(nextId) || nextId <= 0) {
                setEditingProductId(null);
                setEditProduct({ ...emptyProductForm });
                return;
              }

              const selected = products.find(product => product.id === nextId);
              if (!selected) {
                setEditingProductId(null);
                setEditProduct({ ...emptyProductForm });
                return;
              }

              setEditingProductId(selected.id);
              const selectedColors = getStoredProductOptions(
                selected.optionColors,
                selected.variants,
                "color"
              );
              const selectedSizes = getStoredProductOptions(
                selected.optionSizes,
                selected.variants,
                "size"
              );
              setEditProduct({
                name: selected.name ?? "",
                category: selected.category ?? "",
                price: centsToMoneyInput(selected.price),
                stock: String(selected.stock ?? 0),
                imageUrl: normalizeAdminImageValue(selected.imageUrl),
                galleryColor: "",
                colorsCsv: selectedColors.join(", "),
                sizesCsv: selectedSizes.join(", "),
                sizeType: selected.sizeType ?? "alpha",
                imagesCsv: (selected.images ?? [])
                  .map(item =>
                    formatImageCsvEntry(
                      typeof item === "string" ? item : (item?.imageUrl ?? ""),
                      typeof item === "string" ? null : (item?.color ?? null)
                    )
                  )
                  .filter(Boolean)
                  .join(", "),
                variantsCsv: (selected.variants ?? [])
                  .map(item => {
                    const name = item?.name ?? "";
                    const sku = item?.sku ?? "";
                    const variantPrice = centsToMoneyInput(item?.price);
                    const variantStock = item?.stock ?? 0;
                    return `${name}|${sku}|${variantPrice}|${variantStock}`;
                  })
                  .filter(Boolean)
                  .join("; "),
                description: selected.description ?? "",
              });
            }}
          >
            <option value="">Selecione um produto</option>
            {products.map(product => (
              <option key={product.id} value={product.id}>
                #{product.id} - {product.name}
              </option>
            ))}
          </select>
        </div>

        {editingProductId ? (
          <>
            <div style={styles.formGrid}>
              <div style={styles.formSectionHeading}>
                <span>Informações básicas</span>
                <small>Dados principais do catálogo</small>
              </div>
              <input
                style={styles.input}
                placeholder="Nome do produto"
                value={editProduct.name}
                onChange={e =>
                  setEditProduct(prev => ({ ...prev, name: e.target.value }))
                }
              />
              <select
                style={styles.select}
                value={editProduct.category}
                onChange={e =>
                  setEditProduct(prev => ({
                    ...prev,
                    category: e.target.value,
                  }))
                }
              >
                <option value="">Selecione a categoria</option>
                {PRODUCT_CATEGORIES.map(cat => (
                  <option key={cat.value} value={cat.value}>
                    {cat.label}
                  </option>
                ))}
              </select>
              <div style={styles.categoryPreviewBox}>
                <span style={styles.categoryPreviewLabel}>
                  Prévia da categoria
                </span>
                <strong style={styles.categoryPreviewValue}>
                  {editProduct.category
                    ? getCategoryLabel(editProduct.category)
                    : "Selecione uma categoria"}
                </strong>
                <span style={styles.categoryPreviewHint}>
                  Essa categoria será usada na navegação da loja e no filtro que
                  o cliente vê.
                </span>
              </div>
              <input
                style={styles.input}
                placeholder="Preço (R$)"
                value={editProduct.price}
                onChange={e =>
                  setEditProduct(prev => ({ ...prev, price: e.target.value }))
                }
              />
              <div style={styles.formSectionHeading}>
                <span>Descrição e detalhes</span>
                <small>Apresentação curta do produto</small>
              </div>
              <input
                style={{ ...styles.input, gridColumn: "1 / -1" }}
                placeholder="Descrição curta"
                value={editProduct.description}
                onChange={e =>
                  setEditProduct(prev => ({
                    ...prev,
                    description: e.target.value,
                  }))
                }
              />
              <ProductOptionsInventoryEditor
                value={editProduct}
                onChange={next =>
                  setEditProduct(prev => ({ ...prev, ...next }))
                }
                colorSuggestions={productColorSuggestions}
                alphaSizeSuggestions={alphaSizeSuggestions}
                numericSizeSuggestions={numericSizeSuggestions}
              />
              <div style={styles.formSectionHeading}>
                <span>Imagens</span>
                <small>Capa, galeria e associação opcional por cor</small>
              </div>
              <div style={mediumFieldStyle}>
                <input
                  style={styles.input}
                  placeholder="Imagem principal"
                  value={editProduct.imageUrl}
                  onChange={e =>
                    setEditProduct(prev => ({
                      ...prev,
                      imageUrl: e.target.value,
                    }))
                  }
                />
                <div style={styles.mediaActions}>
                  <button
                    style={styles.secondaryBtn}
                    onClick={() => editMainImageInputRef.current?.click()}
                    disabled={uploadingField === "edit-main"}
                  >
                    {uploadingField === "edit-main"
                      ? "Enviando capa..."
                      : "Trocar capa"}
                  </button>
                  <span style={styles.mediaHint}>
                    Você também pode substituir a URL manualmente.
                  </span>
                </div>
                <input
                  ref={editMainImageInputRef}
                  type="file"
                  accept="image/*"
                  style={styles.hiddenFileInput}
                  onChange={async e => {
                    const urls = await uploadAdminImages(
                      e.target.files,
                      "single",
                      "edit-main"
                    );
                    if (urls[0]) {
                      setEditProduct(prev => ({ ...prev, imageUrl: urls[0] }));
                    }
                    e.currentTarget.value = "";
                  }}
                />
                {resolveAdminImageUrl(editProduct.imageUrl) ? (
                  <div style={styles.mediaPreviewRow}>
                    <img
                      src={resolveAdminImageUrl(editProduct.imageUrl)}
                      alt="Prévia da capa"
                      style={styles.mediaPreviewImage}
                    />
                    <span style={styles.mediaHint}>
                      Essa será a imagem principal exibida na vitrine.
                    </span>
                  </div>
                ) : null}
              </div>
              <div style={wideFieldStyle}>
                <input
                  style={styles.input}
                  placeholder="Outras imagens (CSV)"
                  value={editProduct.imagesCsv}
                  onChange={e =>
                    setEditProduct(prev => ({
                      ...prev,
                      imagesCsv: e.target.value,
                    }))
                  }
                />
                <select
                  style={styles.select}
                  value={editProduct.galleryColor}
                  onChange={e =>
                    setEditProduct(prev => ({
                      ...prev,
                      galleryColor: e.target.value,
                    }))
                  }
                >
                  <option value="">Galeria sem cor específica</option>
                  {editProduct.colorsCsv
                    .split(",")
                    .map(item => item.trim())
                    .filter(Boolean)
                    .map(color => (
                      <option key={color} value={color}>
                        Vincular à cor {color}
                      </option>
                    ))}
                </select>
                <div style={styles.mediaActions}>
                  <button
                    style={styles.secondaryBtn}
                    onClick={() => editGalleryImageInputRef.current?.click()}
                    disabled={uploadingField === "edit-gallery"}
                  >
                    {uploadingField === "edit-gallery"
                      ? "Enviando galeria..."
                      : "Adicionar na galeria"}
                  </button>
                  <span style={styles.mediaHint}>
                    As novas imagens serão adicionadas ao CSV atual.
                  </span>
                </div>
                <input
                  ref={editGalleryImageInputRef}
                  type="file"
                  accept="image/*"
                  multiple
                  style={styles.hiddenFileInput}
                  onChange={async e => {
                    const urls = await uploadAdminImages(
                      e.target.files,
                      "multiple",
                      "edit-gallery"
                    );
                    if (urls.length > 0) {
                      setEditProduct(prev => ({
                        ...prev,
                        imagesCsv: joinImageCsvEntries(
                          prev.imagesCsv,
                          urls,
                          prev.galleryColor || null
                        ),
                      }));
                    }
                    e.currentTarget.value = "";
                  }}
                />
                <span style={styles.mediaHint}>
                  Você também pode usar `url|cor` para trocar a imagem conforme
                  a cor escolhida.
                </span>
                {parseImageCsvEntries(editProduct.imagesCsv).length > 0 ? (
                  <div style={styles.galleryPreviewGrid}>
                    {parseImageCsvEntries(editProduct.imagesCsv).map(
                      (item, index) => (
                        <div
                          key={`${item.imageUrl}-${index}`}
                          style={styles.galleryPreviewCard}
                        >
                          <img
                            src={item.imageUrl}
                            alt={`Galeria ${index + 1}`}
                            style={styles.galleryPreviewImage}
                          />
                          <div style={styles.galleryPreviewMeta}>
                            <strong style={styles.galleryPreviewTitle}>
                              Imagem {index + 1}
                            </strong>
                            <span style={styles.galleryPreviewText}>
                              {item.color
                                ? `Cor: ${item.color}`
                                : "Sem cor vinculada"}
                            </span>
                          </div>
                          <div style={styles.galleryPreviewActions}>
                            <button
                              style={styles.inlineBtn}
                              onClick={() =>
                                setEditProduct(prev => ({
                                  ...prev,
                                  ...moveImageCsvEntryToCover(
                                    prev.imagesCsv,
                                    item.imageUrl,
                                    prev.imageUrl
                                  ),
                                }))
                              }
                            >
                              Usar como capa
                            </button>
                            <button
                              style={styles.inlineBtnDanger}
                              onClick={() =>
                                setEditProduct(prev => ({
                                  ...prev,
                                  imagesCsv: removeImageCsvEntry(
                                    prev.imagesCsv,
                                    item.imageUrl
                                  ),
                                }))
                              }
                            >
                              Remover
                            </button>
                          </div>
                        </div>
                      )
                    )}
                  </div>
                ) : null}
              </div>
            </div>
            <div style={styles.productAdminActions}>
              <button
                style={styles.primaryBtn}
                onClick={() => {
                  if (!editingProductId) return;

                  const price = parseMoneyToCents(editProduct.price);
                  const stock = Number(editProduct.stock);
                  if (
                    !editProduct.name.trim() ||
                    !editProduct.category.trim() ||
                    !Number.isFinite(price) ||
                    price <= 0
                  ) {
                    showToast({
                      message: "Preencha nome, categoria e preço válidos",
                      duration: 2400,
                    });
                    return;
                  }

                  const images = parseImageCsvEntries(editProduct.imagesCsv);
                  const optionColors = editProduct.colorsCsv
                    .split(",")
                    .map(item => item.trim())
                    .filter(Boolean);
                  const optionSizes = editProduct.sizesCsv
                    .split(",")
                    .map(item => item.trim())
                    .filter(Boolean);

                  const variants = editProduct.variantsCsv
                    .split(";")
                    .map(raw => raw.trim())
                    .filter(Boolean)
                    .map(raw => {
                      const [name, sku, variantPrice, variantStock] = raw
                        .split("|")
                        .map(part => part?.trim() ?? "");
                      const options = resolveVariantOptions(
                        name,
                        optionColors,
                        optionSizes
                      );
                      return {
                        name,
                        sku: sku || null,
                        ...options,
                        price: variantPrice
                          ? parseMoneyToCents(variantPrice)
                          : null,
                        stock: Number(variantStock || "0"),
                      };
                    })
                    .filter(
                      item =>
                        item.name &&
                        Number.isFinite(item.stock) &&
                        (item.price === null || Number.isFinite(item.price))
                    );

                  updateProductMutation.mutate({
                    id: editingProductId,
                    name: editProduct.name.trim(),
                    category: normalizeCategoryValue(editProduct.category),
                    price,
                    stock:
                      variants.length > 0
                        ? variants.reduce(
                            (total, variant) => total + variant.stock,
                            0
                          )
                        : Number.isFinite(stock) && stock >= 0
                          ? stock
                          : 0,
                    imageUrl:
                      normalizeAdminImageValue(editProduct.imageUrl) ||
                      undefined,
                    optionColors,
                    optionSizes,
                    sizeType: editProduct.sizeType as
                      | "alpha"
                      | "numeric"
                      | "custom",
                    images,
                    variants,
                    description: editProduct.description.trim() || undefined,
                  });
                }}
              >
                Salvar edição
              </button>
              <button
                style={styles.secondaryBtn}
                onClick={() => {
                  setEditingProductId(null);
                  setEditProduct({ ...emptyProductForm });
                }}
              >
                Cancelar
              </button>
            </div>
          </>
        ) : (
          <div style={styles.productAdminEmpty}>
            Selecione um produto acima para liberar o formulário de edição.
          </div>
        )}

        <div style={styles.tableWrap}>
          <table style={styles.table}>
            <thead>
              <tr>
                <th>ID</th>
                <th>Produto</th>
                <th>Categoria</th>
                <th>Preço (R$)</th>
                <th>Estoque</th>
                <th>Visual</th>
                <th>Variantes</th>
                <th>Ação</th>
              </tr>
            </thead>
            <tbody>
              {products.map(row => (
                <tr key={row.id}>
                  <td>{row.id}</td>
                  <td>
                    <div style={styles.productTableCell}>
                      <strong style={styles.productTableName}>
                        {row.name}
                      </strong>
                      <span style={styles.productTableMeta}>
                        {row.description?.trim()
                          ? row.description
                          : "Sem descrição curta"}
                      </span>
                    </div>
                  </td>
                  <td>
                    <span style={styles.categoryTableBadge}>
                      {getCategoryLabel(row.category)}
                    </span>
                  </td>
                  <td>
                    <input
                      style={{ ...styles.input, width: 130 }}
                      value={
                        quickProductEdits[row.id]?.price ??
                        centsToMoneyInput(row.price)
                      }
                      onChange={e => {
                        const value = e.target.value;
                        setQuickProductEdits(prev => ({
                          ...prev,
                          [row.id]: {
                            price: value,
                            stock: prev[row.id]?.stock ?? String(row.stock),
                          },
                        }));
                      }}
                    />
                  </td>
                  <td>
                    <input
                      style={{
                        ...styles.input,
                        width: 90,
                        ...(Number(
                          quickProductEdits[row.id]?.stock ?? row.stock
                        ) <= 0
                          ? styles.stockInputEmpty
                          : Number(
                                quickProductEdits[row.id]?.stock ?? row.stock
                              ) <= 3
                            ? styles.stockInputLow
                            : {}),
                      }}
                      value={
                        quickProductEdits[row.id]?.stock ?? String(row.stock)
                      }
                      disabled={(row.variants?.length ?? 0) > 0}
                      title={
                        (row.variants?.length ?? 0) > 0
                          ? "Estoque agregado das variantes; edite as combinações no formulário."
                          : undefined
                      }
                      onChange={e => {
                        const value = e.target.value;
                        setQuickProductEdits(prev => ({
                          ...prev,
                          [row.id]: {
                            price:
                              prev[row.id]?.price ??
                              centsToMoneyInput(row.price),
                            stock: value,
                          },
                        }));
                      }}
                    />
                  </td>
                  <td>
                    <div style={styles.productVisualCell}>
                      {resolveAdminImageUrl(row.imageUrl) ? (
                        <img
                          src={resolveAdminImageUrl(row.imageUrl)}
                          alt={row.name}
                          style={styles.productThumb as CSSProperties}
                        />
                      ) : (
                        <div style={styles.productThumbEmpty}>Sem imagem</div>
                      )}
                      <span style={styles.productVisualMeta}>
                        {(row.images?.length ?? 0) > 0
                          ? `${row.images?.length ?? 0} extras`
                          : "Só capa"}
                      </span>
                    </div>
                  </td>
                  <td>
                    <span style={styles.variantCountBadge}>
                      {row.variants?.length ?? 0}
                    </span>
                  </td>
                  <td style={styles.actionsCell}>
                    <button
                      style={styles.smallBtn}
                      onClick={() => {
                        const price = parseMoneyToCents(
                          quickProductEdits[row.id]?.price ??
                            centsToMoneyInput(row.price)
                        );
                        const stock = Number(
                          quickProductEdits[row.id]?.stock ?? row.stock
                        );
                        if (
                          !Number.isFinite(price) ||
                          price <= 0 ||
                          !Number.isFinite(stock) ||
                          stock < 0
                        ) {
                          showToast({
                            message: "Preço/estoque inválidos",
                            duration: 2400,
                          });
                          return;
                        }
                        quickUpdateProductMutation.mutate(
                          {
                            id: row.id,
                            price,
                            ...((row.variants?.length ?? 0) === 0
                              ? { stock }
                              : {}),
                          },
                          {
                            onSuccess: () => {
                              setQuickProductEdits(prev => {
                                const next = { ...prev };
                                delete next[row.id];
                                return next;
                              });
                            },
                          }
                        );
                      }}
                    >
                      Salvar rápido
                    </button>
                    <button
                      style={styles.smallBtn}
                      onClick={() => {
                        const rowColors = getStoredProductOptions(
                          row.optionColors,
                          row.variants,
                          "color"
                        );
                        const rowSizes = getStoredProductOptions(
                          row.optionSizes,
                          row.variants,
                          "size"
                        );
                        setEditingProductId(row.id);
                        setEditProduct({
                          name: row.name ?? "",
                          category: row.category ?? "",
                          price: centsToMoneyInput(row.price),
                          stock: String(row.stock ?? 0),
                          imageUrl: normalizeAdminImageValue(row.imageUrl),
                          galleryColor: "",
                          colorsCsv: rowColors.join(", "),
                          sizesCsv: rowSizes.join(", "),
                          sizeType: row.sizeType ?? "alpha",
                          imagesCsv: (row.images ?? [])
                            .map(item =>
                              formatImageCsvEntry(
                                typeof item === "string"
                                  ? item
                                  : (item?.imageUrl ?? ""),
                                typeof item === "string"
                                  ? null
                                  : (item?.color ?? null)
                              )
                            )
                            .filter(Boolean)
                            .join(", "),
                          variantsCsv: (row.variants ?? [])
                            .map(item => {
                              const name = item?.name ?? "";
                              const sku = item?.sku ?? "";
                              const variantPrice = centsToMoneyInput(
                                item?.price
                              );
                              const variantStock = item?.stock ?? 0;
                              return `${name}|${sku}|${variantPrice}|${variantStock}`;
                            })
                            .filter(Boolean)
                            .join("; "),
                          description: row.description ?? "",
                        });
                      }}
                    >
                      Editar
                    </button>
                    <button
                      style={styles.dangerBtn}
                      onClick={() =>
                        deleteProductMutation.mutate({ id: row.id })
                      }
                    >
                      Excluir
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </AdminSurface>
    </AdminProductsUI>
  );
}

const styles: Record<string, CSSProperties> = {
  inlineRow: {
    display: "flex",
    gap: 10,
    flexWrap: "wrap",
    alignItems: "center",
    justifyContent: "flex-start",
  },
  input: {
    border: "1px solid #27272a",
    background: "#111111",
    color: "#f0ede8",
    borderRadius: 12,
    padding: "12px 14px",
    textAlign: "left",
    minHeight: 46,
    boxSizing: "border-box",
  },
  summaryPill: {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    minHeight: 38,
    padding: "0 14px",
    borderRadius: 999,
    border: "1px solid #262626",
    background: "#121212",
    color: "#f0ede8",
    fontSize: 12,
    fontWeight: 700,
    whiteSpace: "nowrap",
  },
  productAdminHeader: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "flex-start",
    gap: 12,
    textAlign: "left",
  },
  productAdminTitle: {
    margin: 0,
    color: "#f0ede8",
    fontSize: 20,
    fontWeight: 800,
    textAlign: "left",
  },
  productAdminText: {
    margin: "6px 0 0 0",
    color: "#9ca3af",
    fontSize: 13,
    lineHeight: 1.6,
    maxWidth: 720,
    textAlign: "left",
  },
  formGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
    gap: 14,
    alignItems: "stretch",
  },
  formSectionHeading: {
    gridColumn: "1 / -1",
    display: "grid",
    gap: 4,
    paddingTop: 4,
    color: "#f8f4ec",
    fontSize: 13,
    fontWeight: 800,
    letterSpacing: "0.08em",
    textTransform: "uppercase",
  },
  select: {
    border: "1px solid #27272a",
    background: "#111111",
    color: "#f0ede8",
    borderRadius: 12,
    padding: "12px 14px",
    textAlign: "left",
    minHeight: 46,
    boxSizing: "border-box",
  },
  categoryPreviewBox: {
    display: "flex",
    flexDirection: "column",
    justifyContent: "center",
    alignItems: "flex-start",
    textAlign: "left",
    gap: 6,
    padding: 14,
    border: "1px solid #2f2f2f",
    borderRadius: 12,
    background: "linear-gradient(135deg, #121212 0%, #181818 100%)",
    minHeight: 0,
    gridColumn: "span 2",
  },
  categoryPreviewLabel: {
    fontSize: 11,
    letterSpacing: 1.6,
    textTransform: "uppercase",
    color: "#9ca3af",
  },
  categoryPreviewValue: {
    color: "#f0ede8",
    fontSize: 18,
    fontWeight: 800,
    lineHeight: 1.35,
  },
  categoryPreviewHint: {
    color: "#9ca3af",
    fontSize: 13,
    lineHeight: 1.6,
    maxWidth: 640,
  },
  mediaActions: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    flexWrap: "wrap",
  },
  secondaryBtn: {
    border: "1px solid #2f2f2f",
    background: "#111111",
    color: "#f0ede8",
    borderRadius: 8,
    padding: "10px 14px",
    cursor: "pointer",
    minWidth: 128,
    fontWeight: 700,
  },
  mediaHint: {
    color: "#9ca3af",
    fontSize: 12,
    lineHeight: 1.5,
    textAlign: "left",
  },
  hiddenFileInput: {
    display: "none",
  },
  mediaPreviewRow: {
    display: "flex",
    alignItems: "center",
    gap: 12,
    padding: 10,
    borderRadius: 10,
    border: "1px solid #2f2f2f",
    background: "#111111",
  },
  mediaPreviewImage: {
    width: 56,
    height: 56,
    objectFit: "cover",
    borderRadius: 10,
    border: "1px solid #2f2f2f",
    background: "#0f0f0f",
    flexShrink: 0,
  },
  galleryPreviewGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))",
    gap: 12,
  },
  galleryPreviewCard: {
    display: "flex",
    flexDirection: "column",
    gap: 10,
    padding: 10,
    borderRadius: 12,
    border: "1px solid #2f2f2f",
    background: "#111111",
    textAlign: "left",
  },
  galleryPreviewImage: {
    width: "100%",
    aspectRatio: "1 / 1",
    objectFit: "cover",
    borderRadius: 10,
    border: "1px solid #2f2f2f",
    background: "#0f0f0f",
  },
  galleryPreviewMeta: {
    display: "flex",
    flexDirection: "column",
    gap: 4,
  },
  galleryPreviewTitle: {
    color: "#f0ede8",
    fontSize: 13,
    fontWeight: 800,
  },
  galleryPreviewText: {
    color: "#9ca3af",
    fontSize: 12,
    lineHeight: 1.45,
  },
  galleryPreviewActions: {
    display: "flex",
    gap: 8,
    flexWrap: "wrap",
  },
  inlineBtn: {
    border: "1px solid #2f2f2f",
    background: "#111111",
    color: "#f0ede8",
    borderRadius: 8,
    padding: "6px 10px",
    cursor: "pointer",
    fontWeight: 700,
  },
  inlineBtnDanger: {
    border: "1px solid #dc2626",
    background: "#111111",
    color: "#dc2626",
    borderRadius: 8,
    padding: "6px 10px",
    cursor: "pointer",
    fontWeight: 700,
  },
  productAdminActions: {
    display: "flex",
    gap: 10,
    flexWrap: "wrap",
    justifyContent: "flex-start",
  },
  primaryBtn: {
    border: "1px solid #3a3a3a",
    background: "linear-gradient(135deg, #1a1a1a 0%, #3a3a3a 100%)",
    color: "#fff",
    borderRadius: 8,
    padding: "12px 16px",
    cursor: "pointer",
    minWidth: 180,
    fontWeight: 800,
  },
  productAdminEmpty: {
    border: "1px dashed #303030",
    borderRadius: 12,
    padding: 18,
    color: "#9ca3af",
    fontSize: 13,
    textAlign: "left",
    background: "#111111",
  },
  tableWrap: {
    overflowX: "auto",
    WebkitOverflowScrolling: "touch",
    border: "1px solid #2f2f2f",
    borderRadius: 10,
  },
  table: {
    width: "100%",
    minWidth: 920,
    borderCollapse: "separate",
    borderSpacing: 0,
    fontSize: 14,
    lineHeight: 1.4,
    color: "#e5e7eb",
    textAlign: "center",
  },
  productTableCell: {
    display: "flex",
    flexDirection: "column",
    gap: 4,
    alignItems: "flex-start",
    textAlign: "left",
    minWidth: 180,
  },
  productTableName: {
    color: "#f0ede8",
    fontSize: 14,
    fontWeight: 800,
    lineHeight: 1.35,
  },
  productTableMeta: {
    color: "#9ca3af",
    fontSize: 12,
    lineHeight: 1.5,
  },
  categoryTableBadge: {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    padding: "6px 10px",
    borderRadius: 999,
    border: "1px solid #2f2f2f",
    background: "#151515",
    color: "#f0ede8",
    fontSize: 12,
    fontWeight: 700,
  },
  stockInputEmpty: {
    border: "1px solid #7f1d1d",
    background: "#160b0b",
    color: "#f87171",
  },
  stockInputLow: {
    border: "1px solid #7c5a10",
    background: "#17120a",
    color: "#facc15",
  },
  productVisualCell: {
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    gap: 6,
  },
  productThumb: {
    width: 52,
    height: 52,
    objectFit: "cover",
    borderRadius: 10,
    border: "1px solid #2f2f2f",
    background: "#0f0f0f",
  },
  productThumbEmpty: {
    width: 52,
    height: 52,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 10,
    border: "1px dashed #3a3a3a",
    background: "#121212",
    color: "#9ca3af",
    fontSize: 10,
    textAlign: "center",
    padding: 4,
  },
  productVisualMeta: {
    color: "#9ca3af",
    fontSize: 11,
    lineHeight: 1.3,
  },
  variantCountBadge: {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    minWidth: 34,
    height: 30,
    padding: "0 10px",
    borderRadius: 999,
    border: "1px solid #2f2f2f",
    background: "#151515",
    color: "#f0ede8",
    fontSize: 12,
    fontWeight: 800,
  },
  actionsCell: {
    display: "flex",
    gap: 6,
    flexWrap: "wrap",
    justifyContent: "center",
    alignItems: "center",
  },
  smallBtn: {
    border: "1px solid #2f2f2f",
    background: "#111111",
    color: "#f0ede8",
    borderRadius: 8,
    padding: "6px 10px",
    cursor: "pointer",
    fontWeight: 700,
    whiteSpace: "nowrap",
  },
  dangerBtn: {
    border: "1px solid #dc2626",
    background: "#111111",
    color: "#dc2626",
    borderRadius: 8,
    padding: "6px 10px",
    cursor: "pointer",
  },
};
