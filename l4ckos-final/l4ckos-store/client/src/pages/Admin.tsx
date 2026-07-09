import { useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import type { CSSProperties } from "react";
import { trpc } from "../lib/trpc";
import { apiUrl } from "../const";
import { csrfFetch } from "../lib/csrf";
import { useUser } from "../contexts/UserContext";
import { useToast } from "../contexts/ToastContext";
import { PRODUCT_CATEGORIES, getCategoryLabel, normalizeCategoryValue } from "../lib/productCategories";
import { formatPrice } from "../lib/utils";
import { useIsMobile } from "../hooks/useIsMobile";
import {
  AdminEmptyState,
  AdminImagePreview,
  AdminLoadingState,
  AdminPageHeader,
  AdminStatusBadge,
  AdminSurface,
  AdminSummaryPill,
  AdminTableWrapper,
} from "../components/admin/AdminUI";
import { AdminDashboard } from "../components/admin/dashboard/AdminDashboard";
import {
  ProductOptionPreview,
  ProductStockBadge,
  ProductVisualMeta,
  ProductsFilters,
  ProductsSummaryCards,
  type ProductListFilter,
} from "../components/admin/products/AdminProductsUI";
import {
  OrderDetailPanel,
  OrderOperationalAlerts,
  OrdersFilters,
  OrdersSummaryCards,
  OrderStatusBadge,
  type OrderListFilter,
} from "../components/admin/orders/AdminOrdersUI";
import {
  CustomerDateMeta,
  CustomerOrdersCount,
  CustomerProfileCell,
  CustomerRoleBadge,
  CustomerStatusBadges,
  CustomersFilters,
  CustomersSummaryCards,
  type CustomerListFilter,
} from "../components/admin/customers/AdminCustomersUI";
import {
  PromotionBannerPreview,
  PromotionCampaignCell,
  PromotionMediaBadge,
  PromotionsSummaryCards,
  PromotionStatusBadge,
} from "../components/admin/promotions/AdminPromotionsUI";

type Section =
  | "overview"
  | "customers"
  | "products"
  | "promos"
  | "orders"
  | "coupons"
  | "reports"
  | "audit"
  | "backup";

const orderStatuses = ["pending", "paid", "processing", "shipped", "delivered", "cancelled"] as const;
const productColorSuggestions = ["preto", "branco", "verde", "azul-marinho", "cinza", "caqui"] as const;
const alphaSizeSuggestions = ["PP", "P", "M", "G", "GG", "XG"] as const;
const numericSizeSuggestions = ["36", "38", "40", "42", "44", "46"] as const;
const emptyProductForm = {
  name: "",
  category: "",
  price: "",
  stock: "0",
  imageUrl: "",
  imageThumbnailUrl: "",
  imageDetailUrl: "",
  imageBannerUrl: "",
  imagesCsv: "",
  galleryColor: "",
  colorsCsv: "",
  sizesCsv: "",
  sizeType: "alpha",
  variantsCsv: "",
  description: "",
};

type UploadedImage = {
  url: string;
  originalUrl?: string | null;
  thumbnailUrl?: string | null;
  detailUrl?: string | null;
  bannerUrl?: string | null;
};

type ProductImageEntry = {
  imageUrl: string;
  imageThumbnailUrl?: string | null;
  imageDetailUrl?: string | null;
  imageBannerUrl?: string | null;
  color?: string | null;
};

const emptyPromoForm = {
  badge: "PROMOÇÃO",
  title: "",
  description: "",
  ctaLabel: "Aproveitar oferta",
  imageUrl: "",
  mobileImageUrl: "",
  imageAlt: "",
  linkUrl: "",
  discountText: "",
  discountLabel: "OFF",
  bgStyle: "linear-gradient(135deg, #1a1a1a 0%, #333333 100%)",
  sortOrder: "0",
  isActive: true,
};

function resolveAdminImageUrl(imageUrl?: string | null) {
  if (!imageUrl) return "";
  if (imageUrl.startsWith("http://") || imageUrl.startsWith("https://") || imageUrl.startsWith("data:")) {
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

function formatImageCsvEntry(entry: string | ProductImageEntry, color?: string | null) {
  const imageUrl = typeof entry === "string" ? entry : entry.imageUrl;
  const normalizedUrl = normalizeAdminImageValue(imageUrl);
  const normalizedColor = String(color ?? "").trim();
  const normalizedThumbnail = typeof entry === "string" ? "" : normalizeAdminImageValue(entry.imageThumbnailUrl);
  const normalizedDetail = typeof entry === "string" ? "" : normalizeAdminImageValue(entry.imageDetailUrl);
  const normalizedBanner = typeof entry === "string" ? "" : normalizeAdminImageValue(entry.imageBannerUrl);
  const parts = [normalizedUrl, normalizedColor, normalizedThumbnail, normalizedDetail, normalizedBanner];

  while (parts.length > 1 && !parts[parts.length - 1]) {
    parts.pop();
  }

  return parts.join("|");
}

function parseImageCsvEntries(raw: string): ProductImageEntry[] {
  return raw
    .split(",")
    .map(item => item.trim())
    .filter(Boolean)
    .map(item => {
      const [imageUrlRaw, colorRaw, thumbnailRaw, detailRaw, bannerRaw] = item.split("|").map(part => part?.trim() ?? "");
      const imageUrl = normalizeAdminImageValue(imageUrlRaw);
      return {
        imageUrl,
        imageThumbnailUrl: normalizeAdminImageValue(thumbnailRaw) || null,
        imageDetailUrl: normalizeAdminImageValue(detailRaw) || null,
        imageBannerUrl: normalizeAdminImageValue(bannerRaw) || null,
        color: colorRaw || null,
      };
    })
    .filter(item => item.imageUrl);
}

function toProductImageEntry(upload: UploadedImage, color?: string | null): ProductImageEntry {
  return {
    imageUrl: normalizeAdminImageValue(upload.detailUrl || upload.url),
    imageThumbnailUrl: normalizeAdminImageValue(upload.thumbnailUrl) || null,
    imageDetailUrl: normalizeAdminImageValue(upload.detailUrl || upload.url) || null,
    imageBannerUrl: normalizeAdminImageValue(upload.bannerUrl) || null,
    color: color || null,
  };
}

function joinImageCsvEntries(currentValue: string, uploads: UploadedImage[], color?: string | null) {
  const current = parseImageCsvEntries(currentValue).map(item => formatImageCsvEntry(item, item.color));
  const incoming = uploads.map(upload => {
    const entry = toProductImageEntry(upload, color);
    return formatImageCsvEntry(entry, entry.color);
  });
  return Array.from(new Set([...current, ...incoming])).join(", ");
}

function removeImageCsvEntry(currentValue: string, targetUrl: string) {
  return parseImageCsvEntries(currentValue)
    .filter(item => item.imageUrl !== targetUrl)
    .map(item => formatImageCsvEntry(item, item.color))
    .join(", ");
}

function moveImageCsvEntryToCover(currentValue: string, targetUrl: string, currentCover: string) {
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
    imageThumbnailUrl: picked.imageThumbnailUrl || "",
    imageDetailUrl: picked.imageDetailUrl || targetUrl,
    imageBannerUrl: picked.imageBannerUrl || "",
    imagesCsv: nextEntries.map(item => formatImageCsvEntry(item, item.color)).join(", "),
  };
}

function appendCsvToken(currentValue: string, token: string) {
  const items = currentValue
    .split(",")
    .map(item => item.trim())
    .filter(Boolean);
  if (!items.includes(token)) items.push(token);
  return items.join(", ");
}

function parseProductOptionList(raw?: string | null): string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.map(item => String(item)).filter(Boolean) : [];
  } catch {
    return [];
  }
}

function buildVariantDraft(name: string, colorsCsv: string, sizesCsv: string, price: string) {
  const colors = colorsCsv.split(",").map(item => item.trim()).filter(Boolean);
  const sizes = sizesCsv.split(",").map(item => item.trim()).filter(Boolean);
  const basePrice = price.trim();
  const combinations: string[] = [];

  if (colors.length > 0 && sizes.length > 0) {
    for (const color of colors) {
      for (const size of sizes) {
        combinations.push(`${name} ${color} ${size}|${color.toUpperCase()}-${size.toUpperCase()}|${basePrice}|0`);
      }
    }
    return combinations.join("; ");
  }

  if (sizes.length > 0) {
    return sizes.map(size => `${name} ${size}|${size.toUpperCase()}|${basePrice}|0`).join("; ");
  }

  if (colors.length > 0) {
    return colors.map(color => `${name} ${color}|${color.toUpperCase()}|${basePrice}|0`).join("; ");
  }

  return "";
}

function getOrderStatusLabel(status: string) {
  switch (status) {
    case "pending":
      return "Aguardando pagamento";
    case "paid":
      return "Pagamento confirmado";
    case "processing":
      return "Em separação";
    case "shipped":
      return "Enviado";
    case "delivered":
      return "Entregue";
    case "cancelled":
      return "Cancelado";
    default:
      return status;
  }
}

function getOrderStatusTone(status: string): CSSProperties {
  switch (status) {
    case "paid":
      return { background: "rgba(21, 128, 61, 0.14)", border: "1px solid rgba(21, 128, 61, 0.28)", color: "#86efac" };
    case "processing":
      return { background: "rgba(15, 118, 110, 0.14)", border: "1px solid rgba(15, 118, 110, 0.28)", color: "#5eead4" };
    case "shipped":
      return { background: "rgba(37, 99, 235, 0.14)", border: "1px solid rgba(37, 99, 235, 0.28)", color: "#93c5fd" };
    case "delivered":
      return { background: "rgba(126, 34, 206, 0.14)", border: "1px solid rgba(126, 34, 206, 0.28)", color: "#d8b4fe" };
    case "cancelled":
      return { background: "rgba(185, 28, 28, 0.14)", border: "1px solid rgba(185, 28, 28, 0.28)", color: "#fca5a5" };
    default:
      return { background: "rgba(180, 83, 9, 0.14)", border: "1px solid rgba(180, 83, 9, 0.28)", color: "#fbbf24" };
  }
}

function formatAdminAddressLine(address?: {
  street?: string | null;
  number?: string | null;
  complement?: string | null;
  neighborhood?: string | null;
  city?: string | null;
  state?: string | null;
  zipCode?: string | null;
} | null) {
  if (!address) return [];

  const lineOne = [address.street, address.number].filter(Boolean).join(", ");
  const lineOneWithComplement = [lineOne, address.complement].filter(Boolean).join(" • ");
  const lineTwo = [address.neighborhood, [address.city, address.state].filter(Boolean).join(" - ")].filter(Boolean).join(" • ");
  const lineThree = address.zipCode ? `CEP ${address.zipCode}` : "";

  return [lineOneWithComplement, lineTwo, lineThree].filter(Boolean);
}

function confirmAdminAction(message: string) {
  return window.confirm(message);
}

export default function Admin() {
  const navigate = useNavigate();
  const isMobile = useIsMobile();
  const isCompactAdmin = useIsMobile(1180);
  const { user, isAuthenticated } = useUser();
  const { showToast } = useToast();
  const utils = trpc.useUtils();

  const [section, setSection] = useState<Section>("overview");
  const [orderFilterStatus, setOrderFilterStatus] = useState<string>("");
  const [customerSearch, setCustomerSearch] = useState("");
  const [customerFilter, setCustomerFilter] = useState<CustomerListFilter>("all");
  const [productSearch, setProductSearch] = useState("");
  const [productFilter, setProductFilter] = useState<ProductListFilter>("all");
  const [orderSearch, setOrderSearch] = useState("");
  const [orderQuickFilter, setOrderQuickFilter] = useState<OrderListFilter>("all");
  const [reportFrom, setReportFrom] = useState("");
  const [reportTo, setReportTo] = useState("");
  const [restoreFileName, setRestoreFileName] = useState("");
  const [newCoupon, setNewCoupon] = useState({ code: "", type: "percent", value: "10", maxUses: "" });
  const [launchEmailForm, setLaunchEmailForm] = useState({
    couponCode: "lançamento15",
    discountPercent: "15",
    launchUrl: "https://l4ckos.com.br",
    batchSize: "25",
  });
  const [launchEmailResult, setLaunchEmailResult] = useState<null | {
    total: number;
    sent: number;
    failed: number;
    message: string;
    failures: Array<{ email: string; message: string }>;
  }>(null);
  const [selectedOrderId, setSelectedOrderId] = useState<number | null>(null);
  const [newProduct, setNewProduct] = useState({ ...emptyProductForm });
  const [editingProductId, setEditingProductId] = useState<number | null>(null);
  const [editProduct, setEditProduct] = useState({ ...emptyProductForm });
  const [quickProductEdits, setQuickProductEdits] = useState<Record<number, { price: string; stock: string }>>({});
  const [newPromo, setNewPromo] = useState({ ...emptyPromoForm });
  const [editingPromoId, setEditingPromoId] = useState<number | null>(null);
  const [draggingPromoId, setDraggingPromoId] = useState<number | null>(null);
  const [uploadingField, setUploadingField] = useState<string | null>(null);
  const createMainImageInputRef = useRef<HTMLInputElement | null>(null);
  const createGalleryImageInputRef = useRef<HTMLInputElement | null>(null);
  const editMainImageInputRef = useRef<HTMLInputElement | null>(null);
  const editGalleryImageInputRef = useRef<HTMLInputElement | null>(null);
  const promoImageInputRef = useRef<HTMLInputElement | null>(null);
  const promoMobileImageInputRef = useRef<HTMLInputElement | null>(null);
  const isAdmin = user?.role === "admin";

  async function uploadAdminImages(files: FileList | null, mode: "single" | "multiple", target: string) {
    if (!files || files.length === 0) return [];

    const allowedFiles = Array.from(files).filter(file => file.type.startsWith("image/"));
    if (allowedFiles.length === 0) {
      showToast({ message: "Selecione ao menos uma imagem válida", duration: 2400 });
      return [];
    }

    setUploadingField(target);

    try {
      const uploadedImages: UploadedImage[] = [];

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

        uploadedImages.push({
          url: String(payload.url),
          originalUrl: payload.originalUrl ? String(payload.originalUrl) : null,
          thumbnailUrl: payload.thumbnailUrl ? String(payload.thumbnailUrl) : null,
          detailUrl: payload.detailUrl ? String(payload.detailUrl) : null,
          bannerUrl: payload.bannerUrl ? String(payload.bannerUrl) : null,
        });
        if (mode === "single") break;
      }

      showToast({
        message: uploadedImages.length > 1 ? "Imagens enviadas com sucesso" : "Imagem enviada com sucesso",
        duration: 2200,
      });

      return uploadedImages;
    } catch (error: any) {
      showToast({ message: error?.message || "Não foi possível enviar a imagem", duration: 2800 });
      return [];
    } finally {
      setUploadingField(null);
    }
  }

  async function reorderPromoBanners(draggedId: number, targetId: number) {
    const currentRows = [...(promoBannersQuery.data ?? [])];
    if (currentRows.length <= 1 || draggedId === targetId) return;

    const draggedIndex = currentRows.findIndex(row => row.id === draggedId);
    const targetIndex = currentRows.findIndex(row => row.id === targetId);
    if (draggedIndex < 0 || targetIndex < 0) return;

    const reordered = [...currentRows];
    const [draggedRow] = reordered.splice(draggedIndex, 1);
    reordered.splice(targetIndex, 0, draggedRow);

    try {
      for (let index = 0; index < reordered.length; index += 1) {
        const row = reordered[index];
        if (Number(row.sortOrder ?? 0) === index) continue;
        await reorderPromoBannerMutation.mutateAsync({ id: row.id, sortOrder: index });
      }
      showToast({ message: "Ordem dos banners atualizada", duration: 2200 });
      void promoBannersQuery.refetch();
    } catch {}
  }

  const dashboardQuery = trpc.admin.dashboard.useQuery(undefined, { enabled: isAuthenticated && isAdmin });
  const customersQuery = trpc.admin.usersList.useQuery(undefined, { enabled: isAuthenticated && isAdmin });
  const productsQuery = trpc.admin.productsList.useQuery(undefined, { enabled: isAuthenticated && isAdmin });
  const ordersQuery = trpc.admin.ordersList.useQuery(
    orderFilterStatus ? { status: orderFilterStatus as any } : undefined,
    { enabled: isAuthenticated && isAdmin },
  );
  const promoBannersQuery = trpc.admin.promoBannersList.useQuery(undefined, { enabled: isAuthenticated && isAdmin });
  const couponsQuery = trpc.admin.couponsList.useQuery(undefined, { enabled: isAuthenticated && isAdmin });
  const auditQuery = trpc.admin.auditList.useQuery({ limit: 200 }, { enabled: isAuthenticated && isAdmin });
  const backupsQuery = trpc.admin.backupsList.useQuery(undefined, { enabled: isAuthenticated && isAdmin });

  const setRoleMutation = trpc.admin.userSetRole.useMutation({
    onSuccess: () => {
      showToast({ message: "Role atualizada", duration: 2000 });
      void customersQuery.refetch();
    },
    onError: error => showToast({ message: error.message, duration: 2600 }),
  });

  const setFlagsMutation = trpc.admin.userSetFlags.useMutation({
    onSuccess: () => {
      showToast({ message: "Cliente atualizado", duration: 2000 });
      void customersQuery.refetch();
    },
    onError: error => showToast({ message: error.message, duration: 2600 }),
  });

  const createProductMutation = trpc.admin.productCreate.useMutation({
    onSuccess: () => {
      showToast({ message: "Produto criado", duration: 2000 });
      setNewProduct({ ...emptyProductForm });
      void productsQuery.refetch();
      void dashboardQuery.refetch();
    },
    onError: error => showToast({ message: error.message, duration: 2600 }),
  });

  const updateProductMutation = trpc.admin.productUpdate.useMutation({
    onSuccess: () => {
      showToast({ message: "Produto atualizado", duration: 2000 });
      setEditingProductId(null);
      setEditProduct({ ...emptyProductForm });
      void productsQuery.refetch();
      void dashboardQuery.refetch();
    },
    onError: error => showToast({ message: error.message, duration: 2600 }),
  });

  const quickUpdateProductMutation = trpc.admin.productUpdate.useMutation({
    onSuccess: () => {
      showToast({ message: "Produto atualizado", duration: 2000 });
      void productsQuery.refetch();
      void dashboardQuery.refetch();
    },
    onError: error => showToast({ message: error.message, duration: 2600 }),
  });

  const deleteProductMutation = trpc.admin.productDelete.useMutation({
    onSuccess: () => {
      showToast({ message: "Produto removido", duration: 2000 });
      void productsQuery.refetch();
      void dashboardQuery.refetch();
    },
    onError: error => showToast({ message: error.message, duration: 2600 }),
  });

  const updateOrderMutation = trpc.admin.orderUpdate.useMutation({
    onSuccess: () => {
      showToast({ message: "Pedido atualizado", duration: 2000 });
      void ordersQuery.refetch();
      void dashboardQuery.refetch();
    },
    onError: error => showToast({ message: error.message, duration: 2600 }),
  });

  const couponCreateMutation = trpc.admin.couponCreate.useMutation({
    onSuccess: () => {
      showToast({ message: "Cupom criado", duration: 2000 });
      setNewCoupon({ code: "", type: "percent", value: "10", maxUses: "" });
      void couponsQuery.refetch();
    },
    onError: error => showToast({ message: error.message, duration: 2600 }),
  });

  const couponDeleteMutation = trpc.admin.couponDelete.useMutation({
    onSuccess: () => {
      showToast({ message: "Cupom removido", duration: 2000 });
      void couponsQuery.refetch();
    },
    onError: error => showToast({ message: error.message, duration: 2600 }),
  });

  const waitlistLaunchSendMutation = trpc.admin.waitlistLaunchSend.useMutation({
    onSuccess: data => {
      setLaunchEmailResult({
        total: data.total,
        sent: data.sent,
        failed: data.failed,
        message: data.message,
        failures: [...data.failures],
      });
      showToast({ message: data.message, duration: 3200 });
    },
    onError: error => showToast({ message: error.message, duration: 3200 }),
  });

  const createPromoBannerMutation = trpc.admin.promoBannerCreate.useMutation({
    onSuccess: () => {
      showToast({ message: "Banner promocional criado", duration: 2000 });
      setNewPromo({ ...emptyPromoForm });
      void promoBannersQuery.refetch();
    },
    onError: error => showToast({ message: error.message, duration: 2600 }),
  });

  const updatePromoBannerMutation = trpc.admin.promoBannerUpdate.useMutation({
    onSuccess: () => {
      showToast({ message: "Banner promocional atualizado", duration: 2000 });
      setEditingPromoId(null);
      setNewPromo({ ...emptyPromoForm });
      void promoBannersQuery.refetch();
    },
    onError: error => showToast({ message: error.message, duration: 2600 }),
  });

  const reorderPromoBannerMutation = trpc.admin.promoBannerUpdate.useMutation({
    onError: error => showToast({ message: error.message, duration: 2600 }),
  });

  const deletePromoBannerMutation = trpc.admin.promoBannerDelete.useMutation({
    onSuccess: () => {
      showToast({ message: "Banner promocional removido", duration: 2000 });
      void promoBannersQuery.refetch();
    },
    onError: error => showToast({ message: error.message, duration: 2600 }),
  });

  const backupManualMutation = trpc.admin.backupManual.useMutation({
    onSuccess: data => {
      showToast({ message: `Backup criado: ${data.fileName}`, duration: 2600 });
      void backupsQuery.refetch();
    },
    onError: error => showToast({ message: error.message, duration: 2600 }),
  });

  const backupRestoreMutation = trpc.admin.backupRestore.useMutation({
    onSuccess: () => {
      showToast({ message: "Backup restaurado", duration: 2600 });
      void Promise.all([
        customersQuery.refetch(),
        productsQuery.refetch(),
        ordersQuery.refetch(),
        couponsQuery.refetch(),
        auditQuery.refetch(),
      ]);
    },
    onError: error => showToast({ message: error.message, duration: 2600 }),
  });

  const reportQuery = trpc.admin.reportsSalesCsv.useQuery(
    { from: reportFrom || new Date(Date.now() - 7 * 86400000).toISOString(), to: reportTo || new Date().toISOString() },
    { enabled: false },
  );

  const searchedCustomers = useMemo(() => {
    const normalizedSearch = customerSearch.trim().toLowerCase();
    return [...(customersQuery.data ?? [])]
      .filter(row => {
        if (!normalizedSearch) return true;
        return [row.name, row.email, String(row.id)]
          .some(value => String(value ?? "").toLowerCase().includes(normalizedSearch));
      })
      .sort((a, b) => b.id - a.id);
  }, [customerSearch, customersQuery.data]);
  const customerSummary = useMemo(() => {
    const rows = customersQuery.data ?? [];
    const recentCutoff = Date.now() - 30 * 24 * 60 * 60 * 1000;

    return {
      total: rows.length,
      admins: rows.filter(row => row.role === "admin").length,
      customers: rows.filter(row => row.role === "user").length,
      vip: rows.filter(row => Boolean(row.isVip)).length,
      blocked: rows.filter(row => Boolean(row.isBlocked)).length,
      active: rows.filter(row => !row.isBlocked).length,
      recent: rows.filter(row => {
        const createdAt = new Date(row.createdAt as any).getTime();
        return Number.isFinite(createdAt) && createdAt >= recentCutoff;
      }).length,
    };
  }, [customersQuery.data]);
  const customerFilterOptions = useMemo(
    () => [
      { key: "all" as const, label: "Todos", count: searchedCustomers.length },
      { key: "admins" as const, label: "Admins", count: searchedCustomers.filter(row => row.role === "admin").length },
      { key: "customers" as const, label: "Clientes", count: searchedCustomers.filter(row => row.role === "user").length },
      { key: "vip" as const, label: "VIP", count: searchedCustomers.filter(row => Boolean(row.isVip)).length },
      { key: "blocked" as const, label: "Bloqueados", count: searchedCustomers.filter(row => Boolean(row.isBlocked)).length },
      { key: "active" as const, label: "Ativos", count: searchedCustomers.filter(row => !row.isBlocked).length },
      {
        key: "recent" as const,
        label: "Recentes",
        count: searchedCustomers.filter(row => {
          const createdAt = new Date(row.createdAt as any).getTime();
          return Number.isFinite(createdAt) && createdAt >= Date.now() - 30 * 24 * 60 * 60 * 1000;
        }).length,
      },
    ],
    [searchedCustomers],
  );
  const customers = useMemo(() => {
    const recentCutoff = Date.now() - 30 * 24 * 60 * 60 * 1000;

    return searchedCustomers.filter(row => {
      if (customerFilter === "admins") return row.role === "admin";
      if (customerFilter === "customers") return row.role === "user";
      if (customerFilter === "vip") return Boolean(row.isVip);
      if (customerFilter === "blocked") return Boolean(row.isBlocked);
      if (customerFilter === "active") return !row.isBlocked;
      if (customerFilter === "recent") {
        const createdAt = new Date(row.createdAt as any).getTime();
        return Number.isFinite(createdAt) && createdAt >= recentCutoff;
      }
      return true;
    });
  }, [customerFilter, searchedCustomers]);
  const searchedProducts = useMemo(() => {
    const normalizedSearch = productSearch.trim().toLowerCase();
    return [...(productsQuery.data ?? [])]
      .filter(row => {
        if (!normalizedSearch) return true;
        return [row.name, row.category, row.description, String(row.id)]
          .some(value => String(value ?? "").toLowerCase().includes(normalizedSearch));
      })
      .sort((a, b) => b.id - a.id);
  }, [productSearch, productsQuery.data]);
  const productSummary = useMemo(() => {
    const rows = productsQuery.data ?? [];
    return {
      total: rows.length,
      withStock: rows.filter(row => Number(row.stock ?? 0) > 0).length,
      outOfStock: rows.filter(row => Number(row.stock ?? 0) <= 0).length,
      lowStock: rows.filter(row => Number(row.stock ?? 0) > 0 && Number(row.stock ?? 0) <= 5).length,
      withoutImage: rows.filter(row => !resolveAdminImageUrl(row.imageUrl)).length,
      withVariants: rows.filter(row => (row.variants?.length ?? 0) > 0).length,
    };
  }, [productsQuery.data]);
  const productFilterOptions = useMemo(
    () => [
      { key: "all" as const, label: "Todos", count: searchedProducts.length },
      { key: "lowStock" as const, label: "Estoque baixo", count: searchedProducts.filter(row => Number(row.stock ?? 0) > 0 && Number(row.stock ?? 0) <= 5).length },
      { key: "outOfStock" as const, label: "Sem estoque", count: searchedProducts.filter(row => Number(row.stock ?? 0) <= 0).length },
      { key: "withoutImage" as const, label: "Sem imagem", count: searchedProducts.filter(row => !resolveAdminImageUrl(row.imageUrl)).length },
      { key: "withVariants" as const, label: "Com variantes", count: searchedProducts.filter(row => (row.variants?.length ?? 0) > 0).length },
    ],
    [searchedProducts],
  );
  const products = useMemo(() => {
    return searchedProducts.filter(row => {
      if (productFilter === "lowStock") return Number(row.stock ?? 0) > 0 && Number(row.stock ?? 0) <= 5;
      if (productFilter === "outOfStock") return Number(row.stock ?? 0) <= 0;
      if (productFilter === "withoutImage") return !resolveAdminImageUrl(row.imageUrl);
      if (productFilter === "withVariants") return (row.variants?.length ?? 0) > 0;
      return true;
    });
  }, [productFilter, searchedProducts]);
  const searchedOrders = useMemo(() => {
    const normalizedSearch = orderSearch.trim().toLowerCase();
    return [...(ordersQuery.data ?? [])]
      .filter(row => {
        if (!normalizedSearch) return true;
        return [
          String(row.id),
          row.customerName,
          row.customerEmail,
          row.trackingCode,
          String(row.userId),
        ].some(value => String(value ?? "").toLowerCase().includes(normalizedSearch));
      })
      .sort((a, b) => b.id - a.id);
  }, [orderSearch, ordersQuery.data]);
  const ordersSummary = useMemo(() => {
    const rows = ordersQuery.data ?? [];
    const withoutTracking = rows.filter(row => ["paid", "processing", "shipped"].includes(String(row.status ?? "")) && !row.trackingCode).length;
    return {
      total: rows.length,
      pending: rows.filter(row => row.status === "pending").length,
      paid: rows.filter(row => row.status === "paid").length,
      processing: rows.filter(row => row.status === "processing").length,
      shipped: rows.filter(row => row.status === "shipped").length,
      delivered: rows.filter(row => row.status === "delivered").length,
      cancelled: rows.filter(row => row.status === "cancelled").length,
      withoutTracking,
      revenueCents: rows.reduce((sum, row) => sum + Number(row.totalPrice ?? 0), 0),
    };
  }, [ordersQuery.data]);
  const orderFilterOptions = useMemo(
    () => [
      { key: "all" as const, label: "Todos", count: searchedOrders.length },
      { key: "pending" as const, label: "Pendentes", count: searchedOrders.filter(row => row.status === "pending").length },
      { key: "paid" as const, label: "Pagos", count: searchedOrders.filter(row => row.status === "paid").length },
      { key: "processing" as const, label: "Separação", count: searchedOrders.filter(row => row.status === "processing").length },
      { key: "shipped" as const, label: "Enviados", count: searchedOrders.filter(row => row.status === "shipped").length },
      { key: "delivered" as const, label: "Entregues", count: searchedOrders.filter(row => row.status === "delivered").length },
      { key: "cancelled" as const, label: "Cancelados", count: searchedOrders.filter(row => row.status === "cancelled").length },
      {
        key: "withoutTracking" as const,
        label: "Sem rastreio",
        count: searchedOrders.filter(row => ["paid", "processing", "shipped"].includes(String(row.status ?? "")) && !row.trackingCode).length,
      },
    ],
    [searchedOrders],
  );
  const orders = useMemo(() => {
    return searchedOrders.filter(row => {
      if (orderQuickFilter === "withoutTracking") return ["paid", "processing", "shipped"].includes(String(row.status ?? "")) && !row.trackingCode;
      if (orderQuickFilter === "all") return true;
      return row.status === orderQuickFilter;
    });
  }, [orderQuickFilter, searchedOrders]);
  const promoSummary = useMemo(() => {
    const rows = promoBannersQuery.data ?? [];
    return {
      total: rows.length,
      active: rows.filter(row => Boolean(row.isActive)).length,
      inactive: rows.filter(row => !row.isActive).length,
      withDesktopImage: rows.filter(row => Boolean(resolveAdminImageUrl(row.imageUrl))).length,
      withMobileImage: rows.filter(row => Boolean(resolveAdminImageUrl(row.mobileImageUrl))).length,
      withoutImage: rows.filter(row => !resolveAdminImageUrl(row.imageUrl)).length,
    };
  }, [promoBannersQuery.data]);
  const orderOperationalAlerts = useMemo(() => {
    const rows = ordersQuery.data ?? [];
    const paidWithoutTracking = rows.filter(row => row.status === "paid" && !row.trackingCode).length;
    const shippedWithoutTracking = rows.filter(row => row.status === "shipped" && !row.trackingCode).length;
    const oldPending = rows.filter(row => {
      if (row.status !== "pending" || !row.createdAt) return false;
      return Date.now() - new Date(row.createdAt).getTime() > 48 * 60 * 60 * 1000;
    }).length;
    const recentCancelled = rows.filter(row => {
      if (row.status !== "cancelled" || !row.createdAt) return false;
      return Date.now() - new Date(row.createdAt).getTime() <= 7 * 24 * 60 * 60 * 1000;
    }).length;

    return [
      ...(paidWithoutTracking > 0
        ? [{ title: `${paidWithoutTracking} pedido(s) pago(s) sem rastreio`, description: "Revise pedidos pagos aguardando envio ou código de rastreio.", tone: "warning" as const }]
        : []),
      ...(shippedWithoutTracking > 0
        ? [{ title: `${shippedWithoutTracking} pedido(s) enviado(s) sem rastreio`, description: "Pedidos enviados deveriam ter rastreio conferido no painel.", tone: "danger" as const }]
        : []),
      ...(oldPending > 0
        ? [{ title: `${oldPending} pedido(s) pendente(s) há mais de 48h`, description: "Acompanhe para evitar pedidos esquecidos no fluxo.", tone: "warning" as const }]
        : []),
      ...(recentCancelled > 0
        ? [{ title: `${recentCancelled} cancelamento(s) recente(s)`, description: "Pedidos cancelados nos últimos 7 dias aparecem aqui para conferência.", tone: "neutral" as const }]
        : []),
    ];
  }, [ordersQuery.data]);
  const selectedOrder = useMemo(
    () => orders.find(order => order.id === selectedOrderId) ?? orders[0] ?? null,
    [orders, selectedOrderId],
  );
  const recentAudit = useMemo(() => (auditQuery.data ?? []).slice(0, 5), [auditQuery.data]);
  const orderStatusSummary = useMemo(
    () =>
      orderStatuses.map(status => ({
        status,
        label: getOrderStatusLabel(status),
        count: orders.filter(order => order.status === status).length,
      })),
    [orders],
  );
  const operationalAlerts = useMemo(() => {
    const alerts: Array<{ title: string; description: string; tone: "danger" | "warning" | "neutral" }> = [];
    const pendingOrders = orders.filter(order => order.status === "pending").length;
    const paidOrders = orders.filter(order => order.status === "paid").length;
    const emptyStockProducts = products.filter(product => Number(product.stock ?? 0) <= 0).length;
    const lowStockTotal = products.filter(product => Number(product.stock ?? 0) > 0 && Number(product.stock ?? 0) <= 5).length;

    if (pendingOrders > 0) {
      alerts.push({
        title: `${pendingOrders} pedido(s) aguardando pagamento`,
        description: "Acompanhe para evitar pedidos esquecidos no fluxo.",
        tone: "warning",
      });
    }
    if (paidOrders > 0) {
      alerts.push({
        title: `${paidOrders} pedido(s) pago(s) para separar`,
        description: "Priorize a operação de separação e envio.",
        tone: "neutral",
      });
    }
    if (emptyStockProducts > 0) {
      alerts.push({
        title: `${emptyStockProducts} produto(s) sem estoque`,
        description: "Revise disponibilidade antes de novas campanhas.",
        tone: "danger",
      });
    }
    if (lowStockTotal > 0) {
      alerts.push({
        title: `${lowStockTotal} produto(s) com estoque baixo`,
        description: "Itens com 1 a 5 unidades disponíveis.",
        tone: "warning",
      });
    }

    return alerts;
  }, [orders, products]);
  const quickActions = useMemo(
    () => [
      { label: "Novo produto", caption: "Cadastre ou atualize o catálogo", onClick: () => setSection("products") },
      { label: "Pedidos", caption: "Acompanhe status e rastreio", onClick: () => setSection("orders") },
      { label: "Clientes", caption: "Revise VIP, bloqueios e perfis", onClick: () => setSection("customers") },
      { label: "Cupons", caption: "Gerencie promoções e descontos", onClick: () => setSection("coupons") },
    ],
    [],
  );
  const wideFieldStyle = { ...styles.mediaField, gridColumn: "1 / -1" } as CSSProperties;
  const mediumFieldStyle = { ...styles.mediaField, gridColumn: "span 2" } as CSSProperties;

  if (!isAuthenticated) {
    return (
      <div style={styles.centerCard}>
        <h1 style={styles.title}>Acesso negado</h1>
        <p style={styles.muted}>Faça login para acessar a área administrativa.</p>
        <button style={styles.primaryBtn} onClick={() => navigate("/login")}>Ir para login</button>
      </div>
    );
  }

  if (!isAdmin) {
    return (
      <div style={styles.centerCard}>
        <h1 style={styles.title}>Sem permissão</h1>
        <p style={styles.muted}>Esta área é exclusiva para administradores.</p>
        <button style={styles.primaryBtn} onClick={() => navigate("/")}>Voltar para início</button>
      </div>
    );
  }

  return (
    <div className="l4-admin" style={styles.container}>
      <style>{adminCss}</style>
      <AdminPageHeader
        title="Painel Administrativo"
        subtitle="Monitore o sistema, acompanhe pedidos, organize o catálogo e mantenha as operações críticas sob controle em um único lugar."
        actions={[
          { label: "Ver pedidos", onClick: () => setSection("orders") },
          { label: "Abrir produtos", onClick: () => setSection("products") },
        ]}
      />

      <div style={styles.tabs}>
        {[
          { key: "overview", label: "KPIs" },
          { key: "customers", label: "Clientes" },
          { key: "products", label: "Produtos" },
          { key: "promos", label: "Promoções" },
          { key: "orders", label: "Pedidos" },
          { key: "coupons", label: "Cupons" },
          { key: "reports", label: "Relatórios" },
          { key: "audit", label: "Auditoria" },
          { key: "backup", label: "Backup" },
        ].map(tab => (
          <button
            key={tab.key}
            style={{ ...styles.tabBtn, ...(section === tab.key ? styles.tabBtnActive : {}) }}
            onClick={() => setSection(tab.key as Section)}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {section === "overview" && (
        <AdminDashboard
          dashboardData={dashboardQuery.data}
          isMobile={isMobile}
          isCompact={isCompactAdmin}
          orders={orders}
          products={products}
          promoBanners={promoBannersQuery.data ?? []}
          coupons={couponsQuery.data ?? []}
          recentAudit={recentAudit}
          quickActions={quickActions}
          ordersLoading={ordersQuery.isLoading}
          productsLoading={productsQuery.isLoading}
          orderStatusSummary={orderStatusSummary}
          operationalAlerts={operationalAlerts}
          getOrderStatusLabel={getOrderStatusLabel}
          getOrderStatusTone={getOrderStatusTone}
          onViewOrder={orderId => {
            setSelectedOrderId(orderId);
            setSection("orders");
          }}
          onViewProduct={product => {
            setProductSearch(product.name ?? String(product.id));
            setSection("products");
          }}
        />
      )}

      {section === "customers" && (
        <AdminSurface
          title="Clientes e usuários"
          description="Gerencie perfis, permissões e sinais operacionais dos usuários cadastrados com mais clareza."
        >
          <CustomersSummaryCards summary={customerSummary} />
          <div style={styles.inlineRow}>
            <input
              style={{ ...styles.input, minWidth: 260 }}
              placeholder="Buscar por nome, e-mail ou ID"
              value={customerSearch}
              onChange={e => setCustomerSearch(e.target.value)}
            />
            <AdminSummaryPill>Exibindo: {customers.length}</AdminSummaryPill>
            <AdminSummaryPill>Busca: {searchedCustomers.length}</AdminSummaryPill>
          </div>
          <CustomersFilters
            value={customerFilter}
            onChange={setCustomerFilter}
            options={customerFilterOptions}
          />
          {customersQuery.isLoading ? (
            <AdminLoadingState>Carregando clientes...</AdminLoadingState>
          ) : (customersQuery.data ?? []).length === 0 ? (
            <AdminEmptyState
              title="Nenhum cliente cadastrado"
              description="Quando houver usuários cadastrados, eles aparecerão aqui com seus indicadores principais."
            />
          ) : customers.length === 0 ? (
            <AdminEmptyState
              title="Nenhum cliente encontrado"
              description="Ajuste a busca ou os filtros para encontrar outros usuários carregados."
            />
          ) : (
            <AdminTableWrapper>
              <table style={styles.table}>
                <thead><tr><th>Cliente</th><th>Role</th><th>Status</th><th>Pedidos</th><th>Datas</th><th>Ações</th></tr></thead>
                <tbody>
                  {customers.map(row => (
                    <tr key={row.id}>
                      <td><CustomerProfileCell customer={row} /></td>
                      <td><CustomerRoleBadge role={row.role} /></td>
                      <td><CustomerStatusBadges customer={row} /></td>
                      <td><CustomerOrdersCount value={row.ordersCount} /></td>
                      <td><CustomerDateMeta createdAt={row.createdAt} lastSignedIn={row.lastSignedIn} /></td>
                      <td style={styles.actionsCell}>
                        <button
                          style={styles.smallBtn}
                          onClick={() => {
                            const nextRole = row.role === "admin" ? "user" : "admin";
                            const action = nextRole === "admin" ? "tornar admin" : "remover admin";
                            if (!confirmAdminAction(`Confirmar ${action} para ${row.email || row.name || `#${row.id}`}?`)) return;
                            setRoleMutation.mutate({ userId: row.id, role: nextRole });
                          }}
                        >
                          {row.role === "admin" ? "Remover admin" : "Tornar admin"}
                        </button>
                        <button
                          style={styles.smallBtn}
                          onClick={() => {
                            const action = row.isVip ? "remover VIP de" : "marcar como VIP";
                            if (!confirmAdminAction(`Confirmar ${action} ${row.email || row.name || `#${row.id}`}?`)) return;
                            setFlagsMutation.mutate({ userId: row.id, isVip: !row.isVip });
                          }}
                        >
                          {row.isVip ? "Remover VIP" : "Marcar VIP"}
                        </button>
                        <button
                          style={styles.dangerBtn}
                          onClick={() => {
                            const action = row.isBlocked ? "desbloquear" : "bloquear";
                            if (!confirmAdminAction(`Confirmar ${action} o usuário ${row.email || `#${row.id}`}?`)) return;
                            setFlagsMutation.mutate({ userId: row.id, isBlocked: !row.isBlocked });
                          }}
                        >
                          {row.isBlocked ? "Desbloquear" : "Bloquear"}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </AdminTableWrapper>
          )}
        </AdminSurface>
      )}

      {section === "products" && (
        <div style={styles.card}>
          <div style={styles.productSectionHero}>
            <div>
              <h2 style={styles.sectionTitle}>Produtos</h2>
              <p style={styles.productAdminText}>
                Cadastre, revise estoque, organize imagens e acompanhe a saúde operacional do catálogo.
              </p>
            </div>
          </div>
          <ProductsSummaryCards summary={productSummary} />
          <div style={styles.inlineRow}>
            <input
              style={{ ...styles.input, minWidth: 280 }}
              placeholder="Buscar produto por nome, categoria ou ID"
              value={productSearch}
              onChange={e => setProductSearch(e.target.value)}
            />
            <AdminSummaryPill>Exibindo: {products.length}</AdminSummaryPill>
            <AdminSummaryPill>Busca: {searchedProducts.length}</AdminSummaryPill>
          </div>
          <ProductsFilters
            value={productFilter}
            onChange={setProductFilter}
            options={productFilterOptions}
          />
          <div style={styles.productAdminHeader}>
            <div>
              <h3 style={styles.productAdminTitle}>Criar produto</h3>
              <p style={styles.productAdminText}>Preencha as informações principais, organize a categoria e publique o item com uma estrutura mais clara.</p>
            </div>
          </div>
            <div style={styles.formGrid}>
              <input style={styles.input} placeholder="Nome do produto" value={newProduct.name} onChange={e => setNewProduct(prev => ({ ...prev, name: e.target.value }))} />
              <select style={styles.select} value={newProduct.category} onChange={e => setNewProduct(prev => ({ ...prev, category: e.target.value }))}>
                <option value="">Selecione a categoria</option>
                {PRODUCT_CATEGORIES.map(cat => (
                  <option key={cat.value} value={cat.value}>{cat.label}</option>
                ))}
              </select>
            <div style={styles.categoryPreviewBox}>
              <span style={styles.categoryPreviewLabel}>Prévia da categoria</span>
              <strong style={styles.categoryPreviewValue}>{newProduct.category ? getCategoryLabel(newProduct.category) : "Selecione uma categoria"}</strong>
              <span style={styles.categoryPreviewHint}>Essa categoria define onde o produto aparece para o cliente na vitrine e nas páginas dedicadas.</span>
            </div>
            <input style={styles.input} placeholder="Preço (R$)" value={newProduct.price} onChange={e => setNewProduct(prev => ({ ...prev, price: e.target.value }))} />
            <input style={styles.input} placeholder="Estoque disponível" value={newProduct.stock} onChange={e => setNewProduct(prev => ({ ...prev, stock: e.target.value }))} />
            <div style={mediumFieldStyle}>
              <input style={styles.input} placeholder="Cores (CSV: preto, branco, verde)" value={newProduct.colorsCsv} onChange={e => setNewProduct(prev => ({ ...prev, colorsCsv: e.target.value }))} />
              <div style={styles.quickPickRow}>
                {productColorSuggestions.map(color => (
                  <button key={color} style={styles.quickPickBtn} onClick={() => setNewProduct(prev => ({ ...prev, colorsCsv: appendCsvToken(prev.colorsCsv, color) }))}>
                    {color}
                  </button>
                ))}
              </div>
            </div>
            <select style={styles.select} value={newProduct.sizeType} onChange={e => setNewProduct(prev => ({ ...prev, sizeType: e.target.value }))}>
              <option value="alpha">Tamanho alfabético (PP, P, M...)</option>
              <option value="numeric">Tamanho numérico (36, 38, 40...)</option>
              <option value="custom">Tamanho customizado</option>
            </select>
            <div style={mediumFieldStyle}>
              <input style={styles.input} placeholder="Tamanhos (CSV: PP, P, M, G, GG ou 36, 38, 40)" value={newProduct.sizesCsv} onChange={e => setNewProduct(prev => ({ ...prev, sizesCsv: e.target.value }))} />
              <div style={styles.quickPickRow}>
                {(newProduct.sizeType === "numeric" ? numericSizeSuggestions : alphaSizeSuggestions).map(size => (
                  <button key={size} style={styles.quickPickBtn} onClick={() => setNewProduct(prev => ({ ...prev, sizesCsv: appendCsvToken(prev.sizesCsv, size) }))}>
                    {size}
                  </button>
                ))}
              </div>
            </div>
            <div style={mediumFieldStyle}>
              <input style={styles.input} placeholder="Imagem principal" value={newProduct.imageUrl} onChange={e => setNewProduct(prev => ({ ...prev, imageUrl: e.target.value }))} />
              <div style={styles.mediaActions}>
                <button
                  style={styles.secondaryBtn}
                  onClick={() => createMainImageInputRef.current?.click()}
                  disabled={uploadingField === "create-main"}
                >
                  {uploadingField === "create-main" ? "Enviando capa..." : "Upload da capa"}
                </button>
                <span style={styles.mediaHint}>Ou cole uma URL manualmente.</span>
              </div>
              <input
                ref={createMainImageInputRef}
                type="file"
                accept="image/*"
                style={styles.hiddenFileInput}
                onChange={async e => {
                  const urls = await uploadAdminImages(e.target.files, "single", "create-main");
                  if (urls[0]) {
                    setNewProduct(prev => ({
                      ...prev,
                      imageUrl: urls[0].detailUrl || urls[0].url,
                      imageThumbnailUrl: urls[0].thumbnailUrl || "",
                      imageDetailUrl: urls[0].detailUrl || urls[0].url,
                      imageBannerUrl: urls[0].bannerUrl || "",
                    }));
                  }
                  e.currentTarget.value = "";
                }}
              />
              {resolveAdminImageUrl(newProduct.imageUrl) ? (
                <AdminImagePreview
                  src={resolveAdminImageUrl(newProduct.imageUrl)}
                  alt="Prévia da capa"
                  caption="Capa pronta para o card e para a página do produto."
                />
              ) : null}
            </div>
            <div style={wideFieldStyle}>
              <input style={styles.input} placeholder="Outras imagens (CSV)" value={newProduct.imagesCsv} onChange={e => setNewProduct(prev => ({ ...prev, imagesCsv: e.target.value }))} />
              <select
                style={styles.select}
                value={newProduct.galleryColor}
                onChange={e => setNewProduct(prev => ({ ...prev, galleryColor: e.target.value }))}
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
                  {uploadingField === "create-gallery" ? "Enviando galeria..." : "Upload da galeria"}
                </button>
                <span style={styles.mediaHint}>Você pode selecionar várias imagens de uma vez.</span>
              </div>
              <input
                ref={createGalleryImageInputRef}
                type="file"
                accept="image/*"
                multiple
                style={styles.hiddenFileInput}
                onChange={async e => {
                  const urls = await uploadAdminImages(e.target.files, "multiple", "create-gallery");
                  if (urls.length > 0) {
                    setNewProduct(prev => ({
                      ...prev,
                      imagesCsv: joinImageCsvEntries(prev.imagesCsv, urls, prev.galleryColor || null),
                    }));
                  }
                  e.currentTarget.value = "";
                }}
              />
              <span style={styles.mediaHint}>Use `url|cor` para vincular uma imagem a uma cor específica do produto.</span>
              {parseImageCsvEntries(newProduct.imagesCsv).length > 0 ? (
                <div style={styles.galleryPreviewGrid}>
                  {parseImageCsvEntries(newProduct.imagesCsv).map((item, index) => (
                    <div key={`${item.imageUrl}-${index}`} style={styles.galleryPreviewCard}>
                      <img src={item.imageUrl} alt={`Galeria ${index + 1}`} style={styles.galleryPreviewImage} />
                      <div style={styles.galleryPreviewMeta}>
                        <strong style={styles.galleryPreviewTitle}>Imagem {index + 1}</strong>
                        <span style={styles.galleryPreviewText}>{item.color ? `Cor: ${item.color}` : "Sem cor vinculada"}</span>
                      </div>
                      <div style={styles.galleryPreviewActions}>
                        <button
                          style={styles.inlineBtn}
                          onClick={() =>
                            setNewProduct(prev => ({
                              ...prev,
                              ...moveImageCsvEntryToCover(prev.imagesCsv, item.imageUrl, prev.imageUrl),
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
                              imagesCsv: removeImageCsvEntry(prev.imagesCsv, item.imageUrl),
                            }))
                          }
                        >
                          Remover
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              ) : null}
            </div>
            <div style={wideFieldStyle}>
              <input style={styles.input} placeholder="Variantes (nome|sku|preço|estoque;...)" value={newProduct.variantsCsv} onChange={e => setNewProduct(prev => ({ ...prev, variantsCsv: e.target.value }))} />
              <div style={styles.mediaActions}>
                <button
                  style={styles.secondaryBtn}
                  onClick={() =>
                    setNewProduct(prev => ({
                      ...prev,
                      variantsCsv: buildVariantDraft(prev.name.trim() || "Produto", prev.colorsCsv, prev.sizesCsv, prev.price || "0"),
                    }))
                  }
                >
                  Gerar variantes
                </button>
                <span style={styles.mediaHint}>Gera combinações a partir das cores e tamanhos informados.</span>
              </div>
              <span style={styles.mediaHint}>Exemplo: Camiseta P|CAM-P|89.90|10; Camiseta M|CAM-M|89.90|8</span>
            </div>
            <input style={{ ...styles.input, gridColumn: "1 / -1" }} placeholder="Descrição curta" value={newProduct.description} onChange={e => setNewProduct(prev => ({ ...prev, description: e.target.value }))} />
          </div>
          <div style={styles.productAdminActions}>
          <button
            style={styles.primaryBtn}
            onClick={() => {
              const price = parseMoneyToCents(newProduct.price);
              const stock = Number(newProduct.stock);
              if (!newProduct.name.trim() || !newProduct.category.trim() || !Number.isFinite(price) || price <= 0) {
                showToast({ message: "Preencha nome, categoria e preço válidos", duration: 2400 });
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
                  const [name, sku, variantPrice, variantStock] = raw.split("|").map(part => part?.trim() ?? "");
                  return {
                    name,
                    sku: sku || null,
                    price: variantPrice ? parseMoneyToCents(variantPrice) : null,
                    stock: Number(variantStock || "0"),
                  };
                })
                .filter(item => item.name && Number.isFinite(item.stock) && (item.price === null || Number.isFinite(item.price)));

              createProductMutation.mutate({
                name: newProduct.name.trim(),
                category: normalizeCategoryValue(newProduct.category),
                price,
                stock: Number.isFinite(stock) && stock >= 0 ? stock : 0,
                imageUrl: normalizeAdminImageValue(newProduct.imageUrl) || undefined,
                imageThumbnailUrl: normalizeAdminImageValue(newProduct.imageThumbnailUrl) || undefined,
                imageDetailUrl: normalizeAdminImageValue(newProduct.imageDetailUrl) || undefined,
                imageBannerUrl: normalizeAdminImageValue(newProduct.imageBannerUrl) || undefined,
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
              <p style={styles.productAdminText}>Selecione um item já cadastrado para revisar preço, estoque, imagens, variantes e categoria.</p>
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
                const selectedColors = (() => {
                  if (!selected.optionColors) return [];
                  try {
                    const parsed = JSON.parse(selected.optionColors);
                    return Array.isArray(parsed) ? parsed.map((item: any) => String(item)) : [];
                  } catch {
                    return [];
                  }
                })();
                const selectedSizes = (() => {
                  if (!selected.optionSizes) return [];
                  try {
                    const parsed = JSON.parse(selected.optionSizes);
                    return Array.isArray(parsed) ? parsed.map((item: any) => String(item)) : [];
                  } catch {
                    return [];
                  }
                })();
                setEditProduct({
                  name: selected.name ?? "",
                  category: selected.category ?? "",
                  price: centsToMoneyInput(selected.price),
                  stock: String(selected.stock ?? 0),
                  imageUrl: normalizeAdminImageValue(selected.imageUrl),
                  imageThumbnailUrl: normalizeAdminImageValue((selected as any).imageThumbnailUrl),
                  imageDetailUrl: normalizeAdminImageValue((selected as any).imageDetailUrl),
                  imageBannerUrl: normalizeAdminImageValue((selected as any).imageBannerUrl),
                  galleryColor: "",
                  colorsCsv: selectedColors.join(", "),
                  sizesCsv: selectedSizes.join(", "),
                  sizeType: selected.sizeType ?? "alpha",
                  imagesCsv: (selected.images ?? [])
                    .map(item => formatImageCsvEntry(
                      typeof item === "string"
                        ? item
                        : {
                            imageUrl: item?.imageUrl ?? "",
                            imageThumbnailUrl: (item as any)?.imageThumbnailUrl ?? null,
                            imageDetailUrl: (item as any)?.imageDetailUrl ?? null,
                            imageBannerUrl: (item as any)?.imageBannerUrl ?? null,
                            color: item?.color ?? null,
                          },
                      typeof item === "string" ? null : item?.color ?? null,
                    ))
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
                <input style={styles.input} placeholder="Nome do produto" value={editProduct.name} onChange={e => setEditProduct(prev => ({ ...prev, name: e.target.value }))} />
                <select style={styles.select} value={editProduct.category} onChange={e => setEditProduct(prev => ({ ...prev, category: e.target.value }))}>
                  <option value="">Selecione a categoria</option>
                  {PRODUCT_CATEGORIES.map(cat => (
                    <option key={cat.value} value={cat.value}>{cat.label}</option>
                  ))}
                </select>
                <div style={styles.categoryPreviewBox}>
                  <span style={styles.categoryPreviewLabel}>Prévia da categoria</span>
                  <strong style={styles.categoryPreviewValue}>{editProduct.category ? getCategoryLabel(editProduct.category) : "Selecione uma categoria"}</strong>
                  <span style={styles.categoryPreviewHint}>Essa categoria será usada na navegação da loja e no filtro que o cliente vê.</span>
                </div>
                <input style={styles.input} placeholder="Preço (R$)" value={editProduct.price} onChange={e => setEditProduct(prev => ({ ...prev, price: e.target.value }))} />
                <input style={styles.input} placeholder="Estoque disponível" value={editProduct.stock} onChange={e => setEditProduct(prev => ({ ...prev, stock: e.target.value }))} />
                <div style={mediumFieldStyle}>
                  <input style={styles.input} placeholder="Cores (CSV: preto, branco, verde)" value={editProduct.colorsCsv} onChange={e => setEditProduct(prev => ({ ...prev, colorsCsv: e.target.value }))} />
                  <div style={styles.quickPickRow}>
                    {productColorSuggestions.map(color => (
                      <button key={color} style={styles.quickPickBtn} onClick={() => setEditProduct(prev => ({ ...prev, colorsCsv: appendCsvToken(prev.colorsCsv, color) }))}>
                        {color}
                      </button>
                    ))}
                  </div>
                </div>
                <select style={styles.select} value={editProduct.sizeType} onChange={e => setEditProduct(prev => ({ ...prev, sizeType: e.target.value }))}>
                  <option value="alpha">Tamanho alfabético (PP, P, M...)</option>
                  <option value="numeric">Tamanho numérico (36, 38, 40...)</option>
                  <option value="custom">Tamanho customizado</option>
                </select>
                <div style={mediumFieldStyle}>
                  <input style={styles.input} placeholder="Tamanhos (CSV: PP, P, M, G, GG ou 36, 38, 40)" value={editProduct.sizesCsv} onChange={e => setEditProduct(prev => ({ ...prev, sizesCsv: e.target.value }))} />
                  <div style={styles.quickPickRow}>
                    {(editProduct.sizeType === "numeric" ? numericSizeSuggestions : alphaSizeSuggestions).map(size => (
                      <button key={size} style={styles.quickPickBtn} onClick={() => setEditProduct(prev => ({ ...prev, sizesCsv: appendCsvToken(prev.sizesCsv, size) }))}>
                        {size}
                      </button>
                    ))}
                  </div>
                </div>
                <div style={mediumFieldStyle}>
                  <input style={styles.input} placeholder="Imagem principal" value={editProduct.imageUrl} onChange={e => setEditProduct(prev => ({ ...prev, imageUrl: e.target.value }))} />
                  <div style={styles.mediaActions}>
                    <button
                      style={styles.secondaryBtn}
                      onClick={() => editMainImageInputRef.current?.click()}
                      disabled={uploadingField === "edit-main"}
                    >
                      {uploadingField === "edit-main" ? "Enviando capa..." : "Trocar capa"}
                    </button>
                    <span style={styles.mediaHint}>Você também pode substituir a URL manualmente.</span>
                  </div>
                  <input
                    ref={editMainImageInputRef}
                    type="file"
                    accept="image/*"
                    style={styles.hiddenFileInput}
                    onChange={async e => {
                      const urls = await uploadAdminImages(e.target.files, "single", "edit-main");
                      if (urls[0]) {
                        setEditProduct(prev => ({
                          ...prev,
                          imageUrl: urls[0].detailUrl || urls[0].url,
                          imageThumbnailUrl: urls[0].thumbnailUrl || "",
                          imageDetailUrl: urls[0].detailUrl || urls[0].url,
                          imageBannerUrl: urls[0].bannerUrl || "",
                        }));
                      }
                      e.currentTarget.value = "";
                    }}
                  />
                  {resolveAdminImageUrl(editProduct.imageUrl) ? (
                    <AdminImagePreview
                      src={resolveAdminImageUrl(editProduct.imageUrl)}
                      alt="Prévia da capa"
                      caption="Essa será a imagem principal exibida na vitrine."
                    />
                  ) : null}
                </div>
                <div style={wideFieldStyle}>
                  <input style={styles.input} placeholder="Outras imagens (CSV)" value={editProduct.imagesCsv} onChange={e => setEditProduct(prev => ({ ...prev, imagesCsv: e.target.value }))} />
                  <select
                    style={styles.select}
                    value={editProduct.galleryColor}
                    onChange={e => setEditProduct(prev => ({ ...prev, galleryColor: e.target.value }))}
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
                      {uploadingField === "edit-gallery" ? "Enviando galeria..." : "Adicionar na galeria"}
                    </button>
                    <span style={styles.mediaHint}>As novas imagens serão adicionadas ao CSV atual.</span>
                  </div>
                  <input
                    ref={editGalleryImageInputRef}
                    type="file"
                    accept="image/*"
                    multiple
                    style={styles.hiddenFileInput}
                    onChange={async e => {
                      const urls = await uploadAdminImages(e.target.files, "multiple", "edit-gallery");
                      if (urls.length > 0) {
                        setEditProduct(prev => ({
                          ...prev,
                          imagesCsv: joinImageCsvEntries(prev.imagesCsv, urls, prev.galleryColor || null),
                        }));
                      }
                      e.currentTarget.value = "";
                    }}
                  />
                  <span style={styles.mediaHint}>Você também pode usar `url|cor` para trocar a imagem conforme a cor escolhida.</span>
                  {parseImageCsvEntries(editProduct.imagesCsv).length > 0 ? (
                    <div style={styles.galleryPreviewGrid}>
                      {parseImageCsvEntries(editProduct.imagesCsv).map((item, index) => (
                        <div key={`${item.imageUrl}-${index}`} style={styles.galleryPreviewCard}>
                          <img src={item.imageUrl} alt={`Galeria ${index + 1}`} style={styles.galleryPreviewImage} />
                          <div style={styles.galleryPreviewMeta}>
                            <strong style={styles.galleryPreviewTitle}>Imagem {index + 1}</strong>
                            <span style={styles.galleryPreviewText}>{item.color ? `Cor: ${item.color}` : "Sem cor vinculada"}</span>
                          </div>
                          <div style={styles.galleryPreviewActions}>
                            <button
                              style={styles.inlineBtn}
                              onClick={() =>
                                setEditProduct(prev => ({
                                  ...prev,
                                  ...moveImageCsvEntryToCover(prev.imagesCsv, item.imageUrl, prev.imageUrl),
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
                                  imagesCsv: removeImageCsvEntry(prev.imagesCsv, item.imageUrl),
                                }))
                              }
                            >
                              Remover
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : null}
                </div>
                <div style={wideFieldStyle}>
                  <input style={styles.input} placeholder="Variantes (nome|sku|preço|estoque;...)" value={editProduct.variantsCsv} onChange={e => setEditProduct(prev => ({ ...prev, variantsCsv: e.target.value }))} />
                  <div style={styles.mediaActions}>
                    <button
                      style={styles.secondaryBtn}
                      onClick={() =>
                        setEditProduct(prev => ({
                          ...prev,
                          variantsCsv: buildVariantDraft(prev.name.trim() || "Produto", prev.colorsCsv, prev.sizesCsv, prev.price || "0"),
                        }))
                      }
                    >
                      Gerar variantes
                    </button>
                    <span style={styles.mediaHint}>Monta a base das variantes para você só revisar SKU, preço e estoque.</span>
                  </div>
                  <span style={styles.mediaHint}>Exemplo: Camiseta P|CAM-P|89.90|10; Camiseta M|CAM-M|89.90|8</span>
                </div>
                <input style={{ ...styles.input, gridColumn: "1 / -1" }} placeholder="Descrição curta" value={editProduct.description} onChange={e => setEditProduct(prev => ({ ...prev, description: e.target.value }))} />
              </div>
              <div style={styles.productAdminActions}>
                <button
                  style={styles.primaryBtn}
                  onClick={() => {
                    if (!editingProductId) return;

                    const price = parseMoneyToCents(editProduct.price);
                    const stock = Number(editProduct.stock);
                    if (!editProduct.name.trim() || !editProduct.category.trim() || !Number.isFinite(price) || price <= 0) {
                        showToast({ message: "Preencha nome, categoria e preço válidos", duration: 2400 });
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
                        const [name, sku, variantPrice, variantStock] = raw.split("|").map(part => part?.trim() ?? "");
                        return {
                          name,
                          sku: sku || null,
                          price: variantPrice ? parseMoneyToCents(variantPrice) : null,
                          stock: Number(variantStock || "0"),
                        };
                      })
                      .filter(item => item.name && Number.isFinite(item.stock) && (item.price === null || Number.isFinite(item.price)));

                    updateProductMutation.mutate({
                      id: editingProductId,
                      name: editProduct.name.trim(),
                      category: normalizeCategoryValue(editProduct.category),
                      price,
                      stock: Number.isFinite(stock) && stock >= 0 ? stock : 0,
                      imageUrl: normalizeAdminImageValue(editProduct.imageUrl) || undefined,
                      imageThumbnailUrl: normalizeAdminImageValue(editProduct.imageThumbnailUrl) || undefined,
                      imageDetailUrl: normalizeAdminImageValue(editProduct.imageDetailUrl) || undefined,
                      imageBannerUrl: normalizeAdminImageValue(editProduct.imageBannerUrl) || undefined,
                      optionColors,
                      optionSizes,
                      sizeType: editProduct.sizeType as "alpha" | "numeric" | "custom",
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

          {productsQuery.isLoading ? (
            <AdminLoadingState>Carregando produtos...</AdminLoadingState>
          ) : products.length === 0 ? (
            <AdminEmptyState
              title="Nenhum produto encontrado"
              description="Ajuste a busca ou filtro para visualizar itens do catálogo."
            />
          ) : (
            <AdminTableWrapper>
              <table style={styles.table}>
                <thead><tr><th>Visual</th><th>Produto</th><th>Categoria e opções</th><th>Preço rápido</th><th>Estoque rápido</th><th>Status</th><th>Datas</th><th>Variantes</th><th>Ações</th></tr></thead>
                <tbody>
                  {products.map(row => {
                    const optionColors = parseProductOptionList(row.optionColors);
                    const optionSizes = parseProductOptionList(row.optionSizes);
                    return (
                    <tr key={row.id}>
                      <td>
                        <div style={styles.productVisualCell}>
                          {resolveAdminImageUrl(row.imageUrl) ? (
                            <AdminImagePreview
                              src={resolveAdminImageUrl(row.imageUrl)}
                              alt={row.name}
                              variant="thumb"
                            />
                          ) : (
                            <AdminImagePreview alt={row.name} variant="thumb" />
                          )}
                          <ProductVisualMeta>
                            {(row.images?.length ?? 0) > 0 ? `${row.images?.length ?? 0} extras` : "Só capa"}
                          </ProductVisualMeta>
                        </div>
                      </td>
                      <td>
                        <div style={styles.productTableCell}>
                          <strong style={styles.productTableName}>#{row.id} · {row.name}</strong>
                          <span style={styles.productTableMeta}>
                            {row.description?.trim() ? row.description : "Sem descrição curta"}
                          </span>
                        </div>
                      </td>
                      <td>
                        <div style={styles.productTableCell}>
                          <span style={styles.categoryTableBadge}>{getCategoryLabel(row.category)}</span>
                          <ProductOptionPreview label="Cores" values={optionColors} />
                          <ProductOptionPreview label="Tamanhos" values={optionSizes} />
                        </div>
                      </td>
                      <td>
                        <input
                          style={{ ...styles.input, width: 130 }}
                          value={quickProductEdits[row.id]?.price ?? centsToMoneyInput(row.price)}
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
                            ...(Number(quickProductEdits[row.id]?.stock ?? row.stock) <= 0
                              ? styles.stockInputEmpty
                              : Number(quickProductEdits[row.id]?.stock ?? row.stock) <= 3
                                ? styles.stockInputLow
                                : {}),
                          }}
                          value={quickProductEdits[row.id]?.stock ?? String(row.stock)}
                          onChange={e => {
                            const value = e.target.value;
                            setQuickProductEdits(prev => ({
                              ...prev,
                              [row.id]: {
                                price: prev[row.id]?.price ?? centsToMoneyInput(row.price),
                                stock: value,
                              },
                            }));
                          }}
                        />
                      </td>
                      <td>
                        <ProductStockBadge stock={Number(quickProductEdits[row.id]?.stock ?? row.stock)} />
                      </td>
                      <td>
                        <div style={styles.productTableCell}>
                          <span style={styles.productTableMeta}>Criado: {row.createdAt ? new Date(row.createdAt).toLocaleDateString("pt-BR") : "-"}</span>
                          <span style={styles.productTableMeta}>Atualizado: {row.updatedAt ? new Date(row.updatedAt).toLocaleDateString("pt-BR") : "-"}</span>
                        </div>
                      </td>
                      <td>
                        <span style={styles.variantCountBadge}>{row.variants?.length ?? 0}</span>
                      </td>
                      <td style={styles.actionsCell}>
                      <button
                        style={styles.smallBtn}
                        onClick={() => {
                          const price = parseMoneyToCents(quickProductEdits[row.id]?.price ?? centsToMoneyInput(row.price));
                          const stock = Number(quickProductEdits[row.id]?.stock ?? row.stock);
                          if (!Number.isFinite(price) || price <= 0 || !Number.isFinite(stock) || stock < 0) {
                            showToast({ message: "Preço/estoque inválidos", duration: 2400 });
                            return;
                          }
                          quickUpdateProductMutation.mutate(
                            { id: row.id, price, stock },
                            {
                              onSuccess: () => {
                                setQuickProductEdits(prev => {
                                  const next = { ...prev };
                                  delete next[row.id];
                                  return next;
                                });
                              },
                            },
                          );
                        }}
                      >
                        Salvar rápido
                      </button>
                      <button
                        style={styles.smallBtn}
                        onClick={() => {
                          const rowColors = (() => {
                            if (!row.optionColors) return [];
                            try {
                              const parsed = JSON.parse(row.optionColors);
                              return Array.isArray(parsed) ? parsed.map((item: any) => String(item)) : [];
                            } catch {
                              return [];
                            }
                          })();
                          const rowSizes = (() => {
                            if (!row.optionSizes) return [];
                            try {
                              const parsed = JSON.parse(row.optionSizes);
                              return Array.isArray(parsed) ? parsed.map((item: any) => String(item)) : [];
                            } catch {
                              return [];
                            }
                          })();
                          setEditingProductId(row.id);
                          setEditProduct({
                            name: row.name ?? "",
                            category: row.category ?? "",
                            price: centsToMoneyInput(row.price),
                            stock: String(row.stock ?? 0),
                            imageUrl: normalizeAdminImageValue(row.imageUrl),
                            imageThumbnailUrl: normalizeAdminImageValue((row as any).imageThumbnailUrl),
                            imageDetailUrl: normalizeAdminImageValue((row as any).imageDetailUrl),
                            imageBannerUrl: normalizeAdminImageValue((row as any).imageBannerUrl),
                            galleryColor: "",
                            colorsCsv: rowColors.join(", "),
                            sizesCsv: rowSizes.join(", "),
                            sizeType: row.sizeType ?? "alpha",
                            imagesCsv: (row.images ?? [])
                              .map(item =>
                                formatImageCsvEntry(
                                  typeof item === "string"
                                    ? item
                                    : {
                                        imageUrl: item?.imageUrl ?? "",
                                        imageThumbnailUrl: (item as any)?.imageThumbnailUrl ?? null,
                                        imageDetailUrl: (item as any)?.imageDetailUrl ?? null,
                                        imageBannerUrl: (item as any)?.imageBannerUrl ?? null,
                                        color: item?.color ?? null,
                                      },
                                  typeof item === "string" ? null : item?.color ?? null,
                                ),
                              )
                              .filter(Boolean)
                              .join(", "),
                            variantsCsv: (row.variants ?? [])
                              .map(item => {
                                const name = item?.name ?? "";
                                const sku = item?.sku ?? "";
                                const variantPrice = centsToMoneyInput(item?.price);
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
                        onClick={() => {
                          if (!confirmAdminAction(`Excluir o produto "${row.name}"? Esta ação não pode ser desfeita pelo painel.`)) return;
                          deleteProductMutation.mutate({ id: row.id });
                        }}
                      >
                        Excluir
                      </button>
                      </td>
                    </tr>
                    );
                  })}
                </tbody>
              </table>
            </AdminTableWrapper>
          )}
        </div>
      )}

      {section === "orders" && (
        <AdminSurface
          title="Pedidos"
          description="Gerencie o fluxo de pedidos com uma visão compacta e um painel lateral para detalhes operacionais."
          aside={
            <div style={styles.inlineRow}>
              <input
                style={{ ...styles.input, minWidth: 260 }}
                placeholder="Buscar pedido, cliente ou rastreio"
                value={orderSearch}
                onChange={e => setOrderSearch(e.target.value)}
              />
              <label>Status:</label>
              <select style={styles.select} value={orderFilterStatus} onChange={e => setOrderFilterStatus(e.target.value)}>
                <option value="">Todos</option>
                {orderStatuses.map(status => <option key={status} value={status}>{getOrderStatusLabel(status)}</option>)}
              </select>
              <button style={styles.smallBtn} onClick={() => ordersQuery.refetch()}>Filtrar</button>
            </div>
          }
        >
          <OrdersSummaryCards summary={ordersSummary} />
          <div style={styles.inlineRow}>
            <AdminSummaryPill>Exibindo: {orders.length}</AdminSummaryPill>
            <AdminSummaryPill>Busca: {searchedOrders.length}</AdminSummaryPill>
          </div>
          <OrdersFilters value={orderQuickFilter} onChange={setOrderQuickFilter} options={orderFilterOptions} />
          <OrderOperationalAlerts alerts={orderOperationalAlerts} />
          {ordersQuery.isLoading ? (
            <AdminLoadingState>Carregando pedidos...</AdminLoadingState>
          ) : orders.length === 0 ? (
            <AdminEmptyState
              title="Nenhum pedido encontrado"
              description="Ajuste o filtro ou aguarde novos pedidos aparecerem aqui."
            />
          ) : (
            <div
              style={{
                ...styles.orderAdminLayout,
                gridTemplateColumns: isCompactAdmin ? "1fr" : styles.orderAdminLayout.gridTemplateColumns,
              }}
            >
              <AdminTableWrapper>
                <table style={styles.table}>
                  <thead><tr><th>Pedido</th><th>Cliente</th><th>Total</th><th>Status</th><th>Rastreio</th><th>Itens</th><th>Ações</th></tr></thead>
                  <tbody>
                    {orders.map(row => (
                      <tr
                        key={row.id}
                        onClick={() => setSelectedOrderId(row.id)}
                        style={selectedOrder?.id === row.id ? styles.activeTableRow : undefined}
                      >
                        <td>
                          <div style={styles.orderPrimaryText}>#{row.id}</div>
                          <div style={styles.orderSecondaryText}>
                            {new Date(row.createdAt).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" })}
                          </div>
                        </td>
                        <td>
                          <div style={styles.orderPrimaryText}>{row.customerName || row.customerEmail || `Cliente #${row.userId}`}</div>
                          {row.customerEmail && row.customerName ? (
                            <div style={styles.orderSecondaryText}>{row.customerEmail}</div>
                          ) : null}
                        </td>
                        <td>
                          <div style={styles.orderPrimaryText}>{formatPrice(Number(row.totalPrice) / 100)}</div>
                        </td>
                        <td>
                          <OrderStatusBadge
                            status={String(row.status)}
                            label={getOrderStatusLabel(String(row.status))}
                            tone={getOrderStatusTone(String(row.status))}
                          />
                        </td>
                        <td>
                          <div style={styles.orderPrimaryText}>{row.trackingCode || "Pendente"}</div>
                        </td>
                        <td>
                          <div style={styles.orderPrimaryText}>
                            {(row.items ?? []).reduce((sum, item) => sum + Number(item.quantity ?? 0), 0)} item(ns)
                          </div>
                          {(row.items ?? []).length > 0 ? (
                            <div style={styles.orderSecondaryText}>
                              {(row.items ?? [])
                                .slice(0, 1)
                                .map(item => item.productName || `Produto #${item.productId}`)
                                .join(", ")}
                            </div>
                          ) : null}
                        </td>
                        <td style={styles.actionsCell} onClick={event => event.stopPropagation()}>
                          <select
                            style={styles.select}
                            value={row.status}
                            onChange={e => {
                              const nextStatus = e.target.value as any;
                              if (!confirmAdminAction(`Alterar o pedido #${row.id} para "${getOrderStatusLabel(String(nextStatus))}"?`)) return;
                              updateOrderMutation.mutate({ orderId: row.id, status: nextStatus });
                            }}
                          >
                            {orderStatuses.map(status => <option key={status} value={status}>{getOrderStatusLabel(status)}</option>)}
                          </select>
                          <button
                            style={styles.smallBtn}
                            onClick={() => {
                              const tracking = window.prompt("Código de rastreio:", row.trackingCode || "");
                              if (tracking === null) return;
                              updateOrderMutation.mutate({ orderId: row.id, trackingCode: tracking || null });
                            }}
                          >
                            Rastreio
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </AdminTableWrapper>

              <OrderDetailPanel
                order={selectedOrder}
                statusLabel={getOrderStatusLabel}
                statusTone={getOrderStatusTone}
                addressLines={formatAdminAddressLine}
              />
            </div>
          )}
        </AdminSurface>
      )}

      {section === "promos" && (
        <AdminSurface
          title="Promoções e banners"
          description="Organize as campanhas do carrossel principal da home sem alterar o funcionamento público dos banners."
        >
          <PromotionsSummaryCards summary={promoSummary} />
          <div style={styles.formGrid}>
            <input style={styles.input} placeholder="Badge" value={newPromo.badge} onChange={e => setNewPromo(prev => ({ ...prev, badge: e.target.value }))} />
            <input style={styles.input} placeholder="Título" value={newPromo.title} onChange={e => setNewPromo(prev => ({ ...prev, title: e.target.value }))} />
            <input style={styles.input} placeholder="Descrição" value={newPromo.description} onChange={e => setNewPromo(prev => ({ ...prev, description: e.target.value }))} />
            <input style={styles.input} placeholder="CTA" value={newPromo.ctaLabel} onChange={e => setNewPromo(prev => ({ ...prev, ctaLabel: e.target.value }))} />
            <div style={styles.mediaField}>
              <input style={styles.input} placeholder="URL da imagem" value={newPromo.imageUrl} onChange={e => setNewPromo(prev => ({ ...prev, imageUrl: e.target.value }))} />
              <div style={styles.mediaActions}>
                <button
                  style={styles.secondaryBtn}
                  onClick={() => promoImageInputRef.current?.click()}
                  disabled={uploadingField === "promo-image"}
                >
                  {uploadingField === "promo-image" ? "Enviando banner..." : "Upload do banner"}
                </button>
                {resolveAdminImageUrl(newPromo.imageUrl) ? (
                  <>
                    <a
                      href={resolveAdminImageUrl(newPromo.imageUrl) as string}
                      target="_blank"
                      rel="noreferrer"
                      style={styles.secondaryBtn}
                    >
                      Abrir imagem
                    </a>
                    <button
                      style={styles.smallBtn}
                      onClick={() => setNewPromo(prev => ({ ...prev, imageUrl: "" }))}
                    >
                      Limpar imagem
                    </button>
                  </>
                ) : null}
                <span style={styles.mediaHint}>Você também pode colar uma URL manualmente.</span>
              </div>
              <input
                ref={promoImageInputRef}
                type="file"
                accept="image/*"
                style={styles.hiddenFileInput}
                onChange={async e => {
                  const urls = await uploadAdminImages(e.target.files, "single", "promo-image");
                  if (urls[0]) {
                    setNewPromo(prev => ({
                      ...prev,
                      imageUrl: urls[0].bannerUrl || urls[0].url,
                      imageAlt: prev.imageAlt.trim() || prev.title.trim() || "Banner promocional",
                    }));
                  }
                  e.currentTarget.value = "";
                }}
              />
              {resolveAdminImageUrl(newPromo.imageUrl) ? (
                <PromotionBannerPreview
                  src={resolveAdminImageUrl(newPromo.imageUrl)}
                  alt="Prévia do banner"
                  label="Desktop"
                />
              ) : null}
              <span style={styles.mediaHint}>Proporção sugerida para desktop: 1600x900 ou 1920x1080.</span>
            </div>
            <div style={styles.mediaField}>
              <input
                style={styles.input}
                placeholder="URL da imagem mobile (opcional)"
                value={newPromo.mobileImageUrl}
                onChange={e => setNewPromo(prev => ({ ...prev, mobileImageUrl: e.target.value }))}
              />
              <div style={styles.mediaActions}>
                <button
                  style={styles.secondaryBtn}
                  onClick={() => promoMobileImageInputRef.current?.click()}
                  disabled={uploadingField === "promo-image-mobile"}
                >
                  {uploadingField === "promo-image-mobile" ? "Enviando versão mobile..." : "Upload mobile"}
                </button>
                {resolveAdminImageUrl(newPromo.mobileImageUrl) ? (
                  <>
                    <a
                      href={resolveAdminImageUrl(newPromo.mobileImageUrl) as string}
                      target="_blank"
                      rel="noreferrer"
                      style={styles.secondaryBtn}
                    >
                      Abrir mobile
                    </a>
                    <button
                      style={styles.smallBtn}
                      onClick={() => setNewPromo(prev => ({ ...prev, mobileImageUrl: "" }))}
                    >
                      Limpar mobile
                    </button>
                  </>
                ) : null}
                <span style={styles.mediaHint}>Se vazio, o carrossel reutiliza a imagem principal no celular.</span>
              </div>
              <input
                ref={promoMobileImageInputRef}
                type="file"
                accept="image/*"
                style={styles.hiddenFileInput}
                onChange={async e => {
                  const urls = await uploadAdminImages(e.target.files, "single", "promo-image-mobile");
                  if (urls[0]) {
                    setNewPromo(prev => ({ ...prev, mobileImageUrl: urls[0].bannerUrl || urls[0].url }));
                  }
                  e.currentTarget.value = "";
                }}
              />
              {resolveAdminImageUrl(newPromo.mobileImageUrl) ? (
                <PromotionBannerPreview
                  src={resolveAdminImageUrl(newPromo.mobileImageUrl)}
                  alt="Prévia mobile do banner"
                  label="Mobile"
                  variant="mobile"
                />
              ) : null}
              <span style={styles.mediaHint}>Proporção sugerida para mobile: 1080x1350 ou 1080x1440.</span>
            </div>
            <input style={styles.input} placeholder="Texto alternativo da imagem" value={newPromo.imageAlt} onChange={e => setNewPromo(prev => ({ ...prev, imageAlt: e.target.value }))} />
            <input style={styles.input} placeholder="Link do banner (ex: /produtos)" value={newPromo.linkUrl} onChange={e => setNewPromo(prev => ({ ...prev, linkUrl: e.target.value }))} />
            <input style={styles.input} placeholder="Desconto opcional (ex: 30%)" value={newPromo.discountText} onChange={e => setNewPromo(prev => ({ ...prev, discountText: e.target.value }))} />
            <input style={styles.input} placeholder="Label desconto opcional" value={newPromo.discountLabel} onChange={e => setNewPromo(prev => ({ ...prev, discountLabel: e.target.value }))} />
            <input style={styles.input} placeholder="Background CSS" value={newPromo.bgStyle} onChange={e => setNewPromo(prev => ({ ...prev, bgStyle: e.target.value }))} />
            <input style={styles.input} placeholder="Ordem" value={newPromo.sortOrder} onChange={e => setNewPromo(prev => ({ ...prev, sortOrder: e.target.value }))} />
          </div>
          <div style={styles.promoPreviewCard}>
            <div style={styles.promoPreviewMediaGroup}>
              <div style={{ ...styles.promoPreviewMedia, background: newPromo.bgStyle.trim() || "linear-gradient(135deg, #1a1a1a 0%, #333333 100%)" }}>
                {resolveAdminImageUrl(newPromo.imageUrl) ? (
                  <img
                    src={resolveAdminImageUrl(newPromo.imageUrl) as string}
                    alt={newPromo.imageAlt.trim() || newPromo.title.trim() || "Banner promocional"}
                    style={styles.promoPreviewImage}
                  />
                ) : (
                  <div style={styles.promoPreviewPlaceholder}>Sem imagem</div>
                )}
              </div>
              <div style={styles.promoPreviewMobileWrap}>
                <span style={styles.promoPreviewDeviceLabel}>Mobile</span>
                <div style={{ ...styles.promoPreviewMobile, background: newPromo.bgStyle.trim() || "linear-gradient(135deg, #1a1a1a 0%, #333333 100%)" }}>
                  {resolveAdminImageUrl(newPromo.mobileImageUrl || newPromo.imageUrl) ? (
                    <img
                      src={resolveAdminImageUrl(newPromo.mobileImageUrl || newPromo.imageUrl) as string}
                      alt={newPromo.imageAlt.trim() || newPromo.title.trim() || "Banner mobile"}
                      style={styles.promoPreviewMobileImage}
                    />
                  ) : (
                    <div style={styles.promoPreviewPlaceholder}>Sem mobile</div>
                  )}
                </div>
              </div>
            </div>
            <div style={styles.promoPreviewContent}>
              <span style={styles.promoPreviewEyebrow}>Prévia do banner</span>
              <span style={styles.promoPreviewBadge}>{newPromo.badge.trim() || "PROMOÇÃO"}</span>
              <strong style={styles.promoPreviewTitle}>{newPromo.title.trim() || "Título do banner"}</strong>
              <span style={styles.promoPreviewDescription}>
                {newPromo.description.trim() || "A descrição aparece logo abaixo do título no carrossel da home."}
              </span>
              {newPromo.discountText.trim() ? (
                <div style={styles.promoPreviewMetaRow}>
                  <span style={styles.promoPreviewDiscount}>{newPromo.discountText.trim()}</span>
                  <span style={styles.promoPreviewDiscountLabel}>{newPromo.discountLabel.trim() || "OFF"}</span>
                </div>
              ) : null}
              <div style={styles.promoPreviewFooter}>
                <span style={styles.promoPreviewCta}>{newPromo.ctaLabel.trim() || "Aproveitar oferta"}</span>
                <span style={styles.promoPreviewLink}>{newPromo.linkUrl.trim() || "/produtos"}</span>
              </div>
              {!resolveAdminImageUrl(newPromo.mobileImageUrl) ? (
                <span style={styles.promoPreviewWarning}>Sem arte mobile dedicada. O carrossel vai reutilizar a versão desktop no celular.</span>
              ) : null}
              <span style={styles.promoPreviewOrderHint}>Depois de criar os banners, arraste as linhas abaixo para reorganizar o carrossel.</span>
            </div>
          </div>
          <div style={styles.inlineRow}>
            <label>
              <input type="checkbox" checked={newPromo.isActive} onChange={e => setNewPromo(prev => ({ ...prev, isActive: e.target.checked }))} /> Ativo
            </label>
            <button
              style={styles.primaryBtn}
              onClick={() => {
                const sortOrder = Number(newPromo.sortOrder || "0");
                if (!newPromo.title.trim() || !newPromo.description.trim()) {
                  showToast({ message: "Preencha título e descrição", duration: 2400 });
                  return;
                }

                const payload = {
                  badge: newPromo.badge.trim() || "PROMOÇÃO",
                  title: newPromo.title.trim(),
                  description: newPromo.description.trim(),
                  ctaLabel: newPromo.ctaLabel.trim() || "Aproveitar oferta",
                  imageUrl: normalizeAdminImageValue(newPromo.imageUrl),
                  mobileImageUrl: normalizeAdminImageValue(newPromo.mobileImageUrl),
                  imageAlt: newPromo.imageAlt.trim(),
                  linkUrl: newPromo.linkUrl.trim(),
                  discountText: newPromo.discountText.trim(),
                  discountLabel: newPromo.discountLabel.trim() || "OFF",
                  bgStyle: newPromo.bgStyle.trim() || "linear-gradient(135deg, #1a1a1a 0%, #333333 100%)",
                  sortOrder: Number.isFinite(sortOrder) ? sortOrder : 0,
                  isActive: newPromo.isActive,
                };

                if (editingPromoId) {
                  updatePromoBannerMutation.mutate({ id: editingPromoId, ...payload });
                } else {
                  createPromoBannerMutation.mutate(payload);
                }
              }}
            >
              {editingPromoId ? "Salvar banner" : "Criar banner"}
            </button>
            {editingPromoId ? (
              <button
                style={styles.smallBtn}
                onClick={() => {
                  setEditingPromoId(null);
                  setNewPromo({ ...emptyPromoForm });
                }}
              >
                Cancelar edicao
              </button>
            ) : null}
          </div>

          {promoBannersQuery.isLoading ? (
            <AdminLoadingState>Carregando banners...</AdminLoadingState>
          ) : !(promoBannersQuery.data ?? []).length ? (
            <AdminEmptyState
              title="Nenhum banner cadastrado"
              description="Crie o primeiro banner promocional para alimentar o carrossel principal da home."
            />
          ) : (
            <AdminTableWrapper>
              <table style={styles.table}>
                <thead><tr><th>Ordem</th><th>Campanha</th><th>Previews</th><th>Status</th><th>CTA e link</th><th>Ações</th></tr></thead>
                <tbody>
                  {(promoBannersQuery.data ?? []).map((row: any) => (
                  <tr
                    key={row.id}
                    draggable
                    onDragStart={() => setDraggingPromoId(row.id)}
                    onDragEnd={() => setDraggingPromoId(null)}
                    onDragOver={event => event.preventDefault()}
                    onDrop={async event => {
                      event.preventDefault();
                      if (draggingPromoId && draggingPromoId !== row.id) {
                        await reorderPromoBanners(draggingPromoId, row.id);
                      }
                      setDraggingPromoId(null);
                    }}
                    style={draggingPromoId === row.id ? { opacity: 0.55 } : undefined}
                  >
                    <td>
                      <div style={styles.dragHandle}>
                        <span style={styles.dragGrip}>⋮⋮</span>
                        <span>#{row.sortOrder}</span>
                      </div>
                    </td>
                    <td>
                      <PromotionCampaignCell
                        badge={row.badge}
                        title={row.title}
                        description={row.description}
                      />
                    </td>
                    <td>
                      <div style={styles.promoTablePreviewGroup}>
                        <PromotionBannerPreview
                          src={resolveAdminImageUrl(row.imageUrl)}
                          alt={row.title || "Banner"}
                          label="Desktop"
                        />
                        <PromotionBannerPreview
                          src={resolveAdminImageUrl(row.mobileImageUrl || row.imageUrl)}
                          alt={row.title || "Banner mobile"}
                          label="Mobile"
                          variant="mobile"
                        />
                      </div>
                    </td>
                    <td>
                      <div style={styles.promoStatusStack}>
                        <PromotionStatusBadge active={Boolean(row.isActive)} />
                        <div style={styles.promoMediaBadgeRow}>
                          <PromotionMediaBadge tone={resolveAdminImageUrl(row.imageUrl) ? "success" : "warning"}>
                            {resolveAdminImageUrl(row.imageUrl) ? "Desktop ok" : "Sem desktop"}
                          </PromotionMediaBadge>
                          <PromotionMediaBadge tone={resolveAdminImageUrl(row.mobileImageUrl) ? "success" : "neutral"}>
                            {resolveAdminImageUrl(row.mobileImageUrl) ? "Mobile ok" : "Usa desktop"}
                          </PromotionMediaBadge>
                        </div>
                        {row.discountText ? (
                          <PromotionMediaBadge tone="warning">
                            {row.discountText} {row.discountLabel || "OFF"}
                          </PromotionMediaBadge>
                        ) : null}
                      </div>
                    </td>
                    <td>
                      <div style={styles.productTableCell}>
                        <span style={styles.productTableName}>{row.ctaLabel || "Sem CTA"}</span>
                        <span style={styles.productTableMeta}>{row.linkUrl || "Sem link"}</span>
                        <span style={styles.productTableMeta}>ID #{row.id}</span>
                      </div>
                    </td>
                    <td style={styles.actionsCell}>
                      <button
                        style={styles.smallBtn}
                        onClick={() => {
                          setEditingPromoId(row.id);
                          setNewPromo({
                            badge: row.badge ?? "PROMOÇÃO",
                            title: row.title ?? "",
                            description: row.description ?? "",
                            ctaLabel: row.ctaLabel ?? "Aproveitar oferta",
                            imageUrl: normalizeAdminImageValue(row.imageUrl),
                            mobileImageUrl: normalizeAdminImageValue(row.mobileImageUrl),
                            imageAlt: row.imageAlt ?? "",
                            linkUrl: row.linkUrl ?? "",
                            discountText: row.discountText ?? "",
                            discountLabel: row.discountLabel ?? "OFF",
                            bgStyle: row.bgStyle ?? "linear-gradient(135deg, #1a1a1a 0%, #333333 100%)",
                            sortOrder: String(row.sortOrder ?? 0),
                            isActive: Boolean(row.isActive),
                          });
                        }}
                      >
                        Editar
                      </button>
                      <button
                        style={styles.smallBtn}
                        onClick={() => updatePromoBannerMutation.mutate({ id: row.id, isActive: !row.isActive })}
                      >
                        {row.isActive ? "Desativar" : "Ativar"}
                      </button>
                      <button
                        style={styles.smallBtn}
                        onClick={() => {
                          setEditingPromoId(null);
                          setNewPromo({
                            badge: row.badge ?? "PROMOÇÃO",
                            title: `${row.title ?? ""} (Cópia)`.trim(),
                            description: row.description ?? "",
                            ctaLabel: row.ctaLabel ?? "Aproveitar oferta",
                            imageUrl: normalizeAdminImageValue(row.imageUrl),
                            mobileImageUrl: normalizeAdminImageValue(row.mobileImageUrl),
                            imageAlt: row.imageAlt ?? "",
                            linkUrl: row.linkUrl ?? "",
                            discountText: row.discountText ?? "",
                            discountLabel: row.discountLabel ?? "OFF",
                            bgStyle: row.bgStyle ?? "linear-gradient(135deg, #1a1a1a 0%, #333333 100%)",
                            sortOrder: String((row.sortOrder ?? 0) + 1),
                            isActive: Boolean(row.isActive),
                          });
                          showToast({ message: "Banner duplicado para edição", duration: 2200 });
                        }}
                      >
                        Duplicar
                      </button>
                      <button
                        style={styles.dangerBtn}
                        onClick={() => {
                          if (!confirmAdminAction(`Excluir o banner "${row.title || `#${row.id}`}"?`)) return;
                          deletePromoBannerMutation.mutate({ id: row.id });
                        }}
                      >
                        Excluir
                      </button>
                    </td>
                  </tr>
                  ))}
                </tbody>
              </table>
            </AdminTableWrapper>
          )}
        </AdminSurface>
      )}

      {section === "coupons" && (
        <div style={styles.card}>
          <h2 style={styles.sectionTitle}>Cupons e Descontos</h2>
          <div style={styles.formGrid}>
            <input style={styles.input} placeholder="Código" value={newCoupon.code} onChange={e => setNewCoupon(prev => ({ ...prev, code: e.target.value }))} />
            <select style={styles.select} value={newCoupon.type} onChange={e => setNewCoupon(prev => ({ ...prev, type: e.target.value }))}>
              <option value="percent">Percentual</option>
              <option value="fixed">Valor fixo</option>
            </select>
            <input style={styles.input} placeholder="Valor" value={newCoupon.value} onChange={e => setNewCoupon(prev => ({ ...prev, value: e.target.value }))} />
            <input style={styles.input} placeholder="Máx. usos" value={newCoupon.maxUses} onChange={e => setNewCoupon(prev => ({ ...prev, maxUses: e.target.value }))} />
          </div>
          <div style={styles.productAdminActions}>
            <button
              style={styles.primaryBtn}
              onClick={() => {
                couponCreateMutation.mutate({
                  code: newCoupon.code,
                  type: newCoupon.type as any,
                  value: Number(newCoupon.value),
                  maxUses: newCoupon.maxUses ? Number(newCoupon.maxUses) : null,
                });
              }}
            >
              Criar cupom
            </button>
          </div>
          {couponsQuery.isLoading ? (
            <AdminLoadingState>Carregando cupons...</AdminLoadingState>
          ) : !(couponsQuery.data ?? []).length ? (
            <AdminEmptyState
              title="Nenhum cupom cadastrado"
              description="Crie o primeiro cupom para liberar descontos promocionais no checkout."
            />
          ) : (
            <AdminTableWrapper>
              <table style={styles.table}>
                <thead><tr><th>ID</th><th>Código</th><th>Tipo</th><th>Valor</th><th>Usos</th><th>Ativo</th><th>Ação</th></tr></thead>
                <tbody>
                  {(couponsQuery.data ?? []).map(coupon => (
                    <tr key={coupon.id}>
                      <td>{coupon.id}</td><td>{coupon.code}</td><td>{coupon.type === "percent" ? "Percentual" : "Valor fixo"}</td><td>{coupon.value}</td><td>{coupon.usedCount}/{coupon.maxUses ?? "∞"}</td><td>{coupon.isActive ? "Sim" : "Não"}</td>
                      <td>
                        <button
                          style={styles.dangerBtn}
                          onClick={() => {
                            if (!confirmAdminAction(`Excluir o cupom ${coupon.code}?`)) return;
                            couponDeleteMutation.mutate({ id: coupon.id });
                          }}
                        >
                          Excluir
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </AdminTableWrapper>
          )}
          <div style={styles.launchCard}>
            <h3 style={styles.sectionTitle}>Avisar lista de espera sobre a abertura</h3>
            <p style={styles.muted}>
              Use esta ação para disparar o e-mail de lançamento para todos os cadastrados, com o cupom exclusivo de abertura.
            </p>
            <div style={styles.formGrid}>
              <input
                style={styles.input}
                placeholder="Código do cupom"
                value={launchEmailForm.couponCode}
                onChange={e => setLaunchEmailForm(prev => ({ ...prev, couponCode: e.target.value }))}
              />
              <input
                style={styles.input}
                placeholder="Percentual"
                value={launchEmailForm.discountPercent}
                onChange={e => setLaunchEmailForm(prev => ({ ...prev, discountPercent: e.target.value }))}
              />
              <input
                style={styles.input}
                placeholder="URL da loja"
                value={launchEmailForm.launchUrl}
                onChange={e => setLaunchEmailForm(prev => ({ ...prev, launchUrl: e.target.value }))}
              />
              <input
                style={styles.input}
                placeholder="Lote"
                value={launchEmailForm.batchSize}
                onChange={e => setLaunchEmailForm(prev => ({ ...prev, batchSize: e.target.value }))}
              />
            </div>
            <div style={styles.inlineRow}>
              <button
                style={styles.primaryBtn}
                onClick={() => {
                  const discountPercent = Number(launchEmailForm.discountPercent);
                  const batchSize = Number(launchEmailForm.batchSize);
                  if (!launchEmailForm.couponCode.trim()) {
                    showToast({ message: "Informe o código do cupom", duration: 2400 });
                    return;
                  }
                  if (!Number.isFinite(discountPercent) || discountPercent <= 0 || discountPercent > 100) {
                    showToast({ message: "Informe um percentual válido entre 1 e 100", duration: 2400 });
                    return;
                  }
                  if (!Number.isFinite(batchSize) || batchSize <= 0 || batchSize > 100) {
                    showToast({ message: "Informe um lote válido entre 1 e 100", duration: 2400 });
                    return;
                  }
                  if (!window.confirm("Confirma o envio para toda a lista de espera?")) return;

                  setLaunchEmailResult(null);
                  waitlistLaunchSendMutation.mutate({
                    couponCode: launchEmailForm.couponCode.trim().toUpperCase(),
                    discountPercent,
                    launchUrl: launchEmailForm.launchUrl.trim(),
                    batchSize,
                  });
                }}
              >
                {waitlistLaunchSendMutation.isPending ? "Enviando..." : "Disparar e-mail de lançamento"}
              </button>
            </div>

            {launchEmailResult ? (
              <div style={styles.launchResult}>
                <strong>{launchEmailResult.message}</strong>
                <span>Total: {launchEmailResult.total}</span>
                <span>Enviados: {launchEmailResult.sent}</span>
                <span>Falhas: {launchEmailResult.failed}</span>

                {launchEmailResult.failures.length > 0 ? (
                  <AdminTableWrapper>
                    <table style={{ ...styles.table, minWidth: 640 }}>
                      <thead><tr><th>Email</th><th>Erro</th></tr></thead>
                      <tbody>
                        {launchEmailResult.failures.map(item => (
                          <tr key={`${item.email}-${item.message}`}>
                            <td>{item.email}</td>
                            <td>{item.message}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </AdminTableWrapper>
                ) : null}
              </div>
            ) : null}
          </div>
        </div>
      )}

      {section === "reports" && (
        <AdminSurface
          title="Relatórios"
          description="Exporte o consolidado de vendas por período para análise externa ou conferência operacional."
        >
          <div style={styles.inlineRow}>
            <input type="datetime-local" style={styles.input} value={reportFrom} onChange={e => setReportFrom(e.target.value)} />
            <input type="datetime-local" style={styles.input} value={reportTo} onChange={e => setReportTo(e.target.value)} />
            <button
              style={styles.primaryBtn}
              onClick={async () => {
                const fromIso = reportFrom ? new Date(reportFrom).toISOString() : new Date(Date.now() - 7 * 86400000).toISOString();
                const toIso = reportTo ? new Date(reportTo).toISOString() : new Date().toISOString();
                const data = await reportQuery.refetch({ throwOnError: true });
                const csvPayload = data.data ?? (await utils.admin.reportsSalesCsv.fetch({ from: fromIso, to: toIso }));
                const blob = new Blob([csvPayload.csv], { type: "text/csv;charset=utf-8;" });
                const url = URL.createObjectURL(blob);
                const a = document.createElement("a");
                a.href = url;
                a.download = csvPayload.fileName;
                a.click();
                URL.revokeObjectURL(url);
                showToast({ message: "CSV exportado", duration: 2200 });
              }}
            >
              Exportar CSV
            </button>
          </div>
        </AdminSurface>
      )}

      {section === "audit" && (
        <AdminSurface
          title="Logs de auditoria"
          description="Últimos registros administrativos para rastreabilidade, conferência e apoio à investigação."
        >
          {auditQuery.isLoading ? (
            <AdminLoadingState>Carregando auditoria...</AdminLoadingState>
          ) : !(auditQuery.data ?? []).length ? (
            <AdminEmptyState
              title="Sem logs disponíveis"
              description="Os registros administrativos aparecerão aqui conforme ações forem executadas no painel."
            />
          ) : (
            <AdminTableWrapper>
              <table style={styles.table}>
                <thead><tr><th>Quando</th><th>Usuário</th><th>Ação</th><th>Entidade</th><th>ID</th><th>Meta</th></tr></thead>
                <tbody>
                  {(auditQuery.data ?? []).map(log => (
                    <tr key={log.id}>
                      <td>{new Date(log.createdAt).toLocaleString("pt-BR")}</td>
                      <td>{log.actorUserId}</td>
                      <td>{log.action}</td>
                      <td>{log.entity}</td>
                      <td>{log.entityId || "-"}</td>
                      <td>{log.metadata ? JSON.stringify(log.metadata).slice(0, 100) : "-"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </AdminTableWrapper>
          )}
        </AdminSurface>
      )}

      {section === "backup" && (
        <AdminSurface
          title="Backup e restauração"
          description="Use esta área com cautela. A restauração substitui dados atuais e deve ser feita apenas em casos controlados."
        >
          <div style={styles.inlineRow}>
            <button style={styles.primaryBtn} onClick={() => backupManualMutation.mutate()}>Backup manual</button>
            <input style={styles.input} placeholder="arquivo-backup.json" value={restoreFileName} onChange={e => setRestoreFileName(e.target.value)} />
            <button
              style={styles.dangerBtn}
              onClick={() => {
                if (!restoreFileName.trim()) {
                  showToast({ message: "Informe o nome do arquivo de backup", duration: 2300 });
                  return;
                }
                if (!confirmAdminAction(`Restaurar o backup "${restoreFileName.trim()}"? Isso substitui dados atuais e deve ser feito apenas com certeza.`)) return;
                backupRestoreMutation.mutate({ fileName: restoreFileName.trim(), confirmation: "RESTORE" });
              }}
            >
              Restaurar
            </button>
          </div>
          {backupsQuery.isLoading ? (
            <AdminLoadingState>Carregando backups...</AdminLoadingState>
          ) : !(backupsQuery.data ?? []).length ? (
            <AdminEmptyState
              title="Nenhum backup disponível"
              description="Crie um backup manual para que ele apareça listado aqui."
            />
          ) : (
            <AdminTableWrapper>
              <table style={styles.table}>
                <thead><tr><th>Arquivos disponíveis</th></tr></thead>
                <tbody>
                  {(backupsQuery.data ?? []).map(file => (
                    <tr key={file}><td>{file}</td></tr>
                  ))}
                </tbody>
              </table>
            </AdminTableWrapper>
          )}
        </AdminSurface>
      )}
    </div>
  );
}

const adminCss = `
.l4-admin {
  background:
    radial-gradient(circle at top right, rgba(220, 38, 38, 0.10), transparent 28%),
    linear-gradient(180deg, #070707 0%, #0b0b0b 100%);
  padding: clamp(14px, 2.4vw, 28px);
}
.l4-admin table th,
.l4-admin table td {
  padding: 14px 14px;
  border-bottom: 1px solid rgba(255,255,255,0.07);
  vertical-align: middle;
}
.l4-admin table th {
  position: sticky;
  top: 0;
  z-index: 1;
  background: #101010;
  color: #b8bec8;
  font-size: 11px;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  font-weight: 800;
  text-align: left;
}
.l4-admin table td {
  background: rgba(255,255,255,0.01);
}
.l4-admin table tbody tr:hover td {
  background: rgba(239,68,68,0.045);
}
.l4-admin input:focus,
.l4-admin select:focus {
  outline: none;
  border-color: rgba(239,68,68,0.62) !important;
  box-shadow: 0 0 0 3px rgba(239,68,68,0.14);
}
.l4-admin button:disabled {
  cursor: not-allowed;
  opacity: 0.6;
}
.l4-admin button:hover:not(:disabled) {
  filter: brightness(1.08);
}
@media (max-width: 760px) {
  .l4-admin table th,
  .l4-admin table td {
    padding: 12px 10px;
  }
}
`;

const styles: Record<string, CSSProperties> = {
  container: {
    display: "flex",
    flexDirection: "column",
    gap: 22,
    overflowX: "hidden",
    color: "#f0ede8",
    borderRadius: 24,
  },
  centerCard: {
    maxWidth: 520,
    margin: "0 auto",
    padding: 20,
    border: "1px solid #2f2f2f",
    borderRadius: 12,
    background: "#111111",
    display: "flex",
    flexDirection: "column",
    gap: 12,
    alignItems: "center",
    textAlign: "center",
  },
  title: {
    margin: 0,
    color: "#f0ede8",
    textAlign: "center",
  },
  muted: {
    margin: 0,
    color: "#a1a1aa",
    textAlign: "center",
  },
  tabs: {
    display: "flex",
    gap: 8,
    flexWrap: "wrap",
    justifyContent: "flex-start",
    padding: 8,
    borderRadius: 16,
    border: "1px solid rgba(255,255,255,0.075)",
    background: "linear-gradient(180deg, rgba(255,255,255,0.035), rgba(255,255,255,0.01)), #0b0b0b",
    boxShadow: "inset 0 1px 0 rgba(255,255,255,0.05)",
  },
  tabBtn: {
    border: "1px solid transparent",
    background: "transparent",
    color: "#a1a1aa",
    borderRadius: 10,
    padding: "10px 14px",
    cursor: "pointer",
    fontWeight: 700,
    minHeight: 40,
  },
  tabBtnActive: {
    background: "linear-gradient(180deg, rgba(239,68,68,0.18), rgba(127,29,29,0.12)), #141414",
    color: "#fff",
    borderColor: "rgba(239,68,68,0.38)",
    boxShadow: "0 0 0 1px rgba(239,68,68,0.08)",
  },
  grid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
    gap: 12,
  },
  kpiCard: {
    border: "1px solid #2f2f2f",
    borderRadius: 10,
    padding: 16,
    background: "#111111",
    display: "flex",
    flexDirection: "column",
    gap: 6,
    textAlign: "center",
  },
  card: {
    border: "1px solid rgba(255,255,255,0.075)",
    borderRadius: 18,
    background: "linear-gradient(180deg, rgba(255,255,255,0.025), rgba(255,255,255,0.006)), #0d0d0d",
    padding: 22,
    display: "flex",
    flexDirection: "column",
    gap: 16,
    textAlign: "left",
    boxShadow: "inset 0 1px 0 rgba(255,255,255,0.04)",
  },
  launchCard: {
    border: "1px solid #2f2f2f",
    borderRadius: 10,
    background: "#0d0d0d",
    padding: 16,
    display: "flex",
    flexDirection: "column",
    gap: 12,
    textAlign: "center",
  },
  launchResult: {
    border: "1px solid #2f2f2f",
    borderRadius: 10,
    background: "#111111",
    padding: 12,
    display: "flex",
    flexDirection: "column",
    gap: 8,
    alignItems: "center",
    textAlign: "center",
  },
  sectionTitle: {
    margin: 0,
    color: "#f0ede8",
    textAlign: "left",
    fontSize: 24,
    lineHeight: 1.15,
  },
  productSectionHero: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "flex-start",
    gap: 14,
    flexWrap: "wrap",
    padding: "4px 0 2px",
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
  productAdminActions: {
    display: "flex",
    gap: 10,
    flexWrap: "wrap",
    justifyContent: "flex-start",
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
  inlineRow: {
    display: "flex",
    gap: 10,
    flexWrap: "wrap",
    alignItems: "center",
    justifyContent: "flex-start",
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
  mediaField: {
    display: "flex",
    flexDirection: "column",
    gap: 8,
    padding: 12,
    borderRadius: 12,
    border: "1px solid #242424",
    background: "#101010",
  },
  mediaActions: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    flexWrap: "wrap",
  },
  quickPickRow: {
    display: "flex",
    gap: 8,
    flexWrap: "wrap",
    alignItems: "center",
  },
  quickPickBtn: {
    border: "1px solid #2f2f2f",
    background: "#141414",
    color: "#f0ede8",
    borderRadius: 999,
    padding: "6px 10px",
    fontSize: 12,
    fontWeight: 700,
    cursor: "pointer",
  },
  mediaHint: {
    color: "#9ca3af",
    fontSize: 12,
    lineHeight: 1.5,
    textAlign: "left",
  },
  galleryPreviewGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fill, minmax(132px, 180px))",
    gap: 12,
    alignItems: "start",
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
    maxWidth: 180,
  },
  galleryPreviewImage: {
    width: "100%",
    aspectRatio: "4 / 5",
    objectFit: "contain",
    objectPosition: "center",
    display: "block",
    borderRadius: 10,
    border: "1px solid #2f2f2f",
    background: "#080808",
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
  hiddenFileInput: {
    display: "none",
  },
  promoPreviewCard: {
    display: "grid",
    gridTemplateColumns: "minmax(220px, 320px) minmax(280px, 1fr)",
    gap: 18,
    marginTop: 18,
    padding: 18,
    borderRadius: 14,
    border: "1px solid #2f2f2f",
    background: "linear-gradient(135deg, #101010 0%, #171717 100%)",
    alignItems: "stretch",
  },
  promoPreviewMediaGroup: {
    display: "grid",
    gap: 12,
    gridTemplateColumns: "1fr",
    alignItems: "start",
  },
  promoPreviewMedia: {
    minHeight: 220,
    borderRadius: 14,
    border: "1px solid rgba(255,255,255,0.06)",
    overflow: "hidden",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    background: "#121212",
  },
  promoPreviewMobileWrap: {
    display: "flex",
    flexDirection: "column",
    gap: 8,
    alignItems: "flex-start",
  },
  promoPreviewDeviceLabel: {
    color: "#9ca3af",
    fontSize: 11,
    fontWeight: 700,
    letterSpacing: 1.4,
    textTransform: "uppercase",
  },
  promoPreviewMobile: {
    width: 140,
    height: 220,
    borderRadius: 22,
    border: "1px solid rgba(255,255,255,0.08)",
    overflow: "hidden",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    background: "#121212",
  },
  promoPreviewImage: {
    width: "100%",
    height: "100%",
    objectFit: "cover",
    display: "block",
  },
  promoPreviewMobileImage: {
    width: "100%",
    height: "100%",
    objectFit: "cover",
    display: "block",
  },
  promoPreviewPlaceholder: {
    color: "#d1d5db",
    fontSize: 14,
    fontWeight: 700,
    letterSpacing: 0.3,
  },
  promoPreviewContent: {
    display: "flex",
    flexDirection: "column",
    gap: 10,
    textAlign: "left",
    justifyContent: "center",
  },
  promoPreviewEyebrow: {
    color: "#9ca3af",
    fontSize: 11,
    letterSpacing: 1.6,
    textTransform: "uppercase",
  },
  promoPreviewBadge: {
    alignSelf: "flex-start",
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    minHeight: 28,
    padding: "0 12px",
    borderRadius: 999,
    background: "#f0ede8",
    color: "#111111",
    fontSize: 12,
    fontWeight: 800,
    letterSpacing: 0.3,
  },
  promoPreviewTitle: {
    color: "#f9fafb",
    fontSize: 28,
    lineHeight: 1.05,
    fontWeight: 900,
  },
  promoPreviewDescription: {
    color: "#d1d5db",
    fontSize: 14,
    lineHeight: 1.65,
    maxWidth: 560,
  },
  promoPreviewMetaRow: {
    display: "flex",
    alignItems: "baseline",
    gap: 10,
    flexWrap: "wrap",
  },
  promoPreviewDiscount: {
    color: "#f9fafb",
    fontSize: 30,
    fontWeight: 900,
    lineHeight: 1,
  },
  promoPreviewDiscountLabel: {
    color: "#facc15",
    fontSize: 13,
    fontWeight: 800,
    letterSpacing: 0.8,
    textTransform: "uppercase",
  },
  promoPreviewFooter: {
    display: "flex",
    alignItems: "center",
    gap: 12,
    flexWrap: "wrap",
    marginTop: 4,
  },
  promoPreviewCta: {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    minHeight: 40,
    padding: "0 16px",
    borderRadius: 999,
    background: "#f0ede8",
    color: "#101010",
    fontSize: 13,
    fontWeight: 800,
  },
  promoPreviewLink: {
    color: "#9ca3af",
    fontSize: 12,
    lineHeight: 1.5,
  },
  promoPreviewWarning: {
    color: "#fbbf24",
    fontSize: 12,
    lineHeight: 1.6,
    padding: "10px 12px",
    borderRadius: 10,
    border: "1px solid rgba(251, 191, 36, 0.28)",
    background: "rgba(120, 53, 15, 0.18)",
  },
  promoPreviewOrderHint: {
    color: "#9ca3af",
    fontSize: 12,
    lineHeight: 1.6,
    marginTop: 4,
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
  table: {
    width: "100%",
    minWidth: 920,
    borderCollapse: "separate",
    borderSpacing: 0,
    fontSize: 14,
    lineHeight: 1.4,
    color: "#e5e7eb",
    textAlign: "left",
  },
  activeTableRow: {
    outline: "1px solid rgba(239,68,68,0.30)",
    background: "rgba(239,68,68,0.055)",
  },
  orderAdminLayout: {
    display: "grid",
    gridTemplateColumns: "minmax(0, 1fr) 320px",
    gap: 16,
    alignItems: "start",
  },
  orderPrimaryText: {
    color: "#f0ede8",
    fontSize: 14,
    fontWeight: 700,
    lineHeight: 1.4,
  },
  orderSecondaryText: {
    marginTop: 2,
    color: "#9ca3af",
    fontSize: 11,
    lineHeight: 1.35,
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
  stockInputLow: {
    border: "1px solid #7c5a10",
    background: "#17120a",
    color: "#facc15",
  },
  stockInputEmpty: {
    border: "1px solid #7f1d1d",
    background: "#160b0b",
    color: "#f87171",
  },
  productVisualCell: {
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    gap: 6,
  },
  productVisualMeta: {
    color: "#9ca3af",
    fontSize: 11,
    lineHeight: 1.3,
  },
  productVisualMetaStack: {
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    gap: 2,
  },
  promoTablePreviewGroup: {
    display: "flex",
    alignItems: "flex-end",
    gap: 12,
    flexWrap: "wrap",
    minWidth: 280,
  },
  promoStatusStack: {
    display: "flex",
    flexDirection: "column",
    alignItems: "flex-start",
    gap: 8,
    minWidth: 150,
  },
  promoMediaBadgeRow: {
    display: "flex",
    alignItems: "center",
    gap: 6,
    flexWrap: "wrap",
  },
  dragHandle: {
    display: "inline-flex",
    alignItems: "center",
    gap: 8,
    color: "#d1d5db",
    fontSize: 12,
    fontWeight: 700,
  },
  dragGrip: {
    color: "#9ca3af",
    fontSize: 14,
    lineHeight: 1,
    letterSpacing: -1,
    cursor: "grab",
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
    border: "1px solid rgba(255,255,255,0.10)",
    background: "#111111",
    color: "#f0ede8",
    borderRadius: 9,
    padding: "6px 10px",
    cursor: "pointer",
    fontWeight: 700,
    whiteSpace: "nowrap",
  },
  primaryBtn: {
    border: "1px solid rgba(239,68,68,0.46)",
    background: "linear-gradient(135deg, #ef233c 0%, #991b1b 100%)",
    color: "#fff",
    borderRadius: 10,
    padding: "12px 16px",
    cursor: "pointer",
    minWidth: 180,
    fontWeight: 800,
    boxShadow: "0 12px 28px rgba(220,38,38,0.18)",
  },
  secondaryBtn: {
    border: "1px solid rgba(255,255,255,0.10)",
    background: "#111111",
    color: "#f0ede8",
    borderRadius: 10,
    padding: "10px 14px",
    cursor: "pointer",
    minWidth: 128,
    fontWeight: 700,
  },
  dangerBtn: {
    border: "1px solid rgba(239,68,68,0.52)",
    background: "rgba(127,29,29,0.14)",
    color: "#f87171",
    borderRadius: 9,
    padding: "6px 10px",
    cursor: "pointer",
    fontWeight: 800,
    whiteSpace: "nowrap",
  },
};

























